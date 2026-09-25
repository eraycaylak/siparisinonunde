// Web Push sözleşmeleri (00 §10 alarm t=0, 04 §4.5; 14 §6.3 "Bildirim (Web Push)"): panel cihaz aboneliği ve
// service worker'a giden yük. Web ve API aynı şemaları kullanır.
// İçe aktarma: `@siparis/core/notifications/contracts`.

import { z } from 'zod';

/**
 * Kabul edilen itme servisleri (tarayıcıların kendi servisleri). Sunucu abonelik adresine POST attığı için
 * rastgele adres kabul edilmez (iç ağa istek sızdırma — SSRF — önlemi). Ana makine bu adın kendisi ya da alt alanı olmalı.
 */
export const PUSH_SERVICE_HOSTS = [
  // Chrome, Edge (Chromium), Samsung Internet, Opera, Android
  'fcm.googleapis.com',
  'android.googleapis.com',
  // Firefox
  'push.services.mozilla.com',
  // Safari (macOS 13+, iOS/iPadOS 16.4+ ana ekrana eklenmiş web uygulaması)
  'push.apple.com',
  // Eski Edge / Windows
  'notify.windows.com',
] as const;

/** Adres https ve bilinen bir itme servisinde mi. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export const pushEndpointSchema = z
  .string()
  .trim()
  .max(2048, 'Abonelik adresi çok uzun.')
  .refine(isAllowedPushEndpoint, 'Bu tarayıcının bildirim servisi desteklenmiyor.');

/** POST /panel/push/subscribe — tarayıcıdaki PushSubscription.toJSON() biçimi. */
export const pushSubscribeRequestSchema = z.object({
  endpoint: pushEndpointSchema,
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    /** P-256 genel anahtarı (65 bayt → 87 karakter base64url) */
    p256dh: z.string().trim().min(80).max(100).regex(BASE64URL, 'Geçersiz anahtar.'),
    /** 16 baytlık kimlik sırrı (22 karakter base64url) */
    auth: z.string().trim().min(16).max(44).regex(BASE64URL, 'Geçersiz anahtar.'),
  }),
});
export type PushSubscribeRequest = z.infer<typeof pushSubscribeRequestSchema>;

export const pushSubscribeResponseSchema = z.object({
  ok: z.literal(true),
  subscriptionId: z.string(),
  /** Aboneliğin bağlandığı şube (null = üyeliğin eriştiği tüm şubeler) */
  branchId: z.string().nullable(),
});
export type PushSubscribeResponse = z.infer<typeof pushSubscribeResponseSchema>;

/** POST /panel/push/unsubscribe ve /panel/push/test. */
export const pushEndpointRequestSchema = z.object({
  endpoint: z.string().trim().min(1).max(2048),
});
export type PushEndpointRequest = z.infer<typeof pushEndpointRequestSchema>;

export const pushUnsubscribeResponseSchema = z.object({
  ok: z.literal(true),
  /** Bu kullanıcıya ait etkin bir abonelik kapatıldı mı */
  removed: z.boolean(),
});
export type PushUnsubscribeResponse = z.infer<typeof pushUnsubscribeResponseSchema>;

/** GET /panel/push/public-key — VAPID yapılandırılmamışsa push kapalıdır (enabled=false, publicKey=null). */
export const pushPublicKeyResponseSchema = z.object({
  enabled: z.boolean(),
  publicKey: z.string().nullable(),
});
export type PushPublicKeyResponse = z.infer<typeof pushPublicKeyResponseSchema>;

/** POST /panel/push/test — yalnız çağıranın bu cihazdaki aboneliğine test bildirimi. */
export const pushTestResponseSchema = z.object({
  sent: z.boolean(),
  /** sent=false ise: not_found (abonelik yok/kapalı), disabled (servis aboneliği sildi), failed, push_disabled */
  reason: z.enum(['not_found', 'disabled', 'failed', 'push_disabled']).nullable(),
});
export type PushTestResponse = z.infer<typeof pushTestResponseSchema>;

/** Service worker'a giden yük (panel-sw.js). Müşteri adı, telefonu, adresi yoktur. */
export const pushPayloadSchema = z.object({
  kind: z.enum(['new_order', 'test']),
  title: z.string(),
  body: z.string(),
  /** Bildirime dokununca açılacak panel yolu */
  url: z.string(),
  /** Aynı etiketli bildirim yenisiyle değişir (sipariş kimliği) */
  tag: z.string(),
  orderId: z.string().nullable(),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

/** Yeni sipariş bildiriminin açtığı yol. */
export const PUSH_OPEN_URL = '/panel';
