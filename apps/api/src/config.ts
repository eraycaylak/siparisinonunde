// Ortam değişkenleri (14 §3), Zod ile doğrulanır.

import { resolve } from 'node:path';
import { z } from 'zod';

const bool01 = z
  .union([z.string(), z.boolean(), z.undefined()])
  .transform((v) => v === true || v === '1' || v === 'true');

/** Verilmemiş/boş → undefined (varsayılanı loadConfig ortama göre seçer); aksi halde bool01 gibi. */
const optionalBool01 = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v === true || v === '1' || v === 'true'));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL zorunlu'),
  TEST_DATABASE_URL: optionalString,
  APP_BASE_URL: z.url().default('http://localhost:3000'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  WEB_PORT: z.coerce.number().int().default(3000),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET en az 16 karakter'),
  TRACKING_SECRET: z.string().min(8, 'TRACKING_SECRET en az 8 karakter'),
  ENCRYPTION_KEY: z.string().refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'ENCRYPTION_KEY 32 bayt base64 olmalı'),
  WA_DEFAULT_PROVIDER: z.enum(['mock', 'cloud', 'd360']).default('mock'),
  WA_APP_SECRET: optionalString,
  WA_VERIFY_TOKEN: z.string().default('dev-verify'),
  PLATFORM_WA_PROVIDER: z.enum(['mock', 'cloud', 'd360']).default('mock'),
  PLATFORM_WA_API_KEY: optionalString,
  /** cloud: platform numarasının Graph phone_number_id'si (d360'ta gerekmez) */
  PLATFORM_WA_PHONE_NUMBER_ID: optionalString,
  SMS_PROVIDER: z.enum(['mock', 'netgsm']).default('mock'),
  NETGSM_USERCODE: optionalString,
  NETGSM_PASSWORD: optionalString,
  NETGSM_HEADER: optionalString,
  UPLOAD_DIR: z.string().default('./uploads'),
  ANTHROPIC_API_KEY: optionalString,
  /**
   * Web Push (00 §10 alarm t=0): VAPID anahtar çifti (`npx web-push generate-vapid-keys`) ve iletişim adresi.
   * Üçü de verilmezse push kapalıdır (uygulama çalışır; üretimde başlangıçta uyarı yazılır).
   */
  VAPID_PUBLIC_KEY: optionalString.refine((v) => v === undefined || /^[A-Za-z0-9_-]{86,88}={0,2}$/.test(v), {
    message: 'VAPID_PUBLIC_KEY base64url biçiminde olmalı (npx web-push generate-vapid-keys)',
  }),
  VAPID_PRIVATE_KEY: optionalString.refine((v) => v === undefined || /^[A-Za-z0-9_-]{42,44}={0,2}$/.test(v), {
    message: 'VAPID_PRIVATE_KEY base64url biçiminde olmalı (npx web-push generate-vapid-keys)',
  }),
  VAPID_SUBJECT: optionalString.refine((v) => v === undefined || /^(mailto:\S+@\S+|https:\/\/\S+)$/.test(v), {
    message: 'VAPID_SUBJECT mailto: ya da https:// ile başlamalı (ör. mailto:destek@siparisinonunde.com)',
  }),
  DEV_TOOLS: bool01.default(false),
  /** Platform yöneticileri için TOTP zorunlu (00 §12a madde 7). Verilmezse: üretimde açık, diğer ortamlarda kapalı. */
  ADMIN_TOTP_REQUIRED: optionalBool01,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = Omit<z.infer<typeof configSchema>, 'ADMIN_TOTP_REQUIRED'> & {
  /** Çözülmüş değer (varsayılan NODE_ENV'e göre) */
  ADMIN_TOTP_REQUIRED: boolean;
  /** Web Push açık mı (VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT dolu) */
  pushEnabled: boolean;
  /** Çerezde Secure bayrağı (üretim ya da https kök adres) */
  cookieSecure: boolean;
  /** Mutlak yükleme dizini */
  uploadDirAbs: string;
};

type ParsedConfig = z.infer<typeof configSchema>;

/** Üretimde güçlü sayılmayan gizli anahtar: kısa ya da örnek dosyadaki geliştirme değeri. */
const weakSecret = (v: string) => v.length < 32 || v.startsWith('dev-only');

/**
 * Üretimde (NODE_ENV=production) süreci başlatmayan yapılandırma hataları (fail-fast; 15 §4):
 * geliştirici araçları açık, zayıf/örnek gizli anahtarlar, seçilen gerçek sağlayıcının anahtarları eksik.
 */
export function productionConfigErrors(c: ParsedConfig): string[] {
  if (c.NODE_ENV !== 'production') return [];
  const errors: string[] = [];
  if (c.DEV_TOOLS) errors.push('DEV_TOOLS üretimde 0 olmalı (/api/v1/dev/* kimlik doğrulamasızdır)');
  if (weakSecret(c.SESSION_SECRET)) errors.push('SESSION_SECRET en az 32 karakter ve örnek değerden farklı olmalı (openssl rand -base64 48)');
  if (weakSecret(c.TRACKING_SECRET)) errors.push('TRACKING_SECRET en az 32 karakter ve örnek değerden farklı olmalı (openssl rand -base64 32)');
  if (!c.WA_VERIFY_TOKEN.trim() || c.WA_VERIFY_TOKEN === 'dev-verify') {
    errors.push('WA_VERIFY_TOKEN boş ya da varsayılan olamaz (openssl rand -hex 16)');
  }
  if (c.SMS_PROVIDER === 'netgsm' && (!c.NETGSM_USERCODE || !c.NETGSM_PASSWORD || !c.NETGSM_HEADER)) {
    errors.push('SMS_PROVIDER=netgsm için NETGSM_USERCODE, NETGSM_PASSWORD ve NETGSM_HEADER zorunlu');
  }
  if (c.PLATFORM_WA_PROVIDER !== 'mock' && !c.PLATFORM_WA_API_KEY) {
    errors.push(`PLATFORM_WA_PROVIDER=${c.PLATFORM_WA_PROVIDER} için PLATFORM_WA_API_KEY zorunlu`);
  }
  if (c.PLATFORM_WA_PROVIDER === 'cloud' && !c.PLATFORM_WA_PHONE_NUMBER_ID) {
    errors.push('PLATFORM_WA_PROVIDER=cloud için PLATFORM_WA_PHONE_NUMBER_ID zorunlu');
  }
  return errors;
}

/**
 * Üretimde başlatmayı engellemeyen ama loglanan uyarılar: taklit (mock) sağlayıcılar hiçbir mesajı gerçekten
 * göndermez (kurulum aşamasında bilerek seçilebilir; canlıya çıkmadan önce değiştirilmeli).
 */
export function productionConfigWarnings(c: Pick<Config, 'NODE_ENV' | 'SMS_PROVIDER' | 'WA_DEFAULT_PROVIDER' | 'PLATFORM_WA_PROVIDER'>): string[] {
  if (c.NODE_ENV !== 'production') return [];
  const out: string[] = [];
  if (c.SMS_PROVIDER === 'mock') out.push('SMS_PROVIDER=mock: SMS OTP ve alarm SMS\'leri gönderilmez');
  if (c.PLATFORM_WA_PROVIDER === 'mock') out.push('PLATFORM_WA_PROVIDER=mock: işletme sahibine platform WhatsApp uyarıları gönderilmez');
  if (c.WA_DEFAULT_PROVIDER === 'mock') out.push('WA_DEFAULT_PROVIDER=mock: yeni WhatsApp hesapları taklit sağlayıcıyla açılır');
  return out;
}

/** VAPID anahtarlarının üçü de dolu mu (Web Push açık). */
export function isPushConfigured(c: Pick<ParsedConfig, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>): boolean {
  return Boolean(c.VAPID_PUBLIC_KEY && c.VAPID_PRIVATE_KEY && c.VAPID_SUBJECT);
}

/**
 * Web Push yapılandırma uyarıları (üretimde; başlatmayı engellemez). Push isteğe bağlıdır: anahtarlar yoksa yeni
 * sipariş uyarısı yalnız açık paneldeki sesle ve sonraki alarm basamaklarıyla (platform WhatsApp, SMS) ulaşır.
 * Taklit sağlayıcı uyarılarından (productionConfigWarnings) ayrı tutulur.
 */
export function webPushConfigWarnings(
  c: Pick<Config, 'NODE_ENV' | 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>,
): string[] {
  if (c.NODE_ENV !== 'production' || isPushConfigured(c)) return [];
  const missing = (['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const).filter((k) => !c[k]);
  return [
    `Web Push kapalı (${missing.join(', ')} boş): panel kapalıyken yeni sipariş bildirimi cihazlara gitmez. ` +
      'Anahtar üretmek için: docker compose run --rm --no-deps api npx web-push generate-vapid-keys (15 §4)',
  ];
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Geçersiz yapılandırma: ${msg}`);
  }
  const c = parsed.data;
  const prodErrors = productionConfigErrors(c);
  if (prodErrors.length) throw new Error(`Geçersiz üretim yapılandırması: ${prodErrors.join('; ')}`);
  return {
    ...c,
    ADMIN_TOTP_REQUIRED: c.ADMIN_TOTP_REQUIRED ?? c.NODE_ENV === 'production',
    pushEnabled: isPushConfigured(c),
    cookieSecure: c.NODE_ENV === 'production' || c.APP_BASE_URL.startsWith('https://'),
    uploadDirAbs: resolve(process.cwd(), c.UPLOAD_DIR),
  };
}
