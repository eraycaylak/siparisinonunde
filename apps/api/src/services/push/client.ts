// Web Push gönderimi (RFC 8030/8291/8292; `web-push` kütüphanesi). VAPID anahtarları yoksa push kapalıdır: süreç
// başına bir kez uyarı yazılır, gönderim yapılmaz. Abonelik adresi (endpoint) cihaza özel bir yetki adresidir:
// loglara yalnız ana makinesi yazılır.

import type { PushPayload } from '@siparis/core/notifications/contracts';
import type { FastifyBaseLogger } from 'fastify';
import webpush from 'web-push';
import type { Config } from '../../config';

/** Tek istek için üst süre (soket zaman aşımı + toplam süre). Ana worker şeridini uzun süre bekletmez. */
export const PUSH_REQUEST_TIMEOUT_MS = 10_000;
/** İtme servisinin iletilemeyen bildirimi saklama süresi: sonraki alarm basamakları devreye girdiği için kısa. */
export const PUSH_TTL_SECONDS = 600;

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Sonuç sınıfları: `gone` (404/410: servis aboneliği sildi → abonelik kapatılır), `rejected` (diğer 4xx: yeniden
 * denemek değiştirmez), `retryable` (5xx, 408, 429, ağ/zaman aşımı → iş kurallarıyla yeniden denenir).
 */
export type PushSendResult =
  | { ok: true; statusCode: number }
  | { ok: false; kind: 'gone' | 'rejected' | 'retryable'; statusCode: number | null; error: string };

let disabledLogged = false;

/** Push açık mı; kapalıysa süreç başına bir kez uyarı yazar. */
export function isPushAvailable(config: Config, log?: FastifyBaseLogger): boolean {
  if (config.pushEnabled) return true;
  if (!disabledLogged && log) {
    disabledLogged = true;
    log.warn('Web Push kapalı: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY ve VAPID_SUBJECT tanımlı değil (15 §4)');
  }
  return false;
}

/** Endpoint'in yalnız ana makinesi (log için). */
export function pushHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return 'geçersiz';
  }
}

/** web-push hatasını sınıflar (WebPushError.statusCode; ağ hatasında kod/mesaj). */
export function classifyPushError(err: unknown): Extract<PushSendResult, { ok: false }> {
  const statusCode = typeof (err as { statusCode?: unknown })?.statusCode === 'number' ? (err as { statusCode: number }).statusCode : null;
  if (statusCode != null) {
    const error = `HTTP ${statusCode}`;
    if (statusCode === 404 || statusCode === 410) return { ok: false, kind: 'gone', statusCode, error };
    if (statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429) {
      return { ok: false, kind: 'rejected', statusCode, error };
    }
    return { ok: false, kind: 'retryable', statusCode, error };
  }
  const code = (err as { code?: unknown })?.code;
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, kind: 'retryable', statusCode: null, error: (typeof code === 'string' ? code : message).slice(0, 120) };
}

export interface SendPushOptions {
  ttlSeconds?: number;
  /** Aynı konulu (en çok 32 karakter, base64url) iletilmemiş bildirim yenisiyle değişir */
  topic?: string;
}

/** Tek aboneliğe gönderim; hata fırlatmaz, sınıflanmış sonuç döner. Push kapalıysa `rejected`. */
export async function sendWebPush(config: Config, target: PushTarget, payload: PushPayload, opts: SendPushOptions = {}): Promise<PushSendResult> {
  if (!config.pushEnabled) return { ok: false, kind: 'rejected', statusCode: null, error: 'push_disabled' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      {
        vapidDetails: { subject: config.VAPID_SUBJECT!, publicKey: config.VAPID_PUBLIC_KEY!, privateKey: config.VAPID_PRIVATE_KEY! },
        TTL: opts.ttlSeconds ?? PUSH_TTL_SECONDS,
        urgency: 'high',
        contentEncoding: 'aes128gcm',
        timeout: PUSH_REQUEST_TIMEOUT_MS,
        ...(opts.topic ? { topic: opts.topic } : {}),
      },
    );
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Push isteği zaman aşımına uğradı'), { code: 'ETIMEDOUT' })), PUSH_REQUEST_TIMEOUT_MS);
    });
    const res = await Promise.race([request, timeout]);
    return { ok: true, statusCode: res.statusCode };
  } catch (err) {
    return classifyPushError(err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
