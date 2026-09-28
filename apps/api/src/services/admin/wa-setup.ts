// Ortak numara "WhatsApp kurulumu" (admin, yalnız platform_owner; 15 §6.2a). Üç sağlayıcı:
//   - 360dialog (d360, VARSAYILAN, 15 §6.2): proje sahibi 360dialog Hub'da numarayı bağlar ve API anahtarını üretir; buradan
//     bağlantı testi, webhook kaydı ve şablon gönderimi yapılır (wa-setup-d360.ts). Numara kaydı ve abonelik 360dialog'dadır.
//   - Meta Cloud API doğrudan (cloud, alternatif, 15 §6.2b): Meta'da yalnız tıklama yapılır ve beş değer girilir; gerisi
//     Graph API ile buradan:
//       - Meta'ya girilecek bilgiler: ortak webhook adresi + doğrulama belirteci (ayrı, denetlenen "Göster" çağrısı)
//       - bağlantı testi: GET /{phone_number_id}?fields=…
//       - numarayı etkinleştir: POST /{phone_number_id}/register {messaging_product, pin}
//       - webhook aboneliği: POST/GET /{waba_id}/subscribed_apps
//   - Twilio (twilio, alternatif, 15 §6.2d; 16): numara Twilio Console'da WhatsApp gönderen olarak bağlanır; bağlantı
//     testi, webhook kaydı (Messaging v2 Senders) ve şablonlar (Content API + WhatsApp onayı) wa-setup-twilio.ts'te.
// Ortak: durum (hangi değerler tanımlı; gizliler yalnız son 4 karakter, hangi adımlar çalışabilir) ve şablonlar: kod
// kataloğundaki (template-bodies.ts) her şablon sağlayıcıda yoksa oluşturulur (Graph: /{waba_id}/message_templates,
// 360dialog: /message_templates — aynı gövde ve yanıt; var olana dokunulmaz, hiçbir şey silinmez), sonra durumlar listelenir.
// Sağlayıcı hataları Türkçe ve yapılacak işi söyleyen AppError'a çevrilir (token/anahtar, izin, yanlış kimlik, PIN, hız sınırı).

import { SHARED_WA_DISPLAY_NAME, WA_PROVIDER_LABELS, formatPhone } from '@siparis/core';
import type {
  AdminWaSetupRegister,
  AdminWaSetupReveal,
  AdminWaSetupStatus,
  AdminWaSetupSubscription,
  AdminWaSetupTest,
  AdminWaSetupTone,
  AdminWaSetupWebhook,
  AdminWaTemplateStatus,
  AdminWaTemplates,
} from '@siparis/core/admin/contracts';
import { platformDisplayPhone } from '../../config';
import { AppError, conflict } from '../../lib/errors';
import { adminApiCall, d360Target, graphCall, graphTarget, isGraphApiError, type AdminApiTarget, type GraphApiError } from '../../wa/graph-admin';
import { GRAPH_API_VERSION, GRAPH_BASE_URL } from '../../wa/providers/cloud';
import { D360_BASE_URL, D360_TEMPLATES_PATH } from '../../wa/providers/d360';
import { WA_TEMPLATE_CATALOG, type TemplateDef } from '../messaging/template-bodies';
import {
  NAME_STATUS,
  QUALITY,
  RATE_LIMIT_CODES,
  baseUrl,
  digits,
  envName as envNameFor,
  maskedSharedWebhook,
  requireHttpsBase,
  requireRealProvider,
  tail,
  toneLabel as label,
  type ToneMap,
  type WaSetupConfig,
} from './wa-setup-common';
import { d360ErrorToAppError, d360HostProblem, readD360Webhook, registerD360Webhook, testConnectionD360 } from './wa-setup-d360';
import {
  createTwilioTemplate,
  listTwilioTemplates,
  readTwilioWebhook,
  registerTwilioWebhook,
  requireTwilio,
  testConnectionTwilio,
  toTemplateRows,
  twilioAlreadyExists,
  twilioErrorToAppError,
} from './wa-setup-twilio';
import { TWILIO_API_BASE } from '../../wa/twilio-api';

export type { WaSetupConfig } from './wa-setup-common';
export { readD360Webhook, registerD360Webhook } from './wa-setup-d360';
export { readTwilioWebhook, registerTwilioWebhook } from './wa-setup-twilio';

/**
 * "Kayıtlı adresi göster": webhook adresini sağlayıcıdan okur (d360: /v1/configs/webhook, twilio: WhatsApp gönderen
 * kaydı). Meta doğrudan yolda adres Meta'ya elle girilir; orası 409 döner.
 */
export async function readWebhook(c: WaSetupConfig): Promise<AdminWaSetupWebhook> {
  if (c.PLATFORM_WA_PROVIDER === 'twilio') return readTwilioWebhook(c);
  return readD360Webhook(c);
}

/** "Webhook'u kaydet": ortak webhook adresini sağlayıcıya yazar (idempotent). */
export async function registerWebhook(c: WaSetupConfig): Promise<AdminWaSetupWebhook> {
  if (c.PLATFORM_WA_PROVIDER === 'twilio') return registerTwilioWebhook(c);
  return registerD360Webhook(c);
}

/** Meta doğrudan yolun ortam değişkeni adı + canlı ortam secret'ı (graph hata metinleri). */
const envName = (name: string) => envNameFor(name, 'cloud');
const numeric = (v: string | undefined) => !v || /^\d{5,30}$/.test(v);
const hostOf = (u: string) => u.replace(/^https?:\/\//, '');

// ---------------------------------------------------------------------------
// Durum ve Meta'ya girilecek bilgiler

export function setupStatus(c: WaSetupConfig): AdminWaSetupStatus {
  const provider = c.PLATFORM_WA_PROVIDER;
  const cloud = provider === 'cloud';
  const d360 = provider === 'd360';
  const twilio = provider === 'twilio';
  const display = platformDisplayPhone(c);
  const token = c.PLATFORM_WA_WEBHOOK_TOKEN ?? null;
  const verifyDefault = !c.WA_VERIFY_TOKEN.trim() || c.WA_VERIFY_TOKEN === 'dev-verify';
  const https = baseUrl(c).startsWith('https://');
  const problems: string[] = [];

  if (provider === 'mock') {
    problems.push(
      'Sağlayıcı simülatör (mock): gerçek WhatsApp bağlı değil. Varsayılan yol 360dialog: GitHub secret\'ları D360_API_KEY ve WA_PHONE\'u ekleyip ' +
        'Actions › "Canlı ortam (Cloudflare)" › Run workflow (docs/15 §6.2). Twilio yolu: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, WA_PHONE (docs/15 §6.2d). ' +
        'Meta doğrudan yol: META_WA_TOKEN, META_WA_PHONE_NUMBER_ID, META_WA_WABA_ID, META_APP_SECRET, WA_PHONE (docs/15 §6.2b).',
    );
  }
  if (d360 && !c.PLATFORM_WA_API_KEY) problems.push(`360dialog API anahtarı tanımlı değil: ${envNameFor('PLATFORM_WA_API_KEY', 'd360')}.`);
  if (twilio) {
    if (!c.PLATFORM_WA_API_KEY) problems.push(`Twilio Auth Token tanımlı değil: ${envNameFor('PLATFORM_WA_API_KEY', 'twilio')}.`);
    if (!c.PLATFORM_WA_PHONE_NUMBER_ID) {
      problems.push(`Twilio Account SID tanımlı değil: ${envNameFor('PLATFORM_WA_PHONE_NUMBER_ID', 'twilio')}.`);
    } else if (!/^AC[0-9a-fA-F]{32}$/.test(c.PLATFORM_WA_PHONE_NUMBER_ID)) {
      problems.push('Twilio Account SID "AC" ile başlayan 34 karakter olmalı (console.twilio.com › Account Info). Telefon numarası ya da API Key SID değildir.');
    }
  }
  if (cloud) {
    if (!c.PLATFORM_WA_API_KEY) problems.push(`Erişim anahtarı (token) tanımlı değil: ${envName('PLATFORM_WA_API_KEY')}.`);
    if (!c.PLATFORM_WA_PHONE_NUMBER_ID) problems.push(`Telefon numarası kimliği (Phone number ID) tanımlı değil: ${envName('PLATFORM_WA_PHONE_NUMBER_ID')}.`);
    if (!c.WA_APP_SECRET) problems.push(`Uygulama gizli anahtarı (App secret) tanımlı değil: ${envName('WA_APP_SECRET')}. Webhook imzası doğrulanamaz.`);
    if (!c.PLATFORM_WA_WABA_ID) {
      problems.push(`WhatsApp Business hesap kimliği (WABA ID) tanımlı değil: ${envName('PLATFORM_WA_WABA_ID')}. "Webhook aboneliğini aç" ve "Şablonları gönder" çalışmaz.`);
    }
    if (!numeric(c.PLATFORM_WA_PHONE_NUMBER_ID)) problems.push('Telefon numarası kimliği yalnız rakamlardan oluşmalı (Meta › WhatsApp › API Setup › Phone number ID). Telefon numarasının kendisi değildir.');
    if (!numeric(c.PLATFORM_WA_WABA_ID)) problems.push('WABA kimliği yalnız rakamlardan oluşmalı (Meta › WhatsApp › API Setup › WhatsApp Business Account ID).');
    if (c.PLATFORM_WA_WABA_ID && c.PLATFORM_WA_WABA_ID === c.PLATFORM_WA_PHONE_NUMBER_ID) {
      problems.push('Telefon numarası kimliği ile WABA kimliği aynı: ikisi farklı değerlerdir, API Setup sayfasından ayrı ayrı kopyalayın.');
    }
  }
  // Alt çizgili alan adı / port kuralı 360dialog'a özeldir; Twilio böyle bir kısıt koymaz
  const hostProblem = d360 ? d360HostProblem(c) : null;
  if (provider !== 'mock') {
    if (!display) problems.push(`Ortak numara tanımlı değil: ${envNameFor('PLATFORM_WA_DISPLAY_PHONE', provider)} (E.164, ör. +905321234567).`);
    if (!token) {
      const where = d360 ? "360dialog'a kaydedilecek" : twilio ? "Twilio'ya kaydedilecek" : "Meta'ya girilecek";
      problems.push(`Ortak webhook belirteci tanımlı değil (PLATFORM_WA_WEBHOOK_TOKEN): ${where} webhook adresi oluşmaz.`);
    }
    // Doğrulama belirteci yalnız Meta'nın webhook GET doğrulamasında kullanılır (360dialog doğrulama isteği göndermez)
    if (cloud && verifyDefault) problems.push('Doğrulama belirteci (WA_VERIFY_TOKEN) varsayılan değerde: Meta\'ya girmeden önce rastgele bir değer verin (openssl rand -hex 16).');
    if (!https) problems.push('APP_BASE_URL https ile başlamıyor: webhook adresi ve şablon butonları https ister.');
    if (hostProblem) problems.push(hostProblem);
  }

  const graphReady = cloud && !!c.PLATFORM_WA_API_KEY;
  const d360Ready = d360 && !!c.PLATFORM_WA_API_KEY;
  const twilioReady = twilio && !!c.PLATFORM_WA_API_KEY && !!c.PLATFORM_WA_PHONE_NUMBER_ID;
  return {
    provider,
    providerLabel: WA_PROVIDER_LABELS[provider],
    displayName: SHARED_WA_DISPLAY_NAME,
    displayPhone: display,
    displayPhoneFormatted: display ? formatPhone(display) : null,
    graphApiVersion: GRAPH_API_VERSION,
    apiBase: d360
      ? hostOf(D360_BASE_URL)
      : twilio
        ? hostOf(TWILIO_API_BASE)
        : cloud
          ? `${hostOf(GRAPH_BASE_URL)}/${GRAPH_API_VERSION}`
          : 'Yok (simülatör)',
    fields: {
      phoneNumberId: { set: !!c.PLATFORM_WA_PHONE_NUMBER_ID, tail: tail(c.PLATFORM_WA_PHONE_NUMBER_ID) },
      wabaId: { set: !!c.PLATFORM_WA_WABA_ID, tail: tail(c.PLATFORM_WA_WABA_ID) },
      apiKey: { set: !!c.PLATFORM_WA_API_KEY, tail: tail(c.PLATFORM_WA_API_KEY) },
      appSecret: { set: !!c.WA_APP_SECRET, tail: tail(c.WA_APP_SECRET) },
      webhookToken: { set: !!token, tail: tail(token) },
      verifyToken: { set: !verifyDefault, tail: verifyDefault ? null : tail(c.WA_VERIFY_TOKEN), isDefault: verifyDefault },
    },
    webhookUrlMasked: maskedSharedWebhook(c),
    actions: {
      test: (graphReady && !!c.PLATFORM_WA_PHONE_NUMBER_ID) || d360Ready || twilioReady,
      // Numarayı etkinleştir / webhook aboneliği yalnız Meta doğrudan yolda vardır
      register: graphReady && !!c.PLATFORM_WA_PHONE_NUMBER_ID,
      subscribe: graphReady && !!c.PLATFORM_WA_WABA_ID,
      templates: ((graphReady && !!c.PLATFORM_WA_WABA_ID) || d360Ready || twilioReady) && https,
      // Webhook'u sağlayıcıya yazma: 360dialog ve Twilio (Meta'da adres elle girilir)
      webhook: (d360Ready || twilioReady) && !!token && https && !hostProblem,
    },
    problems,
  };
}

/** Meta › WhatsApp › Configuration'a girilecek tam değerler (yalnız "Göster" ile; çağıran denetim kaydı yazar). */
export function revealSetup(c: WaSetupConfig): AdminWaSetupReveal {
  const token = c.PLATFORM_WA_WEBHOOK_TOKEN;
  return {
    webhookUrl: token ? `${baseUrl(c)}/api/v1/webhooks/wa/shared/${token}` : null,
    verifyToken: c.WA_VERIFY_TOKEN,
    webhookField: 'messages',
  };
}

// ---------------------------------------------------------------------------
// Ön koşullar ve Graph hata eşlemesi

type GraphContext = 'phone' | 'register' | 'waba' | 'template';

function requireCloud(c: WaSetupConfig): string {
  if (c.PLATFORM_WA_PROVIDER !== 'cloud') {
    throw conflict(
      'wa_setup_not_cloud',
      c.PLATFORM_WA_PROVIDER === 'd360'
        ? "Bu adım 360dialog'da gerekmez: numara kaydını ve webhook aboneliğini 360dialog yapar. 360dialog adımları: Bağlantıyı test et → " +
            "Webhook'u 360dialog'a kaydet → Şablonları gönder."
        : c.PLATFORM_WA_PROVIDER === 'twilio'
          ? "Bu adım Twilio'da gerekmez: numara kaydını ve webhook aboneliğini Twilio yapar. Twilio adımları: Bağlantıyı test et → " +
            "Webhook'u Twilio'ya kaydet → Şablonları gönder."
          : `Bu adım yalnız Meta Cloud API'de çalışır; şu anki sağlayıcı: ${WA_PROVIDER_LABELS[c.PLATFORM_WA_PROVIDER]}. ` +
            "Meta doğrudan yol için META_* GitHub secret'larını ekleyip iş akışını çalıştırın (docs/15 §6.2b).",
    );
  }
  if (!c.PLATFORM_WA_API_KEY) throw conflict('wa_setup_missing', `Erişim anahtarı (token) tanımlı değil: ${envName('PLATFORM_WA_API_KEY')}.`);
  return c.PLATFORM_WA_API_KEY;
}

function requirePhoneId(c: WaSetupConfig): string {
  if (!c.PLATFORM_WA_PHONE_NUMBER_ID) {
    throw conflict('wa_setup_missing', `Telefon numarası kimliği (Phone number ID) tanımlı değil: ${envName('PLATFORM_WA_PHONE_NUMBER_ID')}.`);
  }
  return c.PLATFORM_WA_PHONE_NUMBER_ID;
}

function requireWabaId(c: WaSetupConfig): string {
  if (!c.PLATFORM_WA_WABA_ID) {
    throw conflict(
      'wa_setup_missing',
      `WhatsApp Business hesap kimliği (WABA ID) tanımlı değil: ${envName('PLATFORM_WA_WABA_ID')}. Meta › WhatsApp › API Setup sayfasında "WhatsApp Business Account ID" olarak yazar.`,
    );
  }
  return c.PLATFORM_WA_WABA_ID;
}

/** Graph hatası → Türkçe, yapılacak işi söyleyen AppError (502; ön koşul hataları 409). */
export function graphErrorToAppError(err: GraphApiError, ctx: GraphContext): AppError {
  const code = Number(err.code);
  const meta = `Meta hata ${err.code}${err.subcode ? `/${err.subcode}` : ''}`;
  const e = (c: string, message: string) => new AppError(502, c, message, { graphCode: err.code, graphSubcode: err.subcode });
  if (err.code === 'network' || err.code === 'timeout') return e('graph_unreachable', `${err.message}. İnternet bağlantısını kontrol edip biraz sonra tekrar deneyin.`);
  if (code === 190 || code === 102 || code === 463 || code === 467) {
    return e(
      'graph_token_invalid',
      `Erişim anahtarı (token) geçersiz ya da süresi dolmuş (${meta}). business.facebook.com › Ayarlar › Sistem kullanıcıları'nda yeni bir token oluşturun ` +
        `(süre: Hiçbir zaman; izinler: whatsapp_business_messaging, whatsapp_business_management), ${envName('PLATFORM_WA_API_KEY')} değerini güncelleyip yeniden başlatın.`,
    );
  }
  if (code === 100 && err.subcode === '33') {
    return ctx === 'phone' || ctx === 'register'
      ? e(
          'graph_not_found',
          `Telefon numarası kimliği bulunamadı ya da token bu numaraya erişemiyor (${meta}). ${envName('PLATFORM_WA_PHONE_NUMBER_ID')} değerini Meta › WhatsApp › API Setup'taki ` +
            '"Phone number ID" ile karşılaştırın (telefon numarası ya da WABA kimliği değildir) ve sistem kullanıcısına WhatsApp hesabının atandığını kontrol edin.',
        )
      : e(
          'graph_not_found',
          `WhatsApp Business hesabı bulunamadı ya da token bu hesaba erişemiyor (${meta}). ${envName('PLATFORM_WA_WABA_ID')} değerini Meta › WhatsApp › API Setup'taki ` +
            '"WhatsApp Business Account ID" ile karşılaştırın ve sistem kullanıcısına bu hesabı "Tam kontrol" ile atayın.',
        );
  }
  // Kimlik türü karışmış: numara kimliği yerine WABA kimliği (ya da tersi) girilmiş → düğümde alan/yol yok
  if (code === 100 && /nonexisting field|unknown path components/i.test(err.message) && ctx !== 'template') {
    return ctx === 'phone' || ctx === 'register'
      ? e(
          'graph_wrong_id',
          `Girilen kimlik bir telefon numarasına ait değil (${meta}); muhtemelen WABA kimliği girilmiş. ${envName('PLATFORM_WA_PHONE_NUMBER_ID')} için Meta › WhatsApp › API Setup'taki "Phone number ID" değerini kullanın.`,
        )
      : e(
          'graph_wrong_id',
          `Girilen kimlik bir WhatsApp Business hesabına ait değil (${meta}); muhtemelen telefon numarası kimliği girilmiş. ${envName('PLATFORM_WA_WABA_ID')} için API Setup'taki "WhatsApp Business Account ID" değerini kullanın.`,
        );
  }
  if (code === 10 || code === 3 || (code >= 200 && code <= 299)) {
    return e(
      'graph_permission',
      `Token'ın bu işlem için izni yok (${meta}). Sistem kullanıcısına uygulamayı ve WhatsApp hesabını "Tam kontrol" ile atayın, token'ı ` +
        'whatsapp_business_messaging ve whatsapp_business_management izinleriyle yeniden oluşturun.',
    );
  }
  if (RATE_LIMIT_CODES.has(err.code)) return e('graph_rate_limited', `Meta istek sınırına takıldı (${meta}). Birkaç dakika bekleyip tekrar deneyin.`);
  if (ctx === 'register') {
    if (code === 133005) {
      return e(
        'wa_pin_mismatch',
        `PIN, bu numarada daha önce belirlenmiş iki adımlı doğrulama PIN'iyle eşleşmiyor (${meta}). Eski PIN'i girin ya da WhatsApp Manager › Telefon numaraları › numara › ` +
          'İki adımlı doğrulama › PIN\'i değiştir ile yeni PIN belirleyip onu girin.',
      );
    }
    if (code === 133006) return e('wa_phone_not_verified', `Numara henüz doğrulanmamış (${meta}). Meta › WhatsApp › API Setup'ta numarayı SMS ya da sesli arama koduyla doğrulayıp tekrar deneyin.`);
    if (code === 133008 || code === 133009) return e('wa_pin_locked', `Çok fazla hatalı PIN denemesi (${meta}). Meta'nın beklettiği süre dolunca tekrar deneyin.`);
    if (code === 133015 || code === 133016) return e('wa_register_wait', `Bu numara için çok sık kayıt denemesi yapıldı (${meta}). Birkaç dakika bekleyip tekrar deneyin.`);
    if (code === 133004) return e('graph_unavailable', `Meta sunucusu geçici olarak yanıt vermiyor (${meta}). Biraz sonra tekrar deneyin.`);
  }
  if (code === 131031) return e('wa_account_locked', `WhatsApp Business hesabı kilitli ya da askıda (${meta}). WhatsApp Manager'da hesap durumunu kontrol edin.`);
  if (code === 131042) return e('wa_payment_missing', `Meta ödeme yöntemi eksik ya da geçersiz (${meta}). WhatsApp Manager › Ödeme yöntemleri'nden şirket kartını ekleyin.`);
  if (err.httpStatus != null && err.httpStatus >= 500) return e('graph_unavailable', `Meta sunucusu geçici olarak yanıt vermiyor (${meta}). Biraz sonra tekrar deneyin.`);
  const detail = err.userMessage ?? err.message;
  return e('graph_error', `Meta isteği reddetti (${meta}): ${detail}`.slice(0, 600));
}

async function graph<T>(ctx: GraphContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isGraphApiError(err)) throw graphErrorToAppError(err, ctx);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Bağlantı testi

const CODE_VERIFICATION: ToneMap = {
  VERIFIED: ['Doğrulandı', 'ok'],
  NOT_VERIFIED: ['Doğrulanmadı', 'bad'],
  EXPIRED: ['Doğrulama kodunun süresi doldu', 'info'],
};
const PLATFORM_TYPE: ToneMap = {
  CLOUD_API: ["Cloud API'ye kayıtlı", 'ok'],
  ON_PREMISE: ["On-Premises API'de (Cloud API'ye taşınmalı)", 'bad'],
  NOT_APPLICABLE: ['Kayıtlı değil', 'bad'],
};
const THROUGHPUT: ToneMap = {
  STANDARD: ['Standart', 'info'],
  HIGH: ['Yüksek', 'ok'],
  NOT_APPLICABLE: ['Yok (numara kayıtlı değil)', 'info'],
};

interface GraphPhone {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  name_status?: string;
  quality_rating?: string;
  code_verification_status?: string;
  platform_type?: string;
  throughput?: { level?: string };
}

export const PHONE_FIELDS = 'display_phone_number,verified_name,name_status,quality_rating,code_verification_status,platform_type,throughput';

/**
 * Bağlantı testi: 360dialog'da health_status + webhook (wa-setup-d360.ts), Twilio'da hesap + WhatsApp gönderen
 * (wa-setup-twilio.ts), Meta'da telefon numarası düğümü.
 */
export async function testConnection(c: WaSetupConfig): Promise<AdminWaSetupTest> {
  requireRealProvider(c);
  if (c.PLATFORM_WA_PROVIDER === 'd360') return testConnectionD360(c);
  if (c.PLATFORM_WA_PROVIDER === 'twilio') return testConnectionTwilio(c);
  const token = requireCloud(c);
  const phoneId = requirePhoneId(c);
  const p = await graph('phone', () => graphCall<GraphPhone>(token, 'GET', encodeURIComponent(phoneId), { query: { fields: PHONE_FIELDS } }));
  const s = (v: unknown) => (v == null || v === '' ? null : String(v));
  const phone = {
    id: s(p.id) ?? phoneId,
    displayPhoneNumber: s(p.display_phone_number),
    verifiedName: s(p.verified_name),
    nameStatus: s(p.name_status),
    qualityRating: s(p.quality_rating),
    codeVerificationStatus: s(p.code_verification_status),
    platformType: s(p.platform_type),
    throughputLevel: s(p.throughput?.level),
  };
  const registered = phone.platformType === 'CLOUD_API';
  const rows: AdminWaSetupTest['rows'] = [];
  const hints: string[] = [];
  const configured = platformDisplayPhone(c);
  const match = !!phone.displayPhoneNumber && !!configured && digits(phone.displayPhoneNumber) === digits(configured);
  rows.push({ label: 'Numara (Meta)', value: phone.displayPhoneNumber ?? 'Bilinmiyor', tone: phone.displayPhoneNumber ? 'info' : 'warn' });
  rows.push({
    label: 'Sistemdeki numara',
    value: configured ? (match ? `${formatPhone(configured)} (eşleşiyor)` : `${formatPhone(configured)} (farklı)`) : 'Tanımlı değil',
    tone: match ? 'ok' : 'bad',
  });
  const nameOk = !!phone.verifiedName && phone.verifiedName.trim().toLocaleLowerCase('tr') === SHARED_WA_DISPLAY_NAME.toLocaleLowerCase('tr');
  rows.push({ label: 'Görünen ad', value: phone.verifiedName ?? 'Bilinmiyor', tone: nameOk ? 'ok' : 'warn' });
  const [nameLabel, nameTone] = label(NAME_STATUS, phone.nameStatus);
  rows.push({ label: 'Görünen ad onayı', value: nameLabel, tone: nameTone });
  const [platLabel, platTone] = label(PLATFORM_TYPE, phone.platformType, 'bad');
  rows.push({ label: 'Cloud API kaydı', value: platLabel, tone: platTone });
  const [codeLabel, codeTone] = label(CODE_VERIFICATION, phone.codeVerificationStatus);
  rows.push({ label: 'Numara doğrulaması', value: codeLabel, tone: phone.codeVerificationStatus === 'EXPIRED' && !registered ? 'warn' : codeTone });
  const [qLabel, qTone] = label(QUALITY, phone.qualityRating, 'info');
  rows.push({ label: 'Kalite', value: qLabel, tone: qTone });
  const [tLabel, tTone] = label(THROUGHPUT, phone.throughputLevel, 'info');
  rows.push({ label: 'Gönderim kapasitesi', value: tLabel, tone: tTone });

  if (phone.codeVerificationStatus === 'NOT_VERIFIED') {
    hints.push("Numara doğrulanmamış: Meta › WhatsApp › API Setup'ta numaranın yanındaki doğrulama adımını SMS ya da sesli arama koduyla tamamlayın.");
  }
  if (!registered) hints.push('Numara Cloud API\'ye kayıtlı değil: aşağıdaki "Numarayı etkinleştir" adımını 6 haneli PIN ile yapın.');
  if (phone.nameStatus === 'PENDING_REVIEW') hints.push('Görünen ad Meta incelemesinde (genelde 1–3 gün). Onaylanana kadar müşteriler ad yerine numarayı görebilir.');
  if (phone.nameStatus === 'DECLINED' || phone.nameStatus === 'EXPIRED') {
    hints.push('Görünen ad reddedildi: WhatsApp Manager › Telefon numaraları › numara › Görünen ad › Düzenle ile "Yemek Gelsin" adını yeniden gönderin; ad sitedeki marka adıyla aynı olmalı.');
  }
  if (phone.verifiedName && !nameOk) hints.push(`Meta'daki görünen ad "${phone.verifiedName}"; ortak numaranın adı "${SHARED_WA_DISPLAY_NAME}" olmalı.`);
  if (configured && phone.displayPhoneNumber && !match) {
    hints.push(
      `${envName('PLATFORM_WA_DISPLAY_PHONE')} Meta'daki numarayla aynı değil: QR ve wa.me bağlantıları yanlış numaraya gider. Değeri düzeltip yeniden başlatın.`,
    );
  }
  if (phone.qualityRating === 'RED' || phone.qualityRating === 'YELLOW') hints.push('Numara kalitesi düşük: müşteri şikâyeti ve engellemeleri artmış olabilir; toplu ya da izinsiz mesaj gönderilmemeli.');
  return { ready: registered, phone, rows, hints };
}

// ---------------------------------------------------------------------------
// Numarayı etkinleştir (Cloud API kaydı + iki adımlı doğrulama PIN'i)

export async function registerNumber(c: WaSetupConfig, pin: string): Promise<AdminWaSetupRegister> {
  const token = requireCloud(c);
  const phoneId = requirePhoneId(c);
  if (!/^\d{6}$/.test(pin)) throw new AppError(400, 'invalid_pin', 'PIN 6 haneli bir sayı olmalı.');
  const res = await graph('register', () =>
    graphCall<{ success?: boolean }>(token, 'POST', `${encodeURIComponent(phoneId)}/register`, { body: { messaging_product: 'whatsapp', pin } }),
  );
  if (res.success === false) throw new AppError(502, 'graph_error', 'Meta kaydı onaylamadı (success=false). Biraz sonra "Bağlantıyı test et" ile durumu kontrol edin.');
  return {
    ok: true,
    message: 'Numara Cloud API\'ye kaydedildi ve iki adımlı doğrulama PIN\'i ayarlandı. PIN\'i güvenli bir yerde saklayın; numarayı yeniden kaydederken gerekir.',
  };
}

// ---------------------------------------------------------------------------
// Webhook aboneliği (uygulama ↔ WABA)

interface GraphSubscribedApps {
  data?: Array<{ whatsapp_business_api_data?: { id?: string; name?: string }; id?: string; name?: string }>;
}

export async function readSubscription(c: WaSetupConfig): Promise<AdminWaSetupSubscription> {
  const token = requireCloud(c);
  const waba = requireWabaId(c);
  const res = await graph('waba', () => graphCall<GraphSubscribedApps>(token, 'GET', `${encodeURIComponent(waba)}/subscribed_apps`));
  const apps = (res.data ?? []).map((d) => {
    const a = d.whatsapp_business_api_data ?? d;
    return { id: a.id != null ? String(a.id) : null, name: a.name != null ? String(a.name) : null };
  });
  const subscribed = apps.length > 0;
  return {
    subscribed,
    apps,
    message: subscribed
      ? `WhatsApp hesabına abone uygulama: ${apps.map((a) => a.name ?? a.id ?? '?').join(', ')}. Gelen mesajlar webhook adresine düşer (Meta'da "messages" alanına abone olunmuş olmalı).`
      : 'WhatsApp hesabına abone uygulama yok: gelen mesajlar webhook adresine gelmez. "Webhook aboneliğini aç" düğmesine basın.',
  };
}

export async function subscribeApp(c: WaSetupConfig): Promise<AdminWaSetupSubscription> {
  const token = requireCloud(c);
  const waba = requireWabaId(c);
  const res = await graph('waba', () => graphCall<{ success?: boolean }>(token, 'POST', `${encodeURIComponent(waba)}/subscribed_apps`));
  if (res.success === false) throw new AppError(502, 'graph_error', 'Meta aboneliği onaylamadı (success=false). Biraz sonra tekrar deneyin.');
  return readSubscription(c);
}

// ---------------------------------------------------------------------------
// Mesaj şablonları

interface GraphTemplate {
  id?: string;
  name?: string;
  status?: string;
  category?: string;
  language?: string;
  rejected_reason?: string;
}

/** Durumlar büyük harfe çevrilerek eşlenir (360dialog küçük harf ve eski "submitted" döndürebilir). */
const TEMPLATE_STATUS: ToneMap = {
  APPROVED: ['Onaylandı', 'ok'],
  PENDING: ['İncelemede', 'warn'],
  SUBMITTED: ['İncelemede', 'warn'],
  // Twilio: içerik var ama onaya gönderilmemiş; "Şablonları gönder" onay isteğini yeniden gönderir
  UNSUBMITTED: ['Onaya gönderilmedi', 'bad'],
  IN_APPEAL: ['İtirazda', 'warn'],
  REJECTED: ['Reddedildi', 'bad'],
  PAUSED: ['Duraklatıldı', 'bad'],
  DISABLED: ['Devre dışı', 'bad'],
  PENDING_DELETION: ['Siliniyor', 'bad'],
  DELETED: ['Silindi', 'bad'],
  ARCHIVED: ['Arşivlendi', 'bad'],
  LIMIT_EXCEEDED: ['Şablon sınırı aşıldı', 'bad'],
};

const REJECTED_REASON: Record<string, string> = {
  ABUSIVE_CONTENT: 'Kötüye kullanım içeriği',
  INCORRECT_CATEGORY: 'Yanlış kategori',
  INVALID_FORMAT: 'Geçersiz biçim (değişken, buton ya da örnek)',
  SCAM: 'Dolandırıcılık şüphesi',
  PROMOTIONAL: 'Tanıtım içeriği (utility için uygun değil)',
  TAG_CONTENT_MISMATCH: 'İçerik seçilen kategoriyle uyuşmuyor',
};

export const TEMPLATE_FIELDS = 'name,status,category,language,rejected_reason';

/**
 * Şablon deposu (sağlayıcı arayüzü): Meta Graph'ta /{waba_id}/message_templates (token), 360dialog'da /message_templates
 * (anahtar; WABA anahtara bağlı). Gövde, yanıt ({data, paging.cursors.after}) ve hata biçimi aynıdır; yalnız hedef, yol ve
 * hata metinleri farklıdır.
 */
interface TemplateStore {
  /** Sağlayıcıdaki tüm şablonlar (Graph biçiminde; Twilio kendi yanıtını bu biçime çevirir) */
  list: () => Promise<GraphTemplate[]>;
  /** Tek şablonu oluşturur (Twilio'da ayrıca WhatsApp onayına gönderir; `existing` onaya gönderilmemiş kayıt) */
  create: (def: TemplateDef, existing?: GraphTemplate) => Promise<void>;
  /** list: liste/tümden durduran hata; create: tek şablonun hatası */
  mapError: (err: GraphApiError, ctx: 'list' | 'create') => AppError;
  /** "Bu adla şablon zaten var": atlandı sayılır */
  exists: (err: GraphApiError) => boolean;
}

/** Graph uyumlu depo (cloud ve d360: aynı gövde, yanıt ve sayfalama). */
function graphTemplateStore(
  target: AdminApiTarget,
  path: string,
  appBaseUrl: string,
  mapError: TemplateStore['mapError'],
): TemplateStore {
  return {
    mapError,
    exists: alreadyExists,
    list: async () => {
      const out: GraphTemplate[] = [];
      let after: string | undefined;
      for (let page = 0; page < 10; page++) {
        const res: { data?: GraphTemplate[]; paging?: { cursors?: { after?: string }; next?: string } } = await adminApiCall(target, 'GET', path, {
          query: { fields: TEMPLATE_FIELDS, limit: 200, after },
        });
        out.push(...(Array.isArray(res.data) ? res.data : []));
        after = res.paging?.next ? res.paging.cursors?.after : undefined;
        if (!after) break;
      }
      return out;
    },
    create: async (def) => {
      await adminApiCall(target, 'POST', path, { body: templateCreatePayload(def, appBaseUrl) });
    },
  };
}

function templateStore(c: WaSetupConfig): TemplateStore {
  requireRealProvider(c);
  if (c.PLATFORM_WA_PROVIDER === 'twilio') {
    const t = requireTwilio(c);
    return {
      mapError: (err, ctx) => twilioErrorToAppError(err, ctx === 'create' ? 'template' : 'templates'),
      exists: twilioAlreadyExists,
      list: async () => toTemplateRows(await listTwilioTemplates(t)),
      create: (def, existing) => createTwilioTemplate(t, def, c.APP_BASE_URL, existing?.id),
    };
  }
  if (c.PLATFORM_WA_PROVIDER === 'd360') {
    if (!c.PLATFORM_WA_API_KEY) throw conflict('wa_setup_missing', `360dialog API anahtarı tanımlı değil: ${envNameFor('PLATFORM_WA_API_KEY', 'd360')}.`);
    return graphTemplateStore(d360Target(c.PLATFORM_WA_API_KEY), D360_TEMPLATES_PATH, c.APP_BASE_URL, (err, ctx) =>
      d360ErrorToAppError(err, ctx === 'create' ? 'template' : 'templates'),
    );
  }
  const token = requireCloud(c);
  const waba = requireWabaId(c);
  return graphTemplateStore(graphTarget(token), `${encodeURIComponent(waba)}/message_templates`, c.APP_BASE_URL, (err, ctx) =>
    graphErrorToAppError(err, ctx === 'create' ? 'template' : 'waba'),
  );
}

/** Hesaptaki tüm şablonlar; liste hatası Türkçeye çevrilir. */
async function fetchAllTemplates(store: TemplateStore): Promise<GraphTemplate[]> {
  try {
    return await store.list();
  } catch (err) {
    if (isGraphApiError(err)) throw store.mapError(err, 'list');
    throw err;
  }
}

const isTr = (t: GraphTemplate) => (t.language ?? '').toLowerCase() === 'tr';

function templateRows(existing: GraphTemplate[]): AdminWaTemplates {
  const byName = new Map<string, GraphTemplate>();
  for (const t of existing) if (t.name && isTr(t)) byName.set(t.name, t);
  const templates: AdminWaTemplateStatus[] = WA_TEMPLATE_CATALOG.map((def) => {
    const t = byName.get(def.name);
    const status = t?.status ? String(t.status).toUpperCase() : null;
    const [statusLabel, tone] = status ? (TEMPLATE_STATUS[status] ?? [status, 'warn']) : (["Meta'da yok", 'info'] as [string, AdminWaSetupTone]);
    const category = t?.category ? String(t.category).toUpperCase() : null;
    const reason = t?.rejected_reason && String(t.rejected_reason).toUpperCase() !== 'NONE' ? String(t.rejected_reason).toUpperCase() : null;
    return {
      name: def.name,
      audience: def.audience,
      status,
      statusLabel,
      tone,
      category,
      categoryChanged: !!category && category !== def.category,
      rejectedReason: reason,
      rejectedReasonLabel: reason ? (REJECTED_REASON[reason] ?? reason) : null,
      body: def.body,
    };
  });
  const count = (f: (t: AdminWaTemplateStatus) => boolean) => templates.filter(f).length;
  return {
    templates,
    summary: {
      total: templates.length,
      approved: count((t) => t.status === 'APPROVED'),
      pending: count((t) => t.status === 'PENDING' || t.status === 'SUBMITTED' || t.status === 'IN_APPEAL'),
      rejected: count((t) => t.status != null && t.tone === 'bad'),
      missing: count((t) => t.status == null),
    },
  };
}

/**
 * Katalog tanımından şablon oluşturma gövdesi (Graph POST /{waba}/message_templates; 360dialog POST /message_templates aynı
 * gövdeyi alır). Gövde metni koddakiyle birebir;
 * değişkenler konumsal ({{1}}..), örnekler params sırasıyla; URL butonu APP_BASE_URL + yol (+ dinamikse {{1}}).
 */
export function templateCreatePayload(def: TemplateDef, appBaseUrl: string): Record<string, unknown> {
  const base = appBaseUrl.replace(/\/+$/, '');
  const components: Record<string, unknown>[] = [
    { type: 'BODY', text: def.body, ...(def.examples.length ? { example: { body_text: [def.examples] } } : {}) },
  ];
  if (def.buttons.length) {
    components.push({
      type: 'BUTTONS',
      buttons: def.buttons.map((b) => {
        if (b.type === 'quick_reply') return { type: 'QUICK_REPLY', text: b.text };
        if (b.dynamic) return { type: 'URL', text: b.text, url: `${base}${b.path}{{1}}`, example: [`${base}${b.path}${b.example}`] };
        return { type: 'URL', text: b.text, url: `${base}${b.path}` };
      }),
    });
  }
  return { name: def.name, language: def.language, category: def.category, components };
}

/** Oluşturmayı tümden durduran hatalar (token/anahtar, izin, kimlik, uç nokta, hız sınırı, ağ): kalan şablonlar denenmez. */
function fatalTemplateError(err: GraphApiError): boolean {
  const code = Number(err.code);
  const status = err.httpStatus;
  return (
    err.code === 'network' ||
    err.code === 'timeout' ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 429 ||
    code === 190 ||
    code === 102 ||
    code === 10 ||
    code === 3 ||
    (code >= 200 && code <= 299) ||
    (code === 100 && err.subcode === '33') ||
    RATE_LIMIT_CODES.has(err.code)
  );
}

/** "Bu dilde bu adla şablon zaten var" (yarış ya da listede görünmeyen şablon): atlandı sayılır. */
function alreadyExists(err: GraphApiError): boolean {
  const re = /already exists|duplicate/i;
  return err.subcode === '2388024' || re.test(err.message) || re.test(err.userMessage ?? '');
}

const HTTPS_TEMPLATES = 'şablon butonlarındaki bağlantılar https olmalı';

export async function listTemplateStatus(c: WaSetupConfig): Promise<AdminWaTemplates> {
  return templateRows(await fetchAllTemplates(templateStore(c)));
}

/** Eksik şablonları oluşturur (var olanı atlar, hiçbir şeyi silmez), sonra güncel durumları döner. İdempotent. */
export async function syncTemplates(c: WaSetupConfig): Promise<AdminWaTemplates> {
  const store = templateStore(c);
  requireHttpsBase(c, HTTPS_TEMPLATES);
  const existing = await fetchAllTemplates(store);
  // Onaya gönderilmemiş kayıt (Twilio: UNSUBMITTED) var sayılmaz: onay isteği yeniden gönderilir
  const unsubmitted = new Map(existing.filter((t) => t.name && isTr(t) && String(t.status ?? '').toUpperCase() === 'UNSUBMITTED').map((t) => [t.name!, t]));
  const have = new Set(existing.filter((t) => t.name && isTr(t) && !unsubmitted.has(t.name)).map((t) => t.name!));
  const created: string[] = [];
  const skipped: string[] = [];
  const failed: { name: string; message: string }[] = [];
  for (const def of WA_TEMPLATE_CATALOG) {
    if (have.has(def.name)) {
      skipped.push(def.name);
      continue;
    }
    try {
      await store.create(def, unsubmitted.get(def.name));
      created.push(def.name);
    } catch (err) {
      if (!isGraphApiError(err)) throw err;
      if (store.exists(err)) {
        skipped.push(def.name);
        continue;
      }
      if (fatalTemplateError(err)) throw store.mapError(err, 'list');
      failed.push({ name: def.name, message: store.mapError(err, 'create').message });
    }
  }
  const after = created.length ? await fetchAllTemplates(store) : existing;
  return { ...templateRows(after), sync: { created, skipped, failed } };
}
