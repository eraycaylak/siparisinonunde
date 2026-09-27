// Cloudflare ortamında ortak numaranın kipi (15 §13). GitHub secret'ları META_WA_TOKEN, META_WA_PHONE_NUMBER_ID,
// META_APP_SECRET ve WA_PHONE birlikte varsa container gerçek Meta WhatsApp Cloud API ile açılır (META_WA_WABA_ID isteğe
// bağlı: admin "WhatsApp kurulumu"ndaki abonelik ve şablon adımları için). Biri bile eksikse taklit (mock) kalır: canlı
// ortamda (DEPLOY_ENV=production) bu, çalışan WhatsApp olmadığı anlamına gelir (vitrinde ve QR'da WhatsApp bağlantısı
// gösterilmez; apps/api/src/config.ts platformDisplayPhone). Geliştirici araçlarını (DEV_TOOLS) bu modül değil dağıtım
// kipi belirler (src/mode.ts): canlı ortamda her zaman 0, gizli staging'de 1.
// Hem Worker (src/index.ts) hem iş akışının gizli değer betiği (scripts/secrets.mjs) bu dosyayı kullanır.

export interface WhatsAppSecrets {
  META_WA_TOKEN?: string;
  META_WA_PHONE_NUMBER_ID?: string;
  META_WA_WABA_ID?: string;
  META_APP_SECRET?: string;
  /** Ortak numara, E.164 (ör. +905321234567) */
  WA_PHONE?: string;
}

/** Gerçek kip için birlikte gereken secret'lar. */
export const REQUIRED_WA_SECRETS = ['META_WA_TOKEN', 'META_WA_PHONE_NUMBER_ID', 'META_APP_SECRET', 'WA_PHONE'] as const;
/** Tüm WhatsApp secret'ları (isteğe bağlı META_WA_WABA_ID dahil). */
export const WA_SECRET_NAMES = [...REQUIRED_WA_SECRETS, 'META_WA_WABA_ID'] as const;

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

export interface WhatsAppContainerEnv {
  mode: 'cloud' | 'mock';
  /** Gerçek kip için eksik (ya da geçersiz) secret adları */
  missing: string[];
  /** Container ortam değişkenleri (ortak numara ve sağlayıcı) */
  env: Record<string, string>;
}

export function whatsappContainerEnv(s: WhatsAppSecrets): WhatsAppContainerEnv {
  const missing: string[] = REQUIRED_WA_SECRETS.filter((k) => !clean(s[k]));
  const phone = normalizeE164(s.WA_PHONE);
  if (clean(s.WA_PHONE) && !phone) missing.push('WA_PHONE (E.164 değil)');
  if (missing.length) {
    // Gösterim numarası verilmez: API, simülatörlü staging'de (DEPLOY_ENV=dev) geliştirme numarasını (+905550000000)
    // kendisi kullanır; canlı ortamda (DEPLOY_ENV=production) mock iken numara göstermez. PLATFORM_WA_DISPLAY_PHONE burada
    // verilseydi kimsenin okumadığı numara canlı vitrinde ve QR'da görünürdü (apps/api/src/config.ts platformDisplayPhone).
    return { mode: 'mock', missing, env: { PLATFORM_WA_PROVIDER: 'mock' } };
  }
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
