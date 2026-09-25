// Panel Web Push istemcisi (00 §10 alarm t=0, 04 §4.1 "Web Push izni (ilk sefer)", §4.5).
// Service worker: public/panel-sw.js, kapsam /panel/. Sunucu: /api/v1/panel/push/* (14 §6.3).
// Kurallar: izin yalnız kullanıcı jestinde istenir (vardiya başlatma, "Sesi aç", ayar anahtarı); kullanıcı bu cihazda
// bildirimi kapattıysa (yerel tercih) vardiya başlatma yeniden açmaz. Destek görünümünde (impersonation) hiç çalışmaz.

import type { PushPublicKeyResponse, PushSubscribeResponse, PushTestResponse, PushUnsubscribeResponse } from '@siparis/core/notifications/contracts';
import { apiFetch } from '@/lib/api';

export const PANEL_SW_URL = '/panel-sw.js';
export const PANEL_SW_SCOPE = '/panel/';
/** Kullanıcı bu cihazda bildirimi kapattı (vardiya başlatma yeniden açmasın). */
const OPT_OUT_KEY = 'siparisinonunde:push-off';
/** Tarayıcının itme servisine kaydı bu sürede bitmezse vazgeçilir (ağ engelli, servis yanıtsız). */
const SUBSCRIBE_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Saf yardımcılar (birim testli)

/** VAPID genel anahtarı (base64url) → applicationServerKey baytları. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Mevcut aboneliğin anahtarı sunucudaki VAPID anahtarıyla aynı mı (anahtar değiştiyse yeniden abone olunur). */
export function sameApplicationServerKey(current: ArrayBuffer | null | undefined, publicKey: string): boolean {
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = urlBase64ToUint8Array(publicKey);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface PushPlatform {
  /** iPhone/iPad (iPadOS masaüstü kimliğiyle gelse de dokunmatik Mac olarak) */
  ios: boolean;
  /** iOS sürümü (ana sürüm.alt sürüm), bilinmiyorsa null */
  iosVersion: number | null;
  /** Ana ekrandan (standalone) açılmış mı */
  standalone: boolean;
  /** iOS'ta push için önce ana ekrana eklenmeli (16.4+, standalone) */
  needsHomeScreen: boolean;
  /** iOS 16.4'ten eski: web push hiç yok */
  iosTooOld: boolean;
}

/** Kullanıcı ajanından platform: iOS'ta web push yalnız ana ekrana eklenmiş web uygulamasında, iOS 16.4+ (06 §7.8). */
export function detectPushPlatform(userAgent: string, opts: { standalone: boolean; maxTouchPoints?: number }): PushPlatform {
  const iphone = /iPhone|iPad|iPod/.test(userAgent);
  const ipadDesktop = /Macintosh/.test(userAgent) && (opts.maxTouchPoints ?? 0) > 1;
  const ios = iphone || ipadDesktop;
  let iosVersion: number | null = null;
  const m = /OS (\d+)[_.](\d+)/.exec(userAgent) ?? (ipadDesktop ? /Version\/(\d+)\.(\d+)/.exec(userAgent) : null);
  if (ios && m) iosVersion = Number(m[1]) + Number(m[2]) / 100;
  const iosTooOld = ios && iosVersion != null && iosVersion < 16.04;
  return { ios, iosVersion, standalone: opts.standalone, needsHomeScreen: ios && !opts.standalone && !iosTooOld, iosTooOld };
}

// ---------------------------------------------------------------------------
// Tarayıcı

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function currentPlatform(): PushPlatform {
  if (typeof window === 'undefined') return detectPushPlatform('', { standalone: false });
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return detectPushPlatform(navigator.userAgent, { standalone, maxTouchPoints: navigator.maxTouchPoints });
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export function isPushOptedOut(): boolean {
  try {
    return window.localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

function setOptOut(off: boolean): void {
  try {
    if (off) window.localStorage.setItem(OPT_OUT_KEY, '1');
    else window.localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* gizli sekme vb. */
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Kayıt etkin olana kadar bekler (subscribe etkin worker ister). */
async function waitActive(reg: ServiceWorkerRegistration, timeoutMs = 10_000): Promise<ServiceWorkerRegistration> {
  if (reg.active) return reg;
  const sw = reg.installing ?? reg.waiting;
  if (!sw) return reg;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      sw.removeEventListener('statechange', check);
      resolve();
    };
    const check = () => {
      if (sw.state === 'activated' || sw.state === 'redundant') done();
    };
    const timer = setTimeout(done, timeoutMs);
    sw.addEventListener('statechange', check);
    check();
  });
  return reg;
}

/**
 * Panel service worker'ını kaydeder (kapsam /panel/). `/panel` sayfası kapsam dışında kalır (worker sayfayı yönetmez,
 * yalnız bildirim alır); bu yüzden `navigator.serviceWorker.ready` yerine kaydın kendisi beklenir.
 */
export async function registerPanelServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(PANEL_SW_SCOPE);
  const reg =
    existing && existing.active?.scriptURL.endsWith(PANEL_SW_URL)
      ? existing
      : await navigator.serviceWorker.register(PANEL_SW_URL, { scope: PANEL_SW_SCOPE, updateViaCache: 'none' });
  return waitActive(reg);
}

export async function fetchPushPublicKey(): Promise<PushPublicKeyResponse> {
  return apiFetch<PushPublicKeyResponse>('/panel/push/public-key');
}

/** Tarayıcıdaki mevcut abonelik (yoksa null). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(PANEL_SW_SCOPE);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function postSubscription(sub: PushSubscription): Promise<PushSubscribeResponse> {
  return apiFetch<PushSubscribeResponse>('/panel/push/subscribe', { method: 'POST', body: sub.toJSON() });
}

export type PushEnableResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'needs_home_screen' | 'denied' | 'dismissed' | 'server_disabled' | 'opted_out' | 'error'; message?: string };

/**
 * Bu cihazda bildirimi açar: izin (kullanıcı jestinde, ilk adım) → VAPID anahtarı → service worker → abonelik →
 * sunucuya kayıt. `respectOptOut`: vardiya başlatmada kullanıcının "kapalı" tercihine uyulur.
 */
export async function enablePush(opts: { respectOptOut?: boolean } = {}): Promise<PushEnableResult> {
  if (opts.respectOptOut && isPushOptedOut()) return { ok: false, reason: 'opted_out' };
  if (!isPushSupported()) return { ok: false, reason: currentPlatform().needsHomeScreen ? 'needs_home_screen' : 'unsupported' };
  // İzin isteği jest içinde, hiçbir beklemeden önce (Safari/Firefox jest ister)
  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission === 'denied' ? 'denied' : 'dismissed' };
  try {
    const key = await fetchPushPublicKey();
    if (!key.enabled || !key.publicKey) return { ok: false, reason: 'server_disabled' };
    const reg = await registerPanelServiceWorker();
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameApplicationServerKey(sub.options.applicationServerKey, key.publicKey)) {
      await sub.unsubscribe().catch(() => false);
      sub = null;
    }
    sub ??= await withTimeout(
      reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key.publicKey) }),
      SUBSCRIBE_TIMEOUT_MS,
      'Bildirim servisine bağlanılamadı',
    );
    await postSubscription(sub);
    setOptOut(false);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/** Bu cihazda bildirimi kapatır: sunucudan ve tarayıcıdan siler, yerel "kapalı" tercihini yazar. */
export async function disablePush(): Promise<void> {
  setOptOut(true);
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await apiFetch<PushUnsubscribeResponse>('/panel/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  } finally {
    await sub.unsubscribe().catch(() => false);
  }
}

/**
 * Panel açılışında sessiz eşitleme: izin verilmiş ve tarayıcıda abonelik varsa sunucuya yeniden bildirir (yeni oturum,
 * başka kullanıcı ya da silinmiş kayıt). İzin istemez, yeni abonelik açmaz.
 */
export async function syncPushSubscription(): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== 'granted' || isPushOptedOut()) return false;
  try {
    const sub = await currentSubscription();
    if (!sub) return false;
    const key = await fetchPushPublicKey();
    if (!key.enabled || !key.publicKey || !sameApplicationServerKey(sub.options.applicationServerKey, key.publicKey)) return false;
    await postSubscription(sub);
    return true;
  } catch {
    return false;
  }
}

export async function sendTestPush(endpoint: string): Promise<PushTestResponse> {
  return apiFetch<PushTestResponse>('/panel/push/test', { method: 'POST', body: { endpoint } });
}
