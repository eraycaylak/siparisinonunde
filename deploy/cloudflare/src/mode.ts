// Dağıtım kipine göre container ve Worker ayarları (00 §12a madde 10; 15 §13). Saf fonksiyon: scripts/mode.test.mjs ile
// denenir (node --test; Node'un tür ayıklamasıyla çalışır, bu yüzden yalnız silinebilir TypeScript sözdizimi kullanılır).
//
//   domain  — CANLI ORTAM (https://yemekgelsin.net): gerçek veri, üretim kipi. DEPLOY_ENV=production (API üretim
//             kurallarıyla açılır), yönetici 2FA'sı zorunlu, geliştirici araçları ve simülatör kapalı (Worker /dev/* ve
//             /api/v1/dev/* için 404 döner), lead formu açık, arama motorlarına açık.
//   staging — yalnız isteğe bağlı Türkiye VPS'i canlıdayken (VPS_HOST): gizli, demo verili test ortamı. DEPLOY_ENV=dev
//             (simülatör: tüm sağlayıcılar mock), 2FA isteğe bağlı, arama motorlarına kapalı.

import type { DeployMode } from './access';

export interface ModeSettings {
  /** Container'daki DEPLOY_ENV (apps/api/src/config.ts): production | dev */
  deployEnv: 'production' | 'dev';
  /** Container'daki DEV_TOOLS: WhatsApp simülatörü ve /api/v1/dev/* (üretimde API 1'i reddeder) */
  devTools: '0' | '1';
  /** Platform yöneticileri için iki adımlı doğrulama zorunlu mu (00 §12a madde 7) */
  adminTotpRequired: 'true' | 'false';
  /** Herkese açık lead formu (POST /api/v1/public/leads) kayıt alır mı */
  publicLeads: '0' | '1';
  /** Tüm yanıtlara x-robots-tag: noindex, nofollow eklenir mi */
  noindex: boolean;
  /** Geliştirici araçları yolları (/dev/*, /api/v1/dev/*) Worker'da doğrudan 404 mü (container'a gitmez) */
  blockDevTools: boolean;
}

export function modeSettings(mode: DeployMode): ModeSettings {
  if (mode === 'staging') {
    return { deployEnv: 'dev', devTools: '1', adminTotpRequired: 'false', publicLeads: '1', noindex: true, blockDevTools: false };
  }
  return { deployEnv: 'production', devTools: '0', adminTotpRequired: 'true', publicLeads: '1', noindex: false, blockDevTools: true };
}

/** Container ortamının girdileri (Worker'ın vars ve secret'ları; DATA_EPOCH doğrulanmış). */
export interface ContainerInputs {
  APP_BASE_URL: string;
  APP_VERSION?: string;
  /** Doğrulanmış veri dönemi (src/access.ts normalizeEpoch) */
  DATA_EPOCH: string;
  SEED_MODE?: string;
  DEV_PASSWORD: string;
  SESSION_SECRET: string;
  TRACKING_SECRET: string;
  ENCRYPTION_KEY: string;
  WA_VERIFY_TOKEN: string;
  PLATFORM_WA_WEBHOOK_TOKEN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
}

/**
 * Container'ın ortam değişkenleri (API, worker, web ve entrypoint.sh okur). waEnv: ortak numara ortamı
 * (src/whatsapp-env.ts whatsappContainerEnv().env; staging'de her zaman mock). Saf fonksiyon: kip ayarları
 * (modeSettings) WhatsApp ortamından SONRA yazılır, yani WhatsApp yapılandırması geliştirici araçlarını açamaz.
 * apps/api/test/production-env.test.ts bu çıktının API'nin üretim açılış denetiminden (loadConfig) geçtiğini sınar.
 */
export function containerEnv(mode: DeployMode, env: ContainerInputs, waEnv: Record<string, string>): Record<string, string> {
  const settings = modeSettings(mode);
  const staging = mode === 'staging';
  const seedMode = env.SEED_MODE === 'demo' || env.SEED_MODE === 'admin' ? env.SEED_MODE : staging ? 'demo' : 'admin';
  return {
    NODE_ENV: 'production',
    APP_VERSION: env.APP_VERSION ?? '',
    // Canlı ortamda production: API üretim kurallarıyla açılır (zayıf gizli anahtar, DEV_TOOLS=1 reddedilir), demo seed
    // reddedilir, yönetici 2FA'sı zorunludur. Staging dev: simülatöre izin verir (tüm sağlayıcılar mock iken).
    DEPLOY_ENV: settings.deployEnv,
    TZ: 'UTC',
    APP_BASE_URL: env.APP_BASE_URL,
    // Veri dönemi container'ın ömrü boyunca sabittir: entrypoint.sh yedek yoluna yazar (/e3/db). Geçersizse entrypoint
    // açılmadan çıkar; iş akışı da dağıtımdan önce denetler (scripts/prepare-config.mjs).
    DATA_EPOCH: env.DATA_EPOCH,
    SESSION_SECRET: env.SESSION_SECRET,
    TRACKING_SECRET: env.TRACKING_SECRET,
    ENCRYPTION_KEY: env.ENCRYPTION_KEY,
    WA_VERIFY_TOKEN: env.WA_VERIFY_TOKEN,
    // İşletmenin kendi numarası: sağlayıcısı henüz yok (kendi numara modunu yönetici açar; 00 §12a madde 8)
    WA_DEFAULT_PROVIDER: 'mock',
    // Ortak numara (00 §12a madde 8): tüm dükkanların tek numarası. Webhook belirteci Meta'ya girilecek adresin parçasıdır
    // (/api/v1/webhooks/wa/shared/<belirteç>); tanımsızsa ortak webhook 404 döner.
    PLATFORM_WA_WEBHOOK_TOKEN: env.PLATFORM_WA_WEBHOOK_TOKEN,
    // PLATFORM_WA_PROVIDER (+ gerçek kipte PLATFORM_WA_API_KEY, PLATFORM_WA_PHONE_NUMBER_ID, PLATFORM_WA_WABA_ID,
    // WA_APP_SECRET, PLATFORM_WA_DISPLAY_PHONE)
    ...waEnv,
    // Geliştirici araçları (WhatsApp simülatörü, /api/v1/dev/*): canlı ortamda her zaman kapalı
    DEV_TOOLS: settings.devTools,
    SMS_PROVIDER: 'mock',
    // Herkese açık lead formu (POST /api/v1/public/leads): açık (kişisel veri aktarımı aydınlatma metinlerinde yazılı)
    PUBLIC_LEADS_ENABLED: settings.publicLeads,
    // Platform yöneticileri için iki adımlı doğrulama (00 §12a madde 7): canlı ortamda zorunlu (ilk girişte kurulur)
    ADMIN_TOTP_REQUIRED: settings.adminTotpRequired,
    // Seed kipi (00 §12a madde 10): admin → yalnız platform yöneticisi + bayraklar; demo → demo işletmeler (staging)
    SEED_MODE: seedMode,
    // Seed hesaplarının parolası = DEV_PASSWORD (packages/db/src/seed.ts; değişirse açılışta eşitlenir)
    SEED_PASSWORD: env.DEV_PASSWORD,
    VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: env.APP_BASE_URL,
    UPLOAD_DIR: '/data/uploads',
    LOG_LEVEL: 'info',
  };
}
