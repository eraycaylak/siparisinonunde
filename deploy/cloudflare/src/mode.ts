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
  /**
   * Operasyon uyarılarının gittiği adres (apps/api/src/lib/alert.ts; 15 §6.1). Worker secret'ı olarak verilir ve
   * BURADAN container'a geçer: containerEnv bir beyaz listedir, listeye yazılmayan hiçbir Worker değişkeni
   * container'a ulaşmaz — bu satır olmadan API'nin tek uyarı kanalı canlı yolda hiç kurulamıyordu.
   */
  ALERT_WEBHOOK_URL?: string;
  /** Dış kanala gönderilecek en düşük uyarı ağırlığı: info | warning | critical (varsayılan warning). */
  ALERT_MIN_SEVERITY?: string;

  // --- Künye: 6563 m.3 (08 §4.7, §7.5; 15 §4) --------------------------------------------------------
  // Adlar apps/web/lib/site.ts LEGAL_ENTITY_FIELDS ve apps/api/src/services/orders/legal-gate.ts
  // REQUIRED_LEGAL_ENTITY_ENVS ile BİREBİR aynıdır; sapmayı scripts/mode.test.mjs "beyaz liste kapısı" yakalar.
  // GİZLİ DEĞİLLER (kanunen kamuya açık) → Worker secret'ı değil wrangler.jsonc vars.
  // Zorunlu altısı eksikken canlı dağıtımda (DEPLOY_ENV=production) sipariş ucu KALICI 503 döner (fail-closed).
  /** Künye unvanı; şirket belgesindeki unvanla birebir aynı (tahminle doldurulmaz). */
  LEGAL_ENTITY_NAME?: string;
  /** Şirket türü (ör. "Şahıs şirketi"). */
  LEGAL_ENTITY_TYPE?: string;
  /** Açık adres (mahalle, sokak, no, ilçe / il). */
  LEGAL_ENTITY_ADDRESS?: string;
  /** Künye telefonu. */
  LEGAL_ENTITY_PHONE?: string;
  /** Vergi dairesi. */
  LEGAL_ENTITY_TAX_OFFICE?: string;
  /** VKN ya da TCKN. */
  LEGAL_ENTITY_TAX_NO?: string;
  /** MERSİS no — isteğe bağlı (şahıs şirketinde yoksa boş; künyede "Yok" yazar). */
  LEGAL_ENTITY_MERSIS?: string;
  /** Üye olunan meslek odası — isteğe bağlı. */
  LEGAL_ENTITY_CHAMBER?: string;
  /** KEP adresi — isteğe bağlı. */
  LEGAL_ENTITY_KEP?: string;
  /** Künyede ve KVKK başvurusunda gösterilen e-posta; boşsa marka adresi kullanılır (site.ts fallback). */
  LEGAL_SUPPORT_EMAIL?: string;

  // --- Sentetik canary (06 §7.10) --------------------------------------------------------------------
  /** "1": şube açıkken 15 dk'da bir gerçek yoldan test_kind='canary' sipariş geçer. Boş/0 = hiç üretilmez. */
  CANARY_ENABLED?: string;
  /** "1": "bayat panel" uyarısı açık. Panel sessiz ack'i gelene kadar BOŞ bırakılır (yanlış alarm üretir). */
  CANARY_STALE_ALERT?: string;

  // --- WhatsApp oturum kotası (02; apps/api/src/services/messaging/waba-quota.ts) -------------------
  /** Aylık ücretsiz oturum tavanı (pozitif tam sayı); geçersiz değer yok sayılır, varsayılan kullanılır. */
  WABA_CONVERSATION_CAP?: string;
  /** "1": tavana yaklaşıldığında ÖNEMSİZ durum mesajları düşürülür (sipariş mesajları düşmez). */
  WABA_SHED_NONCRITICAL?: string;
}

/**
 * Container'a OLDUĞU GİBİ geçirilen değişkenlerin tam listesi (Worker'ın vars ve secret'larından).
 *
 * containerEnv KAPALI bir beyaz listedir: burada (ya da aşağıdaki gövdede) yazmayan hiçbir Worker değişkeni
 * container'a ULAŞMAZ. Bir değişken apps/api tarafında okunup bu listeye eklenmediğinde canlıda sessizce tanımsız
 * kalır ve `wrangler secret put` ile değer vermek bile işe yaramaz — Faz 0–4'te künye, canary ve kota değişkenleri
 * tam olarak bu yüzden hiç devreye girmemişti (duman testi sipariş ucunu denemediği için dağıtım yeşil yanıyordu).
 * Sapmayı scripts/mode.test.mjs içindeki "beyaz liste kapısı" vakaları yakalar.
 */
const PASSTHROUGH_KEYS: readonly (keyof ContainerInputs)[] = [
  'ALERT_WEBHOOK_URL',
  'ALERT_MIN_SEVERITY',
  'LEGAL_ENTITY_NAME',
  'LEGAL_ENTITY_TYPE',
  'LEGAL_ENTITY_ADDRESS',
  'LEGAL_ENTITY_PHONE',
  'LEGAL_ENTITY_TAX_OFFICE',
  'LEGAL_ENTITY_TAX_NO',
  'LEGAL_ENTITY_MERSIS',
  'LEGAL_ENTITY_CHAMBER',
  'LEGAL_ENTITY_KEP',
  'LEGAL_SUPPORT_EMAIL',
  'CANARY_ENABLED',
  'CANARY_STALE_ALERT',
  'WABA_CONVERSATION_CAP',
  'WABA_SHED_NONCRITICAL',
];

/**
 * Beyaz listedeki değişkenlerden yalnız DEĞER VERİLMİŞ olanları yazar (boşluklar kırpılır). Boş dizgeyi yazmak
 * değişkeni "tanımlı ama geçersiz" yapar: adres/e-posta benzeri alanlarda API'nin üretim açılış denetimini
 * (loadConfig) ilerde kırabilir, künyede de "" ile "hiç verilmedi" ayrımını siler.
 *
 * `String(...)` bilerek yazıldı, tür zaten `string` olsa da: bu değişkenlerin değerleri wrangler.jsonc `vars`'a
 * ELLE girilir ve JSON tırnaksız sayıyı kabul eder (ör. `"WABA_CONVERSATION_CAP": 1000` → Worker'da number).
 * Çıplak `.trim()` o durumda Durable Object yapıcısında TypeError atar, yani container HİÇ açılmaz: tek bir
 * eksik tırnak tüm siteyi indirirdi. Değer metne çevrilir ve kapı ilgili yerde (waba-quota.ts) işler.
 */
function passthroughEnv(env: ContainerInputs): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PASSTHROUGH_KEYS) {
    const value = String(env[key] ?? '').trim();
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Container'ın ortam değişkenleri (API, worker, web ve entrypoint.sh okur). waEnv: ortak numara ortamı
 * (src/whatsapp-env.ts whatsappContainerEnv().env; staging'de her zaman mock). Saf fonksiyon: kip ayarları
 * (modeSettings) hem WhatsApp ortamından hem beyaz listeden SONRA yazılır, yani ne WhatsApp yapılandırması ne de
 * elle verilmiş bir vars/secret geliştirici araçlarını açabilir ya da 2FA'yı kapatabilir.
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
    // Ortak numara (00 §12a madde 8): tüm dükkanların tek numarası. Webhook belirteci 360dialog'a (admin "Webhook'u
    // 360dialog'a kaydet") ya da Meta'ya girilen adresin parçasıdır (/api/v1/webhooks/wa/shared/<belirteç>); tanımsızsa
    // ortak webhook 404 döner.
    PLATFORM_WA_WEBHOOK_TOKEN: env.PLATFORM_WA_WEBHOOK_TOKEN,
    // PLATFORM_WA_PROVIDER (+ 360dialog'da PLATFORM_WA_API_KEY, PLATFORM_WA_DISPLAY_PHONE; Meta doğrudan yolda ayrıca
    // PLATFORM_WA_PHONE_NUMBER_ID, PLATFORM_WA_WABA_ID, WA_APP_SECRET)
    ...waEnv,
    // Olduğu gibi geçen değişkenler (uyarı kanalı, künye, canary, WhatsApp kotası): yalnız değer verilmişse yazılır.
    // Kip ayarlarından ÖNCE gelir ki elle verilmiş bir vars/secret DEV_TOOLS ya da 2FA'yı ezmeye çalışamasın.
    ...passthroughEnv(env),
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
