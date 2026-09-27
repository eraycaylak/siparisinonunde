// Cloudflare ortamında ortak numaranın kipi (15 §13, §6.2). İki gerçek yol vardır (00 §12a madde 8):
//   - 360dialog (VARSAYILAN, proje sahibinin kararı 27.09.2026): GitHub secret'ları D360_API_KEY ve WA_PHONE birlikte
//     varsa container PLATFORM_WA_PROVIDER=d360 ile açılır (numara, anahtara bağlıdır; Meta tarafını 360dialog yönetir).
//   - Meta Cloud API doğrudan (alternatif, 15 §6.2b): META_WA_TOKEN, META_WA_PHONE_NUMBER_ID, META_APP_SECRET ve WA_PHONE
//     birlikte varsa PLATFORM_WA_PROVIDER=cloud (META_WA_WABA_ID isteğe bağlı: admin "WhatsApp kurulumu"ndaki abonelik ve
//     şablon adımları için).
// D360_API_KEY ile tam META_* seti birlikte verilirse yol belirsizdir: dağıtım durur (iş akışı ve scripts/secrets.mjs
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
  /** Ortak numara, E.164 (ör. +905321234567); iki yolda da zorunlu */
  WA_PHONE?: string;
}

/** Meta Cloud API (doğrudan) yolu için birlikte gereken secret'lar. */
export const REQUIRED_WA_SECRETS = ['META_WA_TOKEN', 'META_WA_PHONE_NUMBER_ID', 'META_APP_SECRET', 'WA_PHONE'] as const;
/** 360dialog yolu için birlikte gereken secret'lar. */
export const REQUIRED_D360_SECRETS = ['D360_API_KEY', 'WA_PHONE'] as const;
/** Tüm WhatsApp secret'ları (isteğe bağlı META_WA_WABA_ID dahil); iş akışı boşaltılanları Worker'dan siler. */
export const WA_SECRET_NAMES = [...REQUIRED_WA_SECRETS, 'META_WA_WABA_ID', 'D360_API_KEY'] as const;

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

/**
 * İki yolun secret'ları birlikte mi (D360_API_KEY + tam META_* seti): Türkçe hata metni, yoksa null. Kısmi META_*
 * (ör. eski bir META_WA_TOKEN) çakışma sayılmaz; 360dialog seçilir, artıklar yok sayılır.
 */
export function whatsappSecretsConflict(s: WhatsAppSecrets): string | null {
  if (!clean(s.D360_API_KEY)) return null;
  if (REQUIRED_WA_SECRETS.some((k) => !clean(s[k]))) return null;
  return (
    "Hem 360dialog (D360_API_KEY) hem Meta Cloud API (META_WA_TOKEN, META_WA_PHONE_NUMBER_ID, META_APP_SECRET) secret'ları " +
    'tanımlı: ortak numaranın hangi yoldan bağlanacağı belirsiz. Kullanmadığınız yolun secret\'larını silin (360dialog için ' +
    "META_WA_TOKEN, META_WA_PHONE_NUMBER_ID, META_WA_WABA_ID, META_APP_SECRET; Meta doğrudan için D360_API_KEY) ve iş akışını " +
    'yeniden çalıştırın (docs/15 §6.2).'
  );
}

export interface WhatsAppContainerEnv {
  mode: 'cloud' | 'd360' | 'mock';
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
