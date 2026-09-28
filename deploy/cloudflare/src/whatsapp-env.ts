// Cloudflare ortamında ortak numaranın kipi (15 §13, §6.2). Üç gerçek yol vardır (00 §12a madde 8):
//   - 360dialog (VARSAYILAN, proje sahibinin kararı 27.09.2026): GitHub secret'ları D360_API_KEY ve WA_PHONE birlikte
//     varsa container PLATFORM_WA_PROVIDER=d360 ile açılır (numara, anahtara bağlıdır; Meta tarafını 360dialog yönetir).
//   - Twilio (alternatif, 15 §6.2d; docs/16): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN ve WA_PHONE birlikte varsa
//     PLATFORM_WA_PROVIDER=twilio. Account SID gönderim adresinde (PLATFORM_WA_PHONE_NUMBER_ID), Auth Token hem
//     gönderimde hem webhook imzasında (X-Twilio-Signature) kullanılır; Meta imza anahtarı (WA_APP_SECRET) yoktur.
//   - Meta Cloud API doğrudan (alternatif, 15 §6.2b): META_WA_TOKEN, META_WA_PHONE_NUMBER_ID, META_APP_SECRET ve WA_PHONE
//     birlikte varsa PLATFORM_WA_PROVIDER=cloud (META_WA_WABA_ID isteğe bağlı: admin "WhatsApp kurulumu"ndaki abonelik ve
//     şablon adımları için).
// Birden çok yolun anahtarları birlikte verilirse yol belirsizdir: dağıtım durur (iş akışı ve scripts/secrets.mjs
// whatsappSecretsConflict ile), Worker da bu durumda gerçek numarayı açmaz (mock + hata günlüğü). Hiçbir yol tamamlanmamışsa
// taklit (mock) kalır: canlı ortamda (DEPLOY_ENV=production) bu, çalışan WhatsApp olmadığı anlamına gelir (vitrinde ve QR'da
// WhatsApp bağlantısı gösterilmez; apps/api/src/config.ts platformDisplayPhone). Geliştirici araçlarını (DEV_TOOLS) bu modül
// değil dağıtım kipi belirler (src/mode.ts): canlı ortamda her zaman 0, gizli staging'de 1.
// Hem Worker (src/index.ts) hem iş akışının gizli değer betiği (scripts/secrets.mjs) bu dosyayı kullanır.

export interface WhatsAppSecrets {
  META_WA_TOKEN?: string;
  META_WA_PHONE_NUMBER_ID?: string;
  META_WA_WABA_ID?: string;
  META_APP_SECRET?: string;
  /** 360dialog'un numaraya verdiği API anahtarı (D360-API-KEY) */
  D360_API_KEY?: string;
  /** Twilio hesap kimliği: AC + 32 onaltılık karakter */
  TWILIO_ACCOUNT_SID?: string;
  /** Twilio Auth Token: gönderim ve webhook imzası */
  TWILIO_AUTH_TOKEN?: string;
  /** Ortak numara, E.164 (ör. +905321234567); iki yolda da zorunlu */
  WA_PHONE?: string;
}

/** Meta Cloud API (doğrudan) yolu için birlikte gereken secret'lar. */
export const REQUIRED_WA_SECRETS = ['META_WA_TOKEN', 'META_WA_PHONE_NUMBER_ID', 'META_APP_SECRET', 'WA_PHONE'] as const;
/** 360dialog yolu için birlikte gereken secret'lar. */
export const REQUIRED_D360_SECRETS = ['D360_API_KEY', 'WA_PHONE'] as const;
/** Twilio yolu için birlikte gereken secret'lar. */
export const REQUIRED_TWILIO_SECRETS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'WA_PHONE'] as const;
/** Tüm WhatsApp secret'ları (isteğe bağlı META_WA_WABA_ID dahil); iş akışı boşaltılanları Worker'dan siler. */
export const WA_SECRET_NAMES = [...REQUIRED_WA_SECRETS, 'META_WA_WABA_ID', 'D360_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] as const;

const clean = (v: string | undefined | null) => (typeof v === 'string' ? v.trim() : '');

/**
 * Telefonu E.164'e çevirir: "+90 532 123 45 67", "0532 123 45 67", "905321234567", "00905321234567", "5321234567"
 * → "+905321234567". Geçersizse null.
 */
export function normalizeE164(raw: string | undefined | null): string | null {
  let v = clean(raw).replace(/[\s\-().]/g, '');
  if (!v) return null;
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  else if (/^0\d{10}$/.test(v)) v = `+90${v.slice(1)}`;
  else if (/^90\d{10}$/.test(v)) v = `+${v}`;
  else if (/^5\d{9}$/.test(v)) v = `+90${v}`;
  return /^\+[1-9]\d{7,14}$/.test(v) ? v : null;
}

/** Meta kimliği (Phone number ID, WABA ID): yalnız rakam. */
export function isMetaId(v: string | undefined | null): boolean {
  return /^\d{5,30}$/.test(clean(v));
}

/** Twilio Account SID: "AC" + 32 onaltılık karakter (Console > Account Info). */
export function isTwilioAccountSid(v: string | undefined | null): boolean {
  return /^AC[0-9a-fA-F]{32}$/.test(clean(v));
}

/** Yolun ANAHTAR takımı tam mı (ortak olan WA_PHONE sayılmaz). */
function d360Complete(s: WhatsAppSecrets): boolean {
  return !!clean(s.D360_API_KEY);
}
function twilioComplete(s: WhatsAppSecrets): boolean {
  return !!clean(s.TWILIO_ACCOUNT_SID) && !!clean(s.TWILIO_AUTH_TOKEN);
}
function metaComplete(s: WhatsAppSecrets): boolean {
  return !!clean(s.META_WA_TOKEN) && !!clean(s.META_WA_PHONE_NUMBER_ID) && !!clean(s.META_APP_SECRET);
}

/** Yolların hangi secret'ları sildirilecek (çakışma metni için). */
const PATH_SECRETS: Record<string, string> = {
  '360dialog': 'D360_API_KEY',
  Twilio: 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN',
  'Meta Cloud API': 'META_WA_TOKEN, META_WA_PHONE_NUMBER_ID, META_WA_WABA_ID, META_APP_SECRET',
};

/**
 * Birden çok yolun anahtar takımı birlikte mi verilmiş: Türkçe hata metni, yoksa null. Kısmi artıklar (ör. yalnız eski
 * bir META_WA_TOKEN) çakışma sayılmaz; tek tam yol seçilir, artıklar yok sayılır.
 */
export function whatsappSecretsConflict(s: WhatsAppSecrets): string | null {
  const paths: string[] = [];
  if (d360Complete(s)) paths.push('360dialog');
  if (twilioComplete(s)) paths.push('Twilio');
  if (metaComplete(s)) paths.push('Meta Cloud API');
  if (paths.length < 2) return null;
  const named = paths.map((p) => `${p} (${PATH_SECRETS[p]})`).join(' ve ');
  return (
    `Hem ${named} secret'ları tanımlı: ortak numaranın hangi yoldan bağlanacağı belirsiz. ` +
    "Kullanmadığınız yolların secret'larını silin ve iş akışını yeniden çalıştırın (docs/15 §6.2, §6.2b, §6.2d)."
  );
}

export interface WhatsAppContainerEnv {
  mode: 'cloud' | 'd360' | 'twilio' | 'mock';
  /** Seçilen gerçek yol için eksik (ya da geçersiz) secret adları */
  missing: string[];
  /** Container ortam değişkenleri (ortak numara ve sağlayıcı) */
  env: Record<string, string>;
  /** İki yolun secret'ları birlikte verilmiş (whatsappSecretsConflict): gerçek numara açılmaz */
  conflict?: string;
}

// Gösterim numarası mock'ta verilmez: API, simülatörlü staging'de (DEPLOY_ENV=dev) geliştirme numarasını (+905550000000)
// kendisi kullanır; canlı ortamda (DEPLOY_ENV=production) mock iken numara göstermez. PLATFORM_WA_DISPLAY_PHONE burada
// verilseydi kimsenin okumadığı numara canlı vitrinde ve QR'da görünürdü (apps/api/src/config.ts platformDisplayPhone).
const MOCK_ENV = { PLATFORM_WA_PROVIDER: 'mock' } as const;

export function whatsappContainerEnv(s: WhatsAppSecrets): WhatsAppContainerEnv {
  const conflict = whatsappSecretsConflict(s);
  if (conflict) return { mode: 'mock', missing: [], env: { ...MOCK_ENV }, conflict };
  const phone = normalizeE164(s.WA_PHONE);
  const phoneBad = !!clean(s.WA_PHONE) && !phone;

  // 360dialog (varsayılan yol): anahtar + numara. Numaranın phone_number_id'si ve WABA'sı anahtara bağlıdır; webhook
  // imzası yoktur (URL'deki gizli belirteç korur), bu yüzden WA_APP_SECRET verilmez.
  const d360Key = clean(s.D360_API_KEY);
  if (d360Key) {
    const missing: string[] = [];
    if (!clean(s.WA_PHONE)) missing.push('WA_PHONE');
    else if (phoneBad) missing.push('WA_PHONE (E.164 değil)');
    if (missing.length) return { mode: 'mock', missing, env: { ...MOCK_ENV } };
    return {
      mode: 'd360',
      missing: [],
      env: { PLATFORM_WA_PROVIDER: 'd360', PLATFORM_WA_API_KEY: d360Key, PLATFORM_WA_DISPLAY_PHONE: phone! },
    };
  }

  // Twilio: Account SID + Auth Token + numara. Webhook imzası Auth Token'ladır (X-Twilio-Signature), Meta imza
  // anahtarı (WA_APP_SECRET) yoktur; Account SID gönderim adresindeki kimliktir.
  const twilioSid = clean(s.TWILIO_ACCOUNT_SID);
  const twilioToken = clean(s.TWILIO_AUTH_TOKEN);
  if (twilioSid || twilioToken) {
    const missingTwilio: string[] = [];
    if (!twilioSid) missingTwilio.push('TWILIO_ACCOUNT_SID');
    else if (!isTwilioAccountSid(twilioSid)) missingTwilio.push('TWILIO_ACCOUNT_SID (AC ile başlayan 34 karakter değil)');
    if (!twilioToken) missingTwilio.push('TWILIO_AUTH_TOKEN');
    if (!clean(s.WA_PHONE)) missingTwilio.push('WA_PHONE');
    else if (phoneBad) missingTwilio.push('WA_PHONE (E.164 değil)');
    if (missingTwilio.length) return { mode: 'mock', missing: missingTwilio, env: { ...MOCK_ENV } };
    return {
      mode: 'twilio',
      missing: [],
      env: {
        PLATFORM_WA_PROVIDER: 'twilio',
        PLATFORM_WA_API_KEY: twilioToken,
        PLATFORM_WA_PHONE_NUMBER_ID: twilioSid,
        PLATFORM_WA_DISPLAY_PHONE: phone!,
      },
    };
  }

  const missing: string[] = REQUIRED_WA_SECRETS.filter((k) => !clean(s[k]));
  if (phoneBad) missing.push('WA_PHONE (E.164 değil)');
  if (missing.length) return { mode: 'mock', missing, env: { ...MOCK_ENV } };
  const waba = clean(s.META_WA_WABA_ID);
  return {
    mode: 'cloud',
    missing: [],
    env: {
      PLATFORM_WA_PROVIDER: 'cloud',
      PLATFORM_WA_API_KEY: clean(s.META_WA_TOKEN),
      PLATFORM_WA_PHONE_NUMBER_ID: clean(s.META_WA_PHONE_NUMBER_ID),
      ...(waba ? { PLATFORM_WA_WABA_ID: waba } : {}),
      // Webhook imzası (X-Hub-Signature-256): ortak numara ve işletmeye özel webhook aynı uygulama gizli anahtarıyla
      WA_APP_SECRET: clean(s.META_APP_SECRET),
      PLATFORM_WA_DISPLAY_PHONE: phone!,
    },
  };
}
