// Ortak numara "WhatsApp kurulumu", 360dialog yolu (d360; varsayılan, 15 §6.2 ve §6.2a). Proje sahibi 360dialog Hub'da
// numarayı bağlar ve API anahtarını üretir; geri kalanı buradan (API anahtarı yalnız D360-API-KEY başlığında):
//   - bağlantı testi: GET /health_status?fields=… (numara, görünen ad, kalite, mesaj gönderebilirlik) + GET /v1/configs/webhook
//   - webhook: GET /v1/configs/webhook okur; POST /v1/configs/webhook {url} ortak webhook adresini yazar (zaten doğruysa
//     yazmaz). 360dialog Meta imzası göndermez; ortak webhook d360'ta imza denetlemez, URL'deki gizli belirteç korur.
//   - şablonlar: wa-setup.ts (Graph ile aynı gövde; 360dialog'da GET/POST /message_templates).
// 360dialog'un kendi uç noktası sürümlü değildir; yollar providers/d360.ts'teki sabitlerdedir (teyit edilmeli).
// Hatalar Türkçe ve yapılacak işi söyleyen AppError'a çevrilir (401 anahtar, 403 yetki, 404 uç nokta, 429, 5xx, Meta kodları).

import { SHARED_WA_DISPLAY_NAME, WA_PROVIDER_LABELS, formatPhone } from '@siparis/core';
import type { AdminWaSetupTest, AdminWaSetupTone, AdminWaSetupWebhook } from '@siparis/core/admin/contracts';
import { platformDisplayPhone } from '../../config';
import { AppError, conflict } from '../../lib/errors';
import { adminApiCall, d360Target, isGraphApiError, type AdminApiTarget, type GraphApiError } from '../../wa/graph-admin';
import { D360_HEALTH_PATH, D360_WEBHOOK_PATH } from '../../wa/providers/d360';
import {
  NAME_STATUS,
  QUALITY,
  RATE_LIMIT_CODES,
  baseUrl,
  digits,
  envName,
  maskedSharedWebhook,
  requireHttpsBase,
  requireRealProvider,
  sharedWebhookPrefix,
  str,
  toneLabel,
  type ToneMap,
  type WaSetupConfig,
} from './wa-setup-common';

/** Hata bağlamı: bağlantı testi, webhook, tek şablon oluşturma, şablon listesi. */
export type D360Context = 'health' | 'webhook' | 'template' | 'templates';

/** 360dialog anahtarı yeniden üretilince numaranın webhook'u silinir (360dialog belgesi): her anahtar hatasında hatırlatılır. */
const NEW_KEY_NOTE = "Yeni anahtar üretilince 360dialog numaranın webhook adresini siler: dağıtımdan sonra \"Webhook'u 360dialog'a kaydet\"e yeniden basın.";

/** 360dialog hatası → Türkçe, yapılacak işi söyleyen AppError (502; ön koşul hataları 409). */
export function d360ErrorToAppError(err: GraphApiError, ctx: D360Context): AppError {
  const status = err.httpStatus;
  const code = Number(err.code);
  const metaCode = /^\d+$/.test(err.code) ? `Meta hata ${err.code}${err.subcode ? `/${err.subcode}` : ''}` : null;
  const ref = [status ? `HTTP ${status}` : null, metaCode].filter(Boolean).join(', ') || err.code;
  const e = (c: string, message: string) => new AppError(502, c, message, { graphCode: err.code, graphSubcode: err.subcode, httpStatus: status });
  if (err.code === 'network' || err.code === 'timeout') return e('d360_unreachable', `${err.message}. İnternet bağlantısını kontrol edip biraz sonra tekrar deneyin.`);
  if (status === 401 || code === 190) {
    return e(
      'd360_key_invalid',
      `360dialog API anahtarı geçersiz ya da iptal edilmiş (${ref}). hub.360dialog.com › numaranız › API key bölümünden yeni anahtar üretin, ` +
        `${envName('PLATFORM_WA_API_KEY', 'd360')} değerini güncelleyip iş akışını çalıştırın. ${NEW_KEY_NOTE}`,
    );
  }
  if (status === 429 || RATE_LIMIT_CODES.has(err.code)) return e('d360_rate_limited', `360dialog ya da Meta istek sınırına takıldı (${ref}). Birkaç dakika bekleyip tekrar deneyin.`);
  if (code === 131031) return e('wa_account_locked', `WhatsApp Business hesabı kilitli ya da askıda (${ref}). 360dialog Hub'da ve WhatsApp Manager'da hesap durumunu kontrol edin.`);
  if (code === 131042) {
    return e(
      'wa_payment_missing',
      `Meta mesaj ücretleri için ödeme yöntemi eksik ya da geçersiz (${ref}). 360dialog Hub'daki ödeme/fatura bilgilerini kontrol edin (Meta ücretlerinin 360dialog'dan mı Meta'ya tanımlı karttan mı çekildiği plana bağlıdır; teyit edilmeli).`,
    );
  }
  if (status === 403 || code === 10 || code === 3 || (code >= 200 && code <= 299)) {
    return e(
      'd360_forbidden',
      `360dialog bu işlemi reddetti (${ref}): API anahtarının bu işlem için yetkisi yok ya da hesap/plan askıda. 360dialog Hub'da numaranın ve ödeme planının durumunu kontrol edin.` +
        (err.message ? ` Ayrıntı: ${err.message}` : ''),
    );
  }
  if (status === 404) {
    return e(
      'd360_not_found',
      ctx === 'health'
        ? `360dialog numara durum ucunu bulamadı (${ref}). Anahtar geçerli olabilir; 360dialog API'si değişmiş olabilir. "Webhook'u 360dialog'a kaydet" ile devam edin ve durumu docs/15 §6.3'teki elle (curl) komutlarla kontrol edin.`
        : `360dialog bu uç noktayı bulamadı (${ref}). 360dialog API'si değişmiş olabilir; docs/15 §6.3'teki elle (curl) komutlarla deneyin.`,
    );
  }
  if (status != null && status >= 500) return e('d360_unavailable', `360dialog geçici olarak yanıt vermiyor (${ref}). Biraz sonra tekrar deneyin.`);
  const detail = err.userMessage ?? err.message;
  return e('d360_error', `360dialog isteği reddetti (${ref}): ${detail}`.slice(0, 600));
}

async function d360<T>(ctx: D360Context, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isGraphApiError(err)) throw d360ErrorToAppError(err, ctx);
    throw err;
  }
}

/** d360 + anahtar; değilse 409 (mock: wa_setup_mock, cloud: wa_setup_not_d360, anahtar yok: wa_setup_missing). */
export function requireD360(c: WaSetupConfig): AdminApiTarget {
  requireRealProvider(c);
  if (c.PLATFORM_WA_PROVIDER !== 'd360') {
    throw conflict(
      'wa_setup_not_d360',
      `Bu adım yalnız 360dialog'da çalışır; şu anki sağlayıcı: ${WA_PROVIDER_LABELS[c.PLATFORM_WA_PROVIDER]}. Meta Cloud API'de webhook adresi Meta'ya girilir ("Meta'ya girilecek bilgiler › Göster").`,
    );
  }
  if (!c.PLATFORM_WA_API_KEY) throw conflict('wa_setup_missing', `360dialog API anahtarı tanımlı değil: ${envName('PLATFORM_WA_API_KEY', 'd360')}.`);
  return d360Target(c.PLATFORM_WA_API_KEY);
}

/** 360dialog webhook adresinde alan adı alt çizgi ve port içeremez (360dialog kuralı). Sorun yoksa null. */
export function d360HostProblem(c: WaSetupConfig): string | null {
  try {
    const u = new URL(baseUrl(c));
    if (u.hostname.includes('_') || u.port) {
      return `APP_BASE_URL (${u.host}) 360dialog webhook'u için uygun değil: alan adında alt çizgi (_) ya da port (:${u.port || '…'}) olamaz.`;
    }
  } catch {
    return 'APP_BASE_URL geçerli bir adres değil.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Webhook adresi

/** Webhook adresini maskeler: ortak adresimizde belirteç yalnız son 4 karakter; başka adreste uzun yol parçaları ve sorgu. */
export function maskWebhookUrl(raw: string, c: Pick<WaSetupConfig, 'APP_BASE_URL'>): string {
  const prefix = sharedWebhookPrefix(c);
  if (raw.startsWith(prefix)) return `${prefix}••••${raw.slice(prefix.length).slice(-4)}`;
  try {
    const u = new URL(raw);
    const path = u.pathname
      .split('/')
      .map((seg) => (seg.length >= 12 ? `••••${seg.slice(-4)}` : seg))
      .join('/');
    return `${u.origin}${path}${u.search ? '?…' : ''}`;
  } catch {
    return '(okunamayan adres)';
  }
}

const expectedWebhook = (c: WaSetupConfig) => (c.PLATFORM_WA_WEBHOOK_TOKEN ? `${sharedWebhookPrefix(c)}${c.PLATFORM_WA_WEBHOOK_TOKEN}` : null);
const sameUrl = (a: string | null, b: string | null) => !!a && !!b && a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/** 360dialog'daki webhook adresi (yoksa null; 404 "tanımlı değil" sayılır). */
async function fetchWebhookUrl(t: AdminApiTarget): Promise<string | null> {
  try {
    const res = await adminApiCall<Record<string, unknown>>(t, 'GET', D360_WEBHOOK_PATH);
    const nested = res.webhook && typeof res.webhook === 'object' ? (res.webhook as Record<string, unknown>).url : undefined;
    const url = [res.url, nested, res.webhook_url].find((v) => typeof v === 'string' && v.trim());
    return typeof url === 'string' ? url.trim() : null;
  } catch (err) {
    if (isGraphApiError(err) && err.httpStatus === 404) return null;
    throw err;
  }
}

function webhookResult(c: WaSetupConfig, current: string | null, changed: boolean): Omit<AdminWaSetupWebhook, 'message'> {
  return {
    configured: !!current,
    matches: sameUrl(current, expectedWebhook(c)),
    changed,
    urlMasked: current ? maskWebhookUrl(current, c) : null,
    expectedUrlMasked: maskedSharedWebhook(c),
  };
}

const REGISTER_HINT = '"Webhook\'u 360dialog\'a kaydet" düğmesine basın.';

function viewMessage(r: Omit<AdminWaSetupWebhook, 'message'>): string {
  if (!r.expectedUrlMasked) return 'Ortak webhook belirteci tanımlı değil (PLATFORM_WA_WEBHOOK_TOKEN): kaydedilecek adres oluşmaz.';
  if (!r.configured) return `360dialog'da kayıtlı webhook yok: müşteri mesajları sisteme ulaşmaz. ${REGISTER_HINT}`;
  if (!r.matches) return `360dialog'daki webhook başka bir adrese gidiyor: müşteri mesajları bu sisteme ulaşmaz. ${REGISTER_HINT}`;
  return "360dialog'daki webhook bu sistemin ortak webhook adresine gidiyor.";
}

export async function readD360Webhook(c: WaSetupConfig): Promise<AdminWaSetupWebhook> {
  const t = requireD360(c);
  const current = await d360('webhook', () => fetchWebhookUrl(t));
  const r = webhookResult(c, current, false);
  return { ...r, message: viewMessage(r) };
}

/**
 * Ortak webhook adresini 360dialog'a yazar: POST /v1/configs/webhook {url}. Adres zaten doğruysa yazmaz (idempotent).
 * Özel başlık gönderilmez (360dialog destekler; bizde yetkilendirme URL'deki belirteçtedir).
 */
export async function registerD360Webhook(c: WaSetupConfig): Promise<AdminWaSetupWebhook> {
  const t = requireD360(c);
  const expected = expectedWebhook(c);
  if (!expected) {
    throw conflict('wa_setup_missing', 'Ortak webhook belirteci tanımlı değil (PLATFORM_WA_WEBHOOK_TOKEN): kaydedilecek adres oluşmaz. Canlı ortamda iş akışı kendiliğinden üretir; yeniden dağıtın.');
  }
  requireHttpsBase(c, "360dialog webhook adresi https olmalı");
  const hostProblem = d360HostProblem(c);
  if (hostProblem) throw conflict('wa_setup_base_url', hostProblem);

  // Okuma başarısızsa (404 dışı, anahtar hatası değil) yine de yazmayı dener: GET ucu davranışı teyit edilmedi
  let current: string | null = null;
  try {
    current = await fetchWebhookUrl(t);
  } catch (err) {
    if (!isGraphApiError(err) || err.httpStatus === 401 || err.code === 'network' || err.code === 'timeout') {
      throw isGraphApiError(err) ? d360ErrorToAppError(err, 'webhook') : err;
    }
  }
  if (sameUrl(current, expected)) {
    return { ...webhookResult(c, current, false), message: "Webhook zaten bu sistemin adresine kayıtlı; değişiklik yapılmadı." };
  }

  const res = await d360('webhook', () => adminApiCall<Record<string, unknown>>(t, 'POST', D360_WEBHOOK_PATH, { body: { url: expected } }));
  let after: string | null = typeof res.url === 'string' && res.url.trim() ? res.url.trim() : expected;
  try {
    after = (await fetchWebhookUrl(t)) ?? after;
  } catch {
    // Yazma başarılı; geri okuma hatası sonucu değiştirmez
  }
  const r = webhookResult(c, after, true);
  return {
    ...r,
    message: r.matches
      ? "Webhook 360dialog'a kaydedildi: müşteri mesajları artık bu sisteme gelir. Denemek için kendi telefonunuzdan ortak numaraya bir dükkan kodu (#KOD) yazın; Admin › WhatsApp'taki \"Son webhook\" güncellenmeli."
      : "360dialog kaydı onayladı ama okunan adres farklı görünüyor: birkaç saniye sonra \"Kayıtlı adresi göster\" ile tekrar bakın.",
  };
}

// ---------------------------------------------------------------------------
// Bağlantı testi

interface D360HealthError {
  error_code?: number;
  error_description?: string;
  possible_solution?: string;
}
interface D360Health {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  name_status?: string;
  quality_rating?: string;
  code_verification_status?: string;
  platform_type?: string;
  messaging_limit_tier?: string;
  health_status?: {
    can_send_message?: string;
    entities?: Array<{ entity_type?: string; id?: string; can_send_message?: string; errors?: D360HealthError[] }>;
  };
}

/** health_status her zaman döner; ek alanlar Graph telefon düğümüyle aynı adlardadır (teyit edilmeli). */
export const D360_HEALTH_FIELDS =
  'health_status,display_phone_number,verified_name,name_status,quality_rating,code_verification_status,platform_type,messaging_limit_tier';

const CAN_SEND: ToneMap = {
  AVAILABLE: ['Açık', 'ok'],
  LIMITED: ['Sınırlı', 'warn'],
  BLOCKED: ['Engelli', 'bad'],
};
const LIMIT_TIER: ToneMap = {
  TIER_50: ['Günde 50 kişi', 'info'],
  TIER_250: ['Günde 250 kişi', 'info'],
  TIER_1K: ['Günde 1.000 kişi', 'ok'],
  TIER_2K: ['Günde 2.000 kişi', 'ok'],
  TIER_10K: ['Günde 10.000 kişi', 'ok'],
  TIER_100K: ['Günde 100.000 kişi', 'ok'],
  TIER_UNLIMITED: ['Sınırsız', 'ok'],
};

export async function testConnectionD360(c: WaSetupConfig): Promise<AdminWaSetupTest> {
  const t = requireD360(c);
  const p = await d360('health', () => adminApiCall<D360Health>(t, 'GET', D360_HEALTH_PATH, { query: { fields: D360_HEALTH_FIELDS } }));
  // Webhook okuması testi düşürmez: anahtar hatası yukarıda yakalanırdı; diğer hatada satır "okunamadı" olur
  let webhookUrl: string | null = null;
  let webhookReadable = true;
  try {
    webhookUrl = await fetchWebhookUrl(t);
  } catch (err) {
    if (!isGraphApiError(err)) throw err;
    webhookReadable = false;
  }

  const health = p.health_status ?? {};
  const canSend = str(health.can_send_message)?.toUpperCase() ?? null;
  const phone = {
    id: str(p.id) ?? '',
    displayPhoneNumber: str(p.display_phone_number),
    verifiedName: str(p.verified_name),
    nameStatus: str(p.name_status),
    qualityRating: str(p.quality_rating),
    codeVerificationStatus: str(p.code_verification_status),
    platformType: str(p.platform_type),
    throughputLevel: null,
  };
  const rows: AdminWaSetupTest['rows'] = [];
  const hints: string[] = [];
  const configured = platformDisplayPhone(c);
  const match = !!phone.displayPhoneNumber && !!configured && digits(phone.displayPhoneNumber) === digits(configured);
  const expected = expectedWebhook(c);
  const hookOk = sameUrl(webhookUrl, expected);

  rows.push({ label: 'API anahtarı', value: '360dialog yanıt verdi (geçerli)', tone: 'ok' });
  rows.push({ label: 'Numara (360dialog)', value: phone.displayPhoneNumber ?? 'Bilinmiyor', tone: phone.displayPhoneNumber ? 'info' : 'warn' });
  rows.push({
    label: 'Sistemdeki numara',
    value: !configured
      ? 'Tanımlı değil'
      : match
        ? `${formatPhone(configured)} (eşleşiyor)`
        : phone.displayPhoneNumber
          ? `${formatPhone(configured)} (farklı)`
          : `${formatPhone(configured)} (360dialog numarayı bildirmedi)`,
    tone: match ? 'ok' : configured && !phone.displayPhoneNumber ? 'info' : 'bad',
  });
  const nameOk = !!phone.verifiedName && phone.verifiedName.trim().toLocaleLowerCase('tr') === SHARED_WA_DISPLAY_NAME.toLocaleLowerCase('tr');
  rows.push({ label: 'Görünen ad', value: phone.verifiedName ?? 'Bilinmiyor', tone: nameOk ? 'ok' : 'warn' });
  const [nameLabel, nameTone] = toneLabel(NAME_STATUS, phone.nameStatus);
  rows.push({ label: 'Görünen ad onayı', value: nameLabel, tone: nameTone });
  const [sendLabel, sendTone] = toneLabel(CAN_SEND, canSend);
  rows.push({ label: 'Mesaj gönderimi (Meta)', value: sendLabel, tone: sendTone });
  const [qLabel, qTone] = toneLabel(QUALITY, phone.qualityRating, 'info');
  rows.push({ label: 'Kalite', value: qLabel, tone: qTone });
  const tier = str(p.messaging_limit_tier);
  if (tier) {
    const [tierLabel, tierTone] = toneLabel(LIMIT_TIER, tier, 'info');
    rows.push({ label: 'Günlük iletişim sınırı', value: tierLabel, tone: tierTone });
  }
  let hookValue: string;
  let hookTone: AdminWaSetupTone;
  if (!webhookReadable) [hookValue, hookTone] = ['Okunamadı', 'warn'];
  else if (!webhookUrl) [hookValue, hookTone] = ['Kayıtlı değil', 'bad'];
  else [hookValue, hookTone] = [`${maskWebhookUrl(webhookUrl, c)} (${hookOk ? 'doğru' : 'farklı adres'})`, hookOk ? 'ok' : 'bad'];
  rows.push({ label: 'Webhook (360dialog)', value: hookValue, tone: hookTone });

  if (webhookReadable && !hookOk) {
    hints.push(
      webhookUrl
        ? "360dialog'daki webhook başka bir adrese gidiyor: aşağıdaki \"Webhook'u 360dialog'a kaydet\" düğmesiyle düzeltin."
        : "Webhook 360dialog'a kayıtlı değil: aşağıdaki \"Webhook'u 360dialog'a kaydet\" düğmesine basın. Kayıt olmadan müşteri mesajları sisteme ulaşmaz.",
    );
  }
  if (canSend === 'BLOCKED' || canSend === 'LIMITED') {
    hints.push(
      canSend === 'BLOCKED'
        ? 'Meta bu numaradan mesaj gönderimini engelliyor: aşağıdaki Meta açıklamalarına bakın; çoğunlukla görünen ad onayı, ödeme yöntemi ya da hesap incelemesiyle ilgilidir.'
        : 'Meta bu numarada gönderimi sınırlıyor: aşağıdaki Meta açıklamalarına bakın.',
    );
  }
  const errors = (health.entities ?? []).flatMap((en) => (en.errors ?? []).map((er) => ({ en, er })));
  for (const { en, er } of errors.slice(0, 5)) {
    const what = [str(en.entity_type), er.error_code != null ? `kod ${er.error_code}` : null].filter(Boolean).join(', ');
    const text = `Meta (${what || 'durum'}): ${str(er.error_description) ?? 'açıklama yok'}${str(er.possible_solution) ? ` Öneri: ${er.possible_solution}` : ''}`;
    hints.push(text.slice(0, 400));
  }
  if (phone.nameStatus === 'PENDING_REVIEW') hints.push('Görünen ad Meta incelemesinde (genelde 1–3 gün). Onaylanana kadar müşteriler ad yerine numarayı görebilir.');
  if (phone.nameStatus === 'DECLINED' || phone.nameStatus === 'EXPIRED') {
    hints.push('Görünen ad reddedildi: 360dialog Hub ya da WhatsApp Manager (business.facebook.com) üzerinden "Yemek Gelsin" adını yeniden gönderin; ad sitedeki marka adıyla aynı olmalı (teyit edilmeli).');
  }
  if (phone.verifiedName && !nameOk) hints.push(`Meta'daki görünen ad "${phone.verifiedName}"; ortak numaranın adı "${SHARED_WA_DISPLAY_NAME}" olmalı.`);
  if (configured && phone.displayPhoneNumber && !match) {
    hints.push(
      `${envName('PLATFORM_WA_DISPLAY_PHONE', 'd360')} 360dialog'daki numarayla aynı değil: QR ve wa.me bağlantıları yanlış numaraya gider. Değeri düzeltip yeniden dağıtın.`,
    );
  }
  if (phone.qualityRating === 'RED' || phone.qualityRating === 'YELLOW') hints.push('Numara kalitesi düşük: müşteri şikâyeti ve engellemeleri artmış olabilir; toplu ya da izinsiz mesaj gönderilmemeli.');
  const ready = hookOk && canSend !== 'BLOCKED' && canSend !== 'LIMITED';
  return { ready, phone, rows, hints };
}
