// Ortak numara "WhatsApp kurulumu", Twilio yolu (16 §4; 15 §6.2d). Proje sahibi Twilio Console'da numarayı WhatsApp
// gönderen olarak bağlar; geri kalanı buradan (Account SID + Auth Token yalnız Authorization başlığında):
//   - bağlantı testi: GET https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp
//     (gönderen durumu, kalite, günlük sınır, profil adı, çevrimdışı sebepleri + kayıtlı webhook)
//   - webhook: aynı gönderenin POST https://messaging.twilio.com/v2/Channels/Senders/{XE…} çağrısıyla
//     callback_url ve status_callback_url ortak webhook adresimize yazılır (zaten doğruysa yazılmaz)
//   - şablonlar: Content API kaynağı (POST /v1/Content) + WhatsApp onay isteği
//     (POST /v1/Content/{HX…}/ApprovalRequests/whatsapp); durumlar GET /v1/ContentAndApprovals
// Twilio'da "numarayı etkinleştir" (Meta register) ve "webhook aboneliği" (subscribed_apps) adımları YOKTUR.

import { SHARED_WA_DISPLAY_NAME, WA_PROVIDER_LABELS, formatPhone } from '@siparis/core';
import type { AdminWaSetupTest, AdminWaSetupTone, AdminWaSetupWebhook } from '@siparis/core/admin/contracts';
import { platformDisplayPhone } from '../../config';
import { AppError, conflict } from '../../lib/errors';
import { isGraphApiError, type GraphApiError } from '../../wa/graph-admin';
import { TWILIO_API_BASE, TWILIO_CONTENT_BASE, twilioCall, type TwilioTarget } from '../../wa/twilio-api';
import { CONTENT_LANGUAGE, cacheContentSid } from '../../wa/twilio-content';
import type { TemplateDef } from '../messaging/template-bodies';
import {
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

export const TWILIO_SENDERS_URL = 'https://messaging.twilio.com/v2/Channels/Senders';

/** Hata bağlamı: gönderen listesi, webhook yazımı, tek şablon, şablon listesi, hesap. */
export type TwilioContext = 'senders' | 'webhook' | 'template' | 'templates' | 'account';

/** Twilio hatası → Türkçe, yapılacak işi söyleyen AppError (502; ön koşul hataları 409). */
export function twilioErrorToAppError(err: GraphApiError, ctx: TwilioContext): AppError {
  const status = err.httpStatus;
  // twilio-api.ts kodu Meta karşılığına çevirir; Twilio'nun kendi kodu subcode'da durur
  const twilioCode = err.subcode ?? err.code;
  const ref = [status ? `HTTP ${status}` : null, /^\d+$/.test(twilioCode) ? `Twilio hata ${twilioCode}` : null].filter(Boolean).join(', ') || err.code;
  const e = (c: string, message: string) => new AppError(502, c, message, { graphCode: err.code, graphSubcode: err.subcode, httpStatus: status });

  if (err.code === 'network' || err.code === 'timeout') {
    return e('twilio_unreachable', `${err.message}. İnternet bağlantısını kontrol edip biraz sonra tekrar deneyin.`);
  }
  if (status === 401 || twilioCode === '20003') {
    return e(
      'twilio_auth_invalid',
      `Twilio kimlik bilgileri geçersiz (${ref}). console.twilio.com › Account Info bölümünden Account SID ve Auth Token'ı yeniden kopyalayın, ` +
        `${envName('PLATFORM_WA_PHONE_NUMBER_ID', 'twilio')} ve ${envName('PLATFORM_WA_API_KEY', 'twilio')} değerlerini güncelleyip iş akışını çalıştırın.`,
    );
  }
  if (status === 429 || RATE_LIMIT_CODES.has(err.code) || twilioCode === '20429') {
    return e('twilio_rate_limited', `Twilio istek sınırına takıldı (${ref}). Birkaç dakika bekleyip tekrar deneyin.`);
  }
  if (twilioCode === '20005') {
    return e('twilio_account_suspended', `Twilio hesabı askıya alınmış (${ref}). console.twilio.com'da bakiye ve hesap durumunu kontrol edin.`);
  }
  if (status === 403) {
    return e(
      'twilio_forbidden',
      `Twilio bu işlemi reddetti (${ref}): kimlik bilgilerinin bu işlem için yetkisi yok ya da hesap kısıtlı.` + (err.message ? ` Ayrıntı: ${err.message}` : ''),
    );
  }
  if (status === 404) {
    return e(
      'twilio_not_found',
      ctx === 'senders' || ctx === 'webhook'
        ? `Twilio WhatsApp gönderenini bulamadı (${ref}). console.twilio.com › Messaging › Senders › WhatsApp senders bölümünde numaranın kayıtlı olduğundan emin olun.`
        : `Twilio bu uç noktayı bulamadı (${ref}). docs/15 §6.3b'deki elle (curl) komutlarla deneyin.`,
    );
  }
  if (status != null && status >= 500) return e('twilio_unavailable', `Twilio geçici olarak yanıt vermiyor (${ref}). Biraz sonra tekrar deneyin.`);
  const detail = err.message;
  return e('twilio_error', `Twilio isteği reddetti (${ref}): ${detail}`.slice(0, 600));
}

async function tw<T>(ctx: TwilioContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isGraphApiError(err)) throw twilioErrorToAppError(err, ctx);
    throw err;
  }
}

/** twilio + kimlik; değilse 409 (mock: wa_setup_mock, başka sağlayıcı: wa_setup_not_twilio, eksik: wa_setup_missing). */
export function requireTwilio(c: WaSetupConfig): TwilioTarget {
  requireRealProvider(c);
  if (c.PLATFORM_WA_PROVIDER !== 'twilio') {
    throw conflict(
      'wa_setup_not_twilio',
      `Bu adım yalnız Twilio'da çalışır; şu anki sağlayıcı: ${WA_PROVIDER_LABELS[c.PLATFORM_WA_PROVIDER]}.`,
    );
  }
  if (!c.PLATFORM_WA_PHONE_NUMBER_ID) throw conflict('wa_setup_missing', `Twilio Account SID tanımlı değil: ${envName('PLATFORM_WA_PHONE_NUMBER_ID', 'twilio')}.`);
  if (!c.PLATFORM_WA_API_KEY) throw conflict('wa_setup_missing', `Twilio Auth Token tanımlı değil: ${envName('PLATFORM_WA_API_KEY', 'twilio')}.`);
  return { accountSid: c.PLATFORM_WA_PHONE_NUMBER_ID, authToken: c.PLATFORM_WA_API_KEY };
}

// ---------------------------------------------------------------------------
// WhatsApp gönderenleri (Messaging v2)

export interface TwilioSenderWebhook {
  callback_url?: string | null;
  callback_method?: string | null;
  status_callback_url?: string | null;
  status_callback_method?: string | null;
}

export interface TwilioSender {
  sid?: string;
  status?: string;
  sender_id?: string;
  webhook?: TwilioSenderWebhook | null;
  profile?: { name?: string | null } | null;
  properties?: { quality_rating?: string | null; messaging_limit?: string | null } | null;
  offline_reasons?: { code?: string | null; message?: string | null }[] | null;
}

interface SendersResponse {
  senders?: TwilioSender[];
  meta?: { next_page_url?: string | null };
}

/** Hesaptaki WhatsApp gönderenleri (en çok 5 sayfa × 50). */
export async function listWhatsappSenders(t: TwilioTarget): Promise<TwilioSender[]> {
  const out: TwilioSender[] = [];
  let url: string | null = `${TWILIO_SENDERS_URL}?Channel=whatsapp&PageSize=50`;
  for (let page = 0; page < 5 && url; page++) {
    const res: SendersResponse = await twilioCall<SendersResponse>(t, 'GET', url);
    out.push(...(res.senders ?? []));
    url = res.meta?.next_page_url ?? null;
  }
  return out;
}

/** Ortak numaranın gönderen kaydı (sender_id = whatsapp:<E.164>); yoksa null. */
export function findSender(senders: TwilioSender[], displayPhone: string | null): TwilioSender | null {
  if (!displayPhone) return senders[0] ?? null;
  const want = digits(displayPhone);
  return senders.find((s) => digits(str(s.sender_id) ?? '') === want) ?? null;
}

const SENDER_STATUS: ToneMap = {
  ONLINE: ['Çevrimiçi (mesaj gönderebilir)', 'ok'],
  'ONLINE:UPDATING': ['Çevrimiçi (güncelleniyor)', 'ok'],
  OFFLINE: ['Çevrimdışı', 'bad'],
  PENDING_VERIFICATION: ['Numara doğrulaması bekleniyor', 'warn'],
  VERIFYING: ['Doğrulanıyor', 'warn'],
  TWILIO_REVIEW: ['Twilio incelemesinde', 'warn'],
  CREATING: ['Oluşturuluyor', 'warn'],
  DRAFT: ['Taslak (tamamlanmamış)', 'bad'],
  STUBBED: ['Taslak (tamamlanmamış)', 'bad'],
};

// ---------------------------------------------------------------------------
// Webhook

const expectedWebhook = (c: WaSetupConfig) => (c.PLATFORM_WA_WEBHOOK_TOKEN ? `${sharedWebhookPrefix(c)}${c.PLATFORM_WA_WEBHOOK_TOKEN}` : null);
const sameUrl = (a: string | null | undefined, b: string | null) => !!a && !!b && a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/** Belirteç maskeli webhook adresi (ortak adresimizde son 4 karakter; başka adreste uzun yol parçaları). */
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

function webhookResult(c: WaSetupConfig, current: string | null, changed: boolean): Omit<AdminWaSetupWebhook, 'message'> {
  return {
    configured: !!current,
    matches: sameUrl(current, expectedWebhook(c)),
    changed,
    urlMasked: current ? maskWebhookUrl(current, c) : null,
    expectedUrlMasked: maskedSharedWebhook(c),
  };
}

const REGISTER_HINT = '"Webhook\'u Twilio\'ya kaydet" düğmesine basın.';

function viewMessage(r: Omit<AdminWaSetupWebhook, 'message'>): string {
  if (!r.expectedUrlMasked) return 'Ortak webhook belirteci tanımlı değil (PLATFORM_WA_WEBHOOK_TOKEN): kaydedilecek adres oluşmaz.';
  if (!r.configured) return `Twilio'da kayıtlı webhook yok: müşteri mesajları sisteme ulaşmaz. ${REGISTER_HINT}`;
  if (!r.matches) return `Twilio'daki webhook başka bir adrese gidiyor: müşteri mesajları bu sisteme ulaşmaz. ${REGISTER_HINT}`;
  return "Twilio'daki webhook bu sistemin ortak webhook adresine gidiyor.";
}

/** Ortak numaranın gönderen kaydını getirir; bulunamazsa 409. */
async function requireSender(c: WaSetupConfig, t: TwilioTarget): Promise<TwilioSender> {
  const senders = await tw('senders', () => listWhatsappSenders(t));
  const phone = platformDisplayPhone(c);
  const sender = findSender(senders, phone);
  if (!sender?.sid) {
    throw conflict(
      'twilio_sender_missing',
      phone
        ? `Twilio hesabında ${formatPhone(phone)} numarasına ait WhatsApp gönderen kaydı yok. console.twilio.com › Messaging › Senders › WhatsApp senders bölümünden numarayı ekleyin (doğrulama yöntemi: sesli arama).`
        : "Twilio hesabında hiç WhatsApp gönderen kaydı yok. console.twilio.com › Messaging › Senders › WhatsApp senders bölümünden numarayı ekleyin.",
    );
  }
  return sender;
}

export async function readTwilioWebhook(c: WaSetupConfig): Promise<AdminWaSetupWebhook> {
  const t = requireTwilio(c);
  const sender = await requireSender(c, t);
  const current = str(sender.webhook?.callback_url);
  const r = webhookResult(c, current, false);
  return { ...r, message: viewMessage(r) };
}

/**
 * Ortak webhook adresini Twilio gönderenine yazar: POST /v2/Channels/Senders/{XE…} {webhook:{…}}. Gelen mesaj
 * (callback_url) ve durum geri bildirimi (status_callback_url) aynı adrese gider; ikisi de POST'tur. Adres zaten
 * doğruysa yazılmaz (idempotent).
 */
export async function registerTwilioWebhook(c: WaSetupConfig): Promise<AdminWaSetupWebhook> {
  const t = requireTwilio(c);
  const expected = expectedWebhook(c);
  if (!expected) {
    throw conflict(
      'wa_setup_missing',
      'Ortak webhook belirteci tanımlı değil (PLATFORM_WA_WEBHOOK_TOKEN): kaydedilecek adres oluşmaz. Canlı ortamda iş akışı kendiliğinden üretir; yeniden dağıtın.',
    );
  }
  requireHttpsBase(c, 'Twilio webhook adresi https olmalı');
  const sender = await requireSender(c, t);
  const current = str(sender.webhook?.callback_url);
  const statusCurrent = str(sender.webhook?.status_callback_url);
  if (sameUrl(current, expected) && sameUrl(statusCurrent, expected)) {
    return { ...webhookResult(c, current, false), message: 'Webhook zaten bu sistemin adresine kayıtlı; değişiklik yapılmadı.' };
  }

  const res = await tw('webhook', () =>
    twilioCall<TwilioSender>(t, 'POST', `${TWILIO_SENDERS_URL}/${encodeURIComponent(sender.sid!)}`, {
      json: {
        webhook: {
          callback_url: expected,
          callback_method: 'POST',
          status_callback_url: expected,
          status_callback_method: 'POST',
        },
      },
    }),
  );
  const after = str(res.webhook?.callback_url) ?? expected;
  const r = webhookResult(c, after, true);
  return {
    ...r,
    message: r.matches
      ? "Webhook Twilio'ya kaydedildi: müşteri mesajları ve durum bildirimleri artık bu sisteme gelir. Denemek için kendi telefonunuzdan ortak numaraya bir dükkan kodu (#KOD) yazın; Admin › WhatsApp'taki \"Son webhook\" güncellenmeli."
      : "Twilio kaydı onayladı ama okunan adres farklı görünüyor: birkaç saniye sonra \"Kayıtlı adresi göster\" ile tekrar bakın.",
  };
}

// ---------------------------------------------------------------------------
// Bağlantı testi

interface TwilioAccount {
  sid?: string;
  friendly_name?: string;
  status?: string;
  type?: string;
}

export async function testConnectionTwilio(c: WaSetupConfig): Promise<AdminWaSetupTest> {
  const t = requireTwilio(c);
  const account = await tw('account', () =>
    twilioCall<TwilioAccount>(t, 'GET', `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(t.accountSid)}.json`),
  );
  const senders = await tw('senders', () => listWhatsappSenders(t));
  const configured = platformDisplayPhone(c);
  const sender = findSender(senders, configured);

  const senderPhone = sender ? (str(sender.sender_id)?.replace(/^whatsapp:/i, '') ?? null) : null;
  const match = !!senderPhone && !!configured && digits(senderPhone) === digits(configured);
  const expected = expectedWebhook(c);
  const webhookUrl = str(sender?.webhook?.callback_url);
  const hookOk = sameUrl(webhookUrl, expected);
  const statusHookOk = sameUrl(str(sender?.webhook?.status_callback_url), expected);
  const status = (str(sender?.status) ?? '').toUpperCase();

  const rows: AdminWaSetupTest['rows'] = [];
  const hints: string[] = [];

  rows.push({
    label: 'Twilio kimlik bilgileri',
    value: `Geçerli (${str(account.friendly_name) ?? t.accountSid.slice(0, 10)}…)`,
    tone: 'ok',
  });
  const accountStatus = (str(account.status) ?? '').toLowerCase();
  if (accountStatus && accountStatus !== 'active') {
    rows.push({ label: 'Twilio hesabı', value: accountStatus === 'suspended' ? 'Askıya alınmış' : accountStatus, tone: 'bad' });
    hints.push('Twilio hesabı etkin değil: console.twilio.com\'da bakiye ve hesap durumunu kontrol edin; bu durumda hiçbir mesaj gönderilemez.');
  }
  if (str(account.type)?.toLowerCase() === 'trial') {
    rows.push({ label: 'Hesap türü', value: 'Deneme (trial)', tone: 'warn' });
    hints.push('Twilio deneme hesabı: yalnız doğrulanmış numaralara mesaj gider ve mesajların başına Twilio uyarısı eklenir. Canlıya çıkmadan önce hesabı yükseltin.');
  }
  rows.push({
    label: 'Numara (Twilio)',
    value: senderPhone ? formatPhone(senderPhone) : senders.length ? 'Farklı numara kayıtlı' : 'WhatsApp gönderen kaydı yok',
    tone: senderPhone ? 'info' : 'bad',
  });
  rows.push({
    label: 'Sistemdeki numara',
    value: !configured ? 'Tanımlı değil' : match ? `${formatPhone(configured)} (eşleşiyor)` : `${formatPhone(configured)} (farklı)`,
    tone: match ? 'ok' : 'bad',
  });
  const [statusLabel, statusTone] = toneLabel(SENDER_STATUS, status || null);
  rows.push({ label: 'Gönderen durumu', value: statusLabel, tone: statusTone });
  const profileName = str(sender?.profile?.name);
  const nameOk = !!profileName && profileName.trim().toLocaleLowerCase('tr') === SHARED_WA_DISPLAY_NAME.toLocaleLowerCase('tr');
  rows.push({ label: 'Görünen ad', value: profileName ?? 'Bilinmiyor', tone: nameOk ? 'ok' : 'warn' });
  const [qLabel, qTone] = toneLabel(QUALITY, (str(sender?.properties?.quality_rating) ?? '').toUpperCase() || null, 'info');
  rows.push({ label: 'Kalite', value: qLabel, tone: qTone });
  const limit = str(sender?.properties?.messaging_limit);
  if (limit) rows.push({ label: 'Günlük iletişim sınırı', value: limit, tone: 'info' });

  let hookValue: string;
  let hookTone: AdminWaSetupTone;
  if (!sender) [hookValue, hookTone] = ['Gönderen bulunamadı', 'bad'];
  else if (!webhookUrl) [hookValue, hookTone] = ['Kayıtlı değil', 'bad'];
  else [hookValue, hookTone] = [`${maskWebhookUrl(webhookUrl, c)} (${hookOk ? 'doğru' : 'farklı adres'})`, hookOk ? 'ok' : 'bad'];
  rows.push({ label: 'Webhook (Twilio)', value: hookValue, tone: hookTone });
  if (sender && hookOk && !statusHookOk) {
    rows.push({ label: 'Durum bildirimi', value: 'Ayrı adrese gidiyor', tone: 'warn' });
    hints.push(
      'Gelen mesaj webhook\'u doğru ama durum bildirimi (status callback) başka adrese gidiyor: "teslim edildi / okundu" bilgileri panele düşmez. ' +
        REGISTER_HINT,
    );
  }

  if (!sender) {
    hints.push(
      configured
        ? `Twilio hesabında ${formatPhone(configured)} numarasına ait WhatsApp gönderen kaydı yok. console.twilio.com › Messaging › Senders › WhatsApp senders bölümünden numarayı ekleyin; SMS alamayan numaralarda doğrulama yöntemi olarak "Phone call" seçin.`
        : 'Twilio hesabında WhatsApp gönderen kaydı yok.',
    );
  }
  if (sender && !hookOk) {
    hints.push(
      webhookUrl
        ? `Twilio'daki webhook başka bir adrese gidiyor: aşağıdaki ${REGISTER_HINT}`
        : `Webhook Twilio'ya kayıtlı değil: aşağıdaki ${REGISTER_HINT} Kayıt olmadan müşteri mesajları sisteme ulaşmaz.`,
    );
  }
  for (const reason of (sender?.offline_reasons ?? []).slice(0, 5)) {
    const text = `Twilio (${str(reason.code) ?? 'durum'}): ${str(reason.message) ?? 'açıklama yok'}`;
    hints.push(text.slice(0, 400));
  }
  if (status === 'PENDING_VERIFICATION' || status === 'VERIFYING') {
    hints.push('Numara doğrulaması tamamlanmamış: Twilio Console\'da doğrulama kodunu girin (SMS alamayan numaralarda "Phone call" ile arama gelir).');
  }
  if (profileName && !nameOk) hints.push(`Twilio'daki görünen ad "${profileName}"; ortak numaranın adı "${SHARED_WA_DISPLAY_NAME}" olmalı.`);
  if (configured && senderPhone && !match) {
    hints.push(
      `${envName('PLATFORM_WA_DISPLAY_PHONE', 'twilio')} Twilio'daki gönderen numarasıyla aynı değil: QR ve wa.me bağlantıları yanlış numaraya gider. Değeri düzeltip yeniden dağıtın.`,
    );
  }

  const ready = !!sender && hookOk && statusHookOk && (status === 'ONLINE' || status === 'ONLINE:UPDATING');
  return {
    ready,
    phone: {
      id: str(sender?.sid) ?? '',
      displayPhoneNumber: senderPhone,
      verifiedName: profileName,
      // Twilio'da Meta'nın ad onayı durumu ayrı alan olarak gelmez: gönderen durumu onu da kapsar
      nameStatus: null,
      qualityRating: (str(sender?.properties?.quality_rating) ?? '').toUpperCase() || null,
      codeVerificationStatus: status || null,
      platformType: 'TWILIO',
      throughputLevel: limit,
    },
    rows,
    hints,
  };
}

// ---------------------------------------------------------------------------
// Şablonlar (Content API + WhatsApp onayı)

/** Şablon tanımı → Twilio Content kaynağı gövdesi. Gövde değişkenleri {{1}}..{{n}}; URL butonu sonraki numarayı alır. */
export function twilioContentPayload(def: TemplateDef, appBaseUrl: string): Record<string, unknown> {
  const base = appBaseUrl.replace(/\/+$/, '');
  const variables: Record<string, string> = {};
  def.params.forEach((_, i) => {
    variables[String(i + 1)] = def.examples[i] ?? '';
  });
  let next = def.params.length + 1;

  const urlButtons = def.buttons.filter((b) => b.type === 'url');
  const quickReplies = def.buttons.filter((b) => b.type === 'quick_reply');

  let types: Record<string, unknown>;
  if (urlButtons.length) {
    types = {
      'twilio/call-to-action': {
        body: def.body,
        actions: urlButtons.map((b) => {
          if (b.type !== 'url') throw new Error('unreachable');
          if (b.dynamic) {
            const idx = next++;
            variables[String(idx)] = b.example;
            return { type: 'URL', title: b.text, url: `${base}${b.path}{{${idx}}}` };
          }
          return { type: 'URL', title: b.text, url: `${base}${b.path}` };
        }),
      },
    };
  } else if (quickReplies.length) {
    types = {
      'twilio/quick-reply': {
        body: def.body,
        actions: quickReplies.map((b, i) => ({ type: 'QUICK_REPLY', title: b.text, id: `tpl_${i + 1}` })),
      },
    };
  } else {
    types = { 'twilio/text': { body: def.body } };
  }

  return { friendly_name: def.name, language: CONTENT_LANGUAGE, variables, types };
}

interface ContentApproval {
  status?: string;
  category?: string;
  rejection_reason?: string;
  name?: string;
}

interface ContentAndApproval {
  sid?: string;
  friendly_name?: string;
  language?: string;
  approval_requests?: ContentApproval | null;
  whatsapp?: ContentApproval | null;
}

interface ContentAndApprovalsResponse {
  contents?: ContentAndApproval[];
  meta?: { next_page_url?: string | null };
}

/** Twilio onay durumu → Meta şablon durumu sözlüğüne uyan büyük harfli değer (wa-setup.ts TEMPLATE_STATUS). */
export function approvalToTemplateStatus(v: string | null | undefined): string | null {
  switch ((v ?? '').toLowerCase()) {
    case 'approved':
      return 'APPROVED';
    case 'pending':
    case 'received':
      return 'PENDING';
    case 'rejected':
      return 'REJECTED';
    case 'paused':
      return 'PAUSED';
    case 'disabled':
      return 'DISABLED';
    case 'unsubmitted':
      // Kaynak var ama WhatsApp onayına gönderilmemiş: pencere içi mesajlarda çalışır, şablon olarak çalışmaz
      return 'SUBMITTED';
    default:
      return v ? v.toUpperCase() : null;
  }
}

/** Twilio içerik + onay listesi (en çok 10 sayfa × 100); ContentSid'ler gönderim önbelleğine de yazılır. */
export async function listTwilioTemplates(t: TwilioTarget): Promise<ContentAndApproval[]> {
  const out: ContentAndApproval[] = [];
  let url: string | null = `${TWILIO_CONTENT_BASE}/ContentAndApprovals?PageSize=100`;
  for (let page = 0; page < 10 && url; page++) {
    const res: ContentAndApprovalsResponse = await twilioCall<ContentAndApprovalsResponse>(t, 'GET', url);
    for (const c of res.contents ?? []) {
      out.push(c);
      if (c.sid && c.friendly_name) cacheContentSid(c.friendly_name, c.sid);
    }
    url = res.meta?.next_page_url ?? null;
  }
  return out;
}

export interface TwilioTemplateRow {
  name?: string;
  status?: string;
  category?: string;
  language?: string;
  rejected_reason?: string;
}

/** Twilio listesi → wa-setup.ts'in beklediği (Graph biçimli) şablon satırları. */
export function toTemplateRows(contents: ContentAndApproval[]): TwilioTemplateRow[] {
  return contents.map((c) => {
    const ap = c.approval_requests ?? c.whatsapp ?? null;
    return {
      name: c.friendly_name,
      status: approvalToTemplateStatus(ap?.status) ?? undefined,
      category: ap?.category ? String(ap.category).toUpperCase() : undefined,
      language: c.language,
      rejected_reason: ap?.rejection_reason || undefined,
    };
  });
}

/** Şablonu Twilio'da oluşturur ve WhatsApp onayına gönderir. */
export async function createTwilioTemplate(t: TwilioTarget, def: TemplateDef, appBaseUrl: string): Promise<void> {
  const created = await twilioCall<{ sid?: string }>(t, 'POST', `${TWILIO_CONTENT_BASE}/Content`, {
    json: twilioContentPayload(def, appBaseUrl),
  });
  if (!created.sid) throw new AppError(502, 'twilio_error', `Twilio "${def.name}" için içerik kimliği dönmedi.`);
  cacheContentSid(def.name, created.sid);
  await twilioCall(t, 'POST', `${TWILIO_CONTENT_BASE}/Content/${encodeURIComponent(created.sid)}/ApprovalRequests/whatsapp`, {
    json: { name: def.name, category: def.category },
  });
}

/** 360dialog/Graph'taki "zaten var" karşılığı: aynı friendly_name ikinci kez onaya gönderilemez. */
export function twilioAlreadyExists(err: GraphApiError): boolean {
  const re = /already (exists|submitted|approved)|duplicate/i;
  return re.test(err.message) || re.test(err.userMessage ?? '');
}

export { baseUrl as twilioBaseUrl };
