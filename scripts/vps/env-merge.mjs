#!/usr/bin/env node
// Canlı ortam .env birleştirici (00 §12a madde 10; 15 §14). Canlı ortam iş akışı (.github/workflows/deploy-production.yml)
// sunucudaki mevcut /opt/yemekgelsin/app/.env'i indirir, bu betikle birleştirir ve geri yükler (chmod 600).
//
// Kurallar:
//   - Üretilen gizli değerler BİR KEZ üretilir ve SONSUZA DEK korunur: POSTGRES_PASSWORD (veritabanı ilk açılışta bu
//     parolayla kurulur; değişirse bağlantı kopar), SESSION_SECRET, TRACKING_SECRET (değişirse takip linkleri kırılır),
//     ENCRYPTION_KEY (kaybolursa kayıtlı anahtarlar çözülemez), WA_VERIFY_TOKEN, PLATFORM_WA_WEBHOOK_TOKEN (Meta'daki
//     webhook adresi), VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY. Eksikse üretilir; mevcut değer bozuksa KENDİLİĞİNDEN
//     DEĞİŞTİRİLMEZ, dağıtım anlaşılır bir hatayla durur.
//   - Sağlayıcı değerleri her dağıtımda GitHub secret'larından yeniden yazılır: alan adı, Cloudflare token'ı (Caddy
//     DNS-01), WhatsApp (META_* + WA_PHONE → PLATFORM_WA_*; dördü tamsa gerçek "cloud", değilse "mock"), Netgsm
//     (üçü tamsa "netgsm", değilse "mock"). Sabitler: DEPLOY_ENV=production, DEV_TOOLS=0, ADMIN_TOTP_REQUIRED=true,
//     demo vitrin/uyarı kapalı.
//   - Sonuç apps/api/src/config.ts productionConfigErrors'u sağlamalı (apps/api/test/production-env.test.ts bunu gerçek
//     loadConfig ile doğrular); sağlamıyorsa hiçbir şey yazılmaz ve çıkış kodu 1 olur — sunucudaki konteynerlere
//     dokunulmadan önce.
//   - Mevcut dosyadaki bilinmeyen anahtarlar (elle eklenenler) korunur.
//
// Kullanım: node scripts/vps/env-merge.mjs --current <mevcut .env ya da boş dosya> --out <yeni .env>
// Girdiler ortamdan (GitHub secret'ları): CLOUDFLARE_API_TOKEN (zorunlu; CADDY_CLOUDFLARE_API_TOKEN varsa Caddy onu
// kullanır), DOMAIN, ACME_EMAIL, META_WA_TOKEN, META_WA_PHONE_NUMBER_ID, META_WA_WABA_ID, META_APP_SECRET, WA_PHONE,
// NETGSM_USERCODE, NETGSM_PASSWORD, NETGSM_HEADER, SUPPORT_WHATSAPP, BACKUP_REMOTE, BACKUP_PING_URL.
// GitHub Actions'ta (GITHUB_ACTIONS=true) tüm gizli değerler için ::add-mask:: yazar; değerler hiçbir zaman loga basılmaz.

import { createECDH, randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const DEFAULT_DOMAIN = 'yemekgelsin.net';
export const BACKUP_DIR = '/opt/yemekgelsin/backups';

/** Bir kez üretilip korunan gizli değerler. */
export const GENERATED_KEYS = [
  'POSTGRES_PASSWORD',
  'SESSION_SECRET',
  'TRACKING_SECRET',
  'ENCRYPTION_KEY',
  'WA_VERIFY_TOKEN',
  'PLATFORM_WA_WEBHOOK_TOKEN',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
];

/** Loga asla düşmemesi gereken değerler (GitHub'da maskelenir). */
export const SENSITIVE_KEYS = [
  ...GENERATED_KEYS,
  'CLOUDFLARE_API_TOKEN',
  'PLATFORM_WA_API_KEY',
  'WA_APP_SECRET',
  'NETGSM_PASSWORD',
  'NETGSM_USERCODE',
  'BACKUP_PING_URL',
];

/** Dosyadaki bölümler ve anahtar sırası; burada olmayan mevcut anahtarlar "Elle eklenenler" bölümüne gider. */
const SECTIONS = [
  ['Alan adı ve TLS (Caddy; tüm sertifikalar DNS-01)', ['DOMAIN', 'APP_BASE_URL', 'ACME_EMAIL', 'CLOUDFLARE_API_TOKEN']],
  ['Dağıtım (sabit: canlı ortam, geliştirici araçları kapalı, yönetici 2FA zorunlu, demo yok)', ['DEPLOY_ENV', 'DEV_TOOLS', 'ADMIN_TOTP_REQUIRED', 'LOG_LEVEL', 'DEMO_STORE_SLUG', 'DEMO_BANNER', 'SUPPORT_WHATSAPP']],
  ['PostgreSQL (parola bir kez üretilir; DEĞİŞTİRMEYİN)', ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB']],
  ['Uygulama gizli anahtarları (bir kez üretilir, korunur)', ['SESSION_SECRET', 'TRACKING_SECRET', 'ENCRYPTION_KEY']],
  [
    'WhatsApp (ortak numara; GitHub secret\'larından her dağıtımda)',
    ['WA_DEFAULT_PROVIDER', 'WA_APP_SECRET', 'WA_VERIFY_TOKEN', 'PLATFORM_WA_PROVIDER', 'PLATFORM_WA_API_KEY', 'PLATFORM_WA_PHONE_NUMBER_ID', 'PLATFORM_WA_WABA_ID', 'PLATFORM_WA_DISPLAY_PHONE', 'PLATFORM_WA_WEBHOOK_TOKEN'],
  ],
  ['SMS (Netgsm; GitHub secret\'larından her dağıtımda)', ['SMS_PROVIDER', 'NETGSM_USERCODE', 'NETGSM_PASSWORD', 'NETGSM_HEADER']],
  ['Web Push (anahtar çifti bir kez üretilir, korunur)', ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']],
  ['Yedekleme (scripts/backup.sh; yedekler Türkiye\'deki bu sunucuda)', ['BACKUP_DIR', 'RETENTION_DAYS', 'BACKUP_REMOTE', 'BACKUP_PING_URL']],
];

// --- .env okuma/yazma -------------------------------------------------------------------------------------

/** .env metnini sıralı anahtar → değer haritasına çevirir (yorum, boş satır, `export`, tek/çift tırnak). */
export function parseDotenv(text) {
  const out = new Map();
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let rest = line.slice(eq + 1).trim();
    let value;
    if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1);
      value = end === -1 ? rest.slice(1) : rest.slice(1, end);
    } else if (rest.startsWith('"')) {
      let v = '';
      let i = 1;
      for (; i < rest.length; i++) {
        const c = rest[i];
        if (c === '\\' && i + 1 < rest.length) {
          const n = rest[++i];
          v += n === 'n' ? '\n' : n === 't' ? '\t' : n;
        } else if (c === '"') break;
        else v += c;
      }
      value = v;
    } else {
      const hash = rest.search(/\s#/);
      if (hash !== -1) rest = rest.slice(0, hash);
      value = rest.trim();
    }
    out.set(key, value);
  }
  return out;
}

const SAFE_VALUE = /^[A-Za-z0-9_@%+=:,./-]*$/;

/** Değeri compose .env'i ve bash `source` için güvenli yazar: gerekiyorsa tek tırnak (içerik aynen, değişken açılmaz). */
export function formatValue(key, value) {
  const v = String(value ?? '');
  if (/[\r\n]/.test(v)) throw new Error(`${key} satır sonu içeremez`);
  if (SAFE_VALUE.test(v)) return v;
  if (v.includes("'")) throw new Error(`${key} tek tırnak (') içeremez`);
  return `'${v}'`;
}

/** Sıralı .env metni (bölüm başlıkları ve açıklamalarla). */
export function serializeEnv(values, extras) {
  const lines = [
    '# Yemek Gelsin — canlı ortam .env (Türkiye VPS; 00 §12a madde 10, 15 §14).',
    '# BU DOSYAYI CANLI ORTAM İŞ AKIŞI YÖNETİR (scripts/vps/env-merge.mjs). Gizli anahtarlar bir kez üretilir ve korunur;',
    "# sağlayıcı değerleri her dağıtımda GitHub secret'larından yeniden yazılır. Elle eklediğiniz bilinmeyen anahtarlar",
    '# en alttaki bölümde korunur. İzin: 600 (root). Bu dosya kişisel veri değil ama tüm gizli anahtarları içerir.',
  ];
  for (const [title, keys] of SECTIONS) {
    lines.push('', `# --- ${title} ---`);
    for (const k of keys) if (values.has(k)) lines.push(`${k}=${formatValue(k, values.get(k))}`);
  }
  if (extras.size) {
    lines.push('', '# --- Elle eklenenler (iş akışı dokunmaz) ---');
    for (const [k, v] of extras) lines.push(`${k}=${formatValue(k, v)}`);
  }
  return `${lines.join('\n')}\n`;
}

// --- Doğrulama yardımcıları (apps/api/src/config.ts ile aynı kurallar) --------------------------------------

const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const filled = (v) => clean(v) !== '';

/** "+90 532 123 45 67", "0532…", "90532…", "00 90…", "532…" → "+905321234567"; geçersizse null. */
export function normalizeE164(raw) {
  let v = clean(raw).replace(/[\s\-().]/g, '');
  if (!v) return null;
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  else if (/^0\d{10}$/.test(v)) v = `+90${v.slice(1)}`;
  else if (/^90\d{10}$/.test(v)) v = `+${v}`;
  else if (/^5\d{9}$/.test(v)) v = `+90${v}`;
  return /^\+[1-9]\d{7,14}$/.test(v) ? v : null;
}

/** Meta kimliği (Phone number ID, WABA ID): yalnız rakam. */
export function isMetaId(v) {
  return /^\d{5,30}$/.test(clean(v));
}

const isStrongSecret = (v) => v.length >= 32 && !v.startsWith('dev-only');
const isBase64Key32 = (v) => {
  try {
    return /^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, 'base64').length === 32;
  } catch {
    return false;
  }
};
const isWebhookToken = (v) => /^[A-Za-z0-9_-]{16,200}$/.test(v) && !v.startsWith('dev');
const isVapidPublic = (v) => /^[A-Za-z0-9_-]{86,88}={0,2}$/.test(v);
const isVapidPrivate = (v) => /^[A-Za-z0-9_-]{42,44}={0,2}$/.test(v);
const isHostname = (v) => /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v);

/** Gizli değer kuralları: [geçerli mi, hata iletisi]. */
const SECRET_RULES = {
  POSTGRES_PASSWORD: [(v) => /^[A-Za-z0-9]{16,}$/.test(v), 'en az 16 karakter ve yalnız harf/rakam olmalı (DATABASE_URL içine girer)'],
  SESSION_SECRET: [isStrongSecret, 'en az 32 karakter ve örnek (dev-only…) değerden farklı olmalı'],
  TRACKING_SECRET: [isStrongSecret, 'en az 32 karakter ve örnek (dev-only…) değerden farklı olmalı'],
  ENCRYPTION_KEY: [isBase64Key32, '32 bayt base64 olmalı'],
  WA_VERIFY_TOKEN: [(v) => v !== 'dev-verify' && /^[A-Za-z0-9_-]{8,200}$/.test(v), 'boş, varsayılan (dev-verify) ya da 8 karakterden kısa olamaz'],
  PLATFORM_WA_WEBHOOK_TOKEN: [isWebhookToken, 'en az 16 karakter (harf, rakam, - ve _) olmalı ve "dev" ile başlamamalı'],
  VAPID_PUBLIC_KEY: [isVapidPublic, 'base64url biçiminde olmalı'],
  VAPID_PRIVATE_KEY: [isVapidPrivate, 'base64url biçiminde olmalı'],
};

/** Değiştirilirse ne olur (bozuk değer hatasında operatöre söylenir). */
const ROTATION_NOTE = {
  POSTGRES_PASSWORD: 'veritabanı bu parolayla kuruldu; değiştirmek için önce veritabanında ALTER USER gerekir',
  SESSION_SECRET: 'yeni değer üretilince tüm oturumlar kapanır',
  TRACKING_SECRET: 'yeni değer üretilince gönderilmiş takip linkleri kırılır',
  ENCRYPTION_KEY: 'yeni değer üretilince kayıtlı WhatsApp/SMS anahtarları çözülemez; eski geçerli anahtarı geri koyun',
  WA_VERIFY_TOKEN: "yeni değer üretilince Meta webhook doğrulaması (admin > WhatsApp kurulumu > Göster) yenilenmeli",
  PLATFORM_WA_WEBHOOK_TOKEN: "yeni değer üretilince Meta'daki webhook adresi (admin > WhatsApp kurulumu > Göster) yenilenmeli",
  VAPID_PUBLIC_KEY: 'yeni çift üretilince cihazlar bildirimlere yeniden abone olur',
  VAPID_PRIVATE_KEY: 'yeni çift üretilince cihazlar bildirimlere yeniden abone olur',
};

export function generateVapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const priv = Buffer.alloc(32);
  const raw = ecdh.getPrivateKey();
  raw.copy(priv, 32 - raw.length);
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: priv.toString('base64url') };
}

export const DEFAULT_GENERATORS = {
  POSTGRES_PASSWORD: () => randomBytes(24).toString('hex'),
  SESSION_SECRET: () => randomBytes(48).toString('base64url'),
  TRACKING_SECRET: () => randomBytes(32).toString('base64url'),
  ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
  WA_VERIFY_TOKEN: () => randomBytes(16).toString('hex'),
  // hex: "dev" ile başlayamaz (v hex değil)
  PLATFORM_WA_WEBHOOK_TOKEN: () => randomBytes(24).toString('hex'),
  vapid: generateVapidKeys,
};

// --- Birleştirme ----------------------------------------------------------------------------------------

/**
 * @param {{ current: Map<string,string> | Record<string,string>, secrets: Record<string,string|undefined>, generators?: object }} input
 * @returns {{ ok: boolean, text: string | null, values: Map<string,string>, errors: string[], warnings: string[],
 *            generated: string[], kept: string[], whatsapp: 'cloud'|'mock', sms: 'netgsm'|'mock', sensitive: string[] }}
 */
export function mergeEnv({ current, secrets, generators = DEFAULT_GENERATORS }) {
  const cur = current instanceof Map ? new Map(current) : new Map(Object.entries(current ?? {}));
  const s = secrets ?? {};
  const errors = [];
  const warnings = [];
  const generated = [];
  const kept = [];
  const v = new Map();
  const has = (k) => filled(cur.get(k));
  const secretHint = "GitHub > Settings > Secrets and variables > Actions (15 §14)";

  // Alan adı ve TLS
  const domain = (clean(s.DOMAIN) || DEFAULT_DOMAIN).toLowerCase();
  if (!isHostname(domain)) errors.push(`DOMAIN geçersiz: "${domain}" (ör. ${DEFAULT_DOMAIN}).`);
  v.set('DOMAIN', domain);
  v.set('APP_BASE_URL', `https://${domain}`);
  const acme = clean(s.ACME_EMAIL) || clean(cur.get('ACME_EMAIL')) || `destek@${domain}`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acme)) errors.push(`ACME_EMAIL geçerli bir e-posta olmalı ("${acme}").`);
  v.set('ACME_EMAIL', acme);
  const cfToken = clean(s.CADDY_CLOUDFLARE_API_TOKEN) || clean(s.CLOUDFLARE_API_TOKEN);
  if (!cfToken) {
    errors.push(
      `CLOUDFLARE_API_TOKEN GitHub secret'ı yok: Caddy tüm sertifikaları Cloudflare DNS-01 ile alır ve DNS geçişi bu token'la yapılır. ` +
        `Token'da ${domain} için Zone > DNS > Edit ve Zone > Zone > Read olmalı. ${secretHint}`,
    );
  } else if (/\s/.test(cfToken)) {
    errors.push('CLOUDFLARE_API_TOKEN boşluk içeremez (token\'ı yeniden kopyalayın).');
  } else if (!clean(s.CADDY_CLOUDFLARE_API_TOKEN)) {
    // Sunucuya (yalnız caddy konteynerine; docker-compose.yml x-api-base uygulamaya boş verir) Workers yetkili token yazılır
    warnings.push(
      `CADDY_CLOUDFLARE_API_TOKEN yok: sunucudaki Caddy, DNS geçişi için Workers yetkisi de taşıyan CLOUDFLARE_API_TOKEN'ı kullanıyor. ` +
        `Sunucu ele geçirilirse Workers hesabı da risk altında olur. Yalnız ${domain} için Zone > DNS > Edit + Zone > Zone > Read ` +
        `yetkili ayrı bir token oluşturup CADDY_CLOUDFLARE_API_TOKEN secret'ı olarak ekleyin. ${secretHint}`,
    );
  }
  v.set('CLOUDFLARE_API_TOKEN', cfToken);

  // Dağıtım sabitleri
  v.set('DEPLOY_ENV', 'production');
  v.set('DEV_TOOLS', '0');
  v.set('ADMIN_TOTP_REQUIRED', 'true');
  const logLevel = clean(cur.get('LOG_LEVEL'));
  v.set('LOG_LEVEL', ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].includes(logLevel) ? logLevel : 'info');
  v.set('DEMO_STORE_SLUG', '');
  v.set('DEMO_BANNER', '0');
  const supportRaw = clean(s.SUPPORT_WHATSAPP) || clean(cur.get('SUPPORT_WHATSAPP'));
  const support = supportRaw.replace(/\D/g, '');
  if (supportRaw && !/^[1-9]\d{9,14}$/.test(support)) {
    errors.push('SUPPORT_WHATSAPP ülke koduyla telefon olmalı (rakamlarla, ör. 905321234567).');
  } else if (!support) {
    warnings.push('SUPPORT_WHATSAPP yok: giriş ekranındaki "Parolamı unuttum" destek numarası yerine iletişim formunu gösterir (isteğe bağlı GitHub secret\'ı).');
  }
  v.set('SUPPORT_WHATSAPP', support);

  // PostgreSQL
  v.set('POSTGRES_USER', clean(cur.get('POSTGRES_USER')) || 'siparis');
  v.set('POSTGRES_DB', clean(cur.get('POSTGRES_DB')) || 'siparis');
  for (const k of ['POSTGRES_USER', 'POSTGRES_DB']) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(v.get(k))) errors.push(`${k} yalnız küçük harf, rakam ve _ içermeli (sunucudaki .env).`);
  }

  // Bir kez üretilen gizli değerler
  const takeOrGenerate = (key, gen) => {
    if (has(key)) {
      const value = clean(cur.get(key));
      const [valid, rule] = SECRET_RULES[key];
      if (!valid(value)) {
        errors.push(
          `Sunucudaki .env'de ${key} geçersiz: ${rule}. Kendiliğinden değiştirilmedi (${ROTATION_NOTE[key]}). ` +
            `Düzeltin ya da bilerek yenisini üretmek için sunucuda .env'den bu satırı silip iş akışını yeniden çalıştırın.`,
        );
      }
      v.set(key, value);
      kept.push(key);
    } else {
      v.set(key, gen());
      generated.push(key);
    }
  };
  for (const key of ['POSTGRES_PASSWORD', 'SESSION_SECRET', 'TRACKING_SECRET', 'ENCRYPTION_KEY']) takeOrGenerate(key, generators[key]);

  // WhatsApp: dört secret tamsa gerçek Meta Cloud API, değilse mock (deploy/cloudflare/src/whatsapp-env.ts ile aynı kural)
  v.set('WA_DEFAULT_PROVIDER', 'd360');
  takeOrGenerate('WA_VERIFY_TOKEN', generators.WA_VERIFY_TOKEN);
  const waRequired = ['META_WA_TOKEN', 'META_WA_PHONE_NUMBER_ID', 'META_APP_SECRET', 'WA_PHONE'];
  const waMissing = waRequired.filter((k) => !filled(s[k]));
  let whatsapp = 'mock';
  if (waMissing.length === 0) {
    const phone = normalizeE164(s.WA_PHONE);
    if (!phone) errors.push(`WA_PHONE telefon numarası olmalı, ülke koduyla (E.164), ör. +905321234567. ${secretHint}`);
    if (!isMetaId(s.META_WA_PHONE_NUMBER_ID)) errors.push(`META_WA_PHONE_NUMBER_ID yalnız rakamlardan oluşmalı (Meta > WhatsApp > API Setup; telefon numarası değil). ${secretHint}`);
    if (filled(s.META_WA_WABA_ID) && !isMetaId(s.META_WA_WABA_ID)) errors.push(`META_WA_WABA_ID yalnız rakamlardan oluşmalı (Meta > WhatsApp > API Setup). ${secretHint}`);
    if (/\s/.test(clean(s.META_WA_TOKEN))) errors.push('META_WA_TOKEN boşluk içeremez (token\'ı yeniden kopyalayın).');
    whatsapp = 'cloud';
    v.set('WA_APP_SECRET', clean(s.META_APP_SECRET));
    v.set('PLATFORM_WA_PROVIDER', 'cloud');
    v.set('PLATFORM_WA_API_KEY', clean(s.META_WA_TOKEN));
    v.set('PLATFORM_WA_PHONE_NUMBER_ID', clean(s.META_WA_PHONE_NUMBER_ID));
    v.set('PLATFORM_WA_WABA_ID', clean(s.META_WA_WABA_ID));
    v.set('PLATFORM_WA_DISPLAY_PHONE', phone ?? '');
    if (!filled(s.META_WA_WABA_ID)) {
      warnings.push('META_WA_WABA_ID yok: admin > WhatsApp > WhatsApp kurulumu\'ndaki "Webhook aboneliğini aç" ve "Şablonları gönder" adımları çalışmaz (15 §6.2a).');
    }
  } else {
    if (waMissing.length < waRequired.length) {
      warnings.push(`Gerçek WhatsApp için eksik GitHub secret: ${waMissing.join(', ')}. Hepsi eklenene kadar ortak numara kapalı (mock) çalışır (15 §6.2a).`);
    } else {
      warnings.push('WhatsApp secret\'ları yok: ortak numara kapalı (mock); vitrin ve QR WhatsApp bağlantısı göstermez, platform uyarıları gitmez (15 §6.2a).');
    }
    v.set('WA_APP_SECRET', '');
    v.set('PLATFORM_WA_PROVIDER', 'mock');
    v.set('PLATFORM_WA_API_KEY', '');
    v.set('PLATFORM_WA_PHONE_NUMBER_ID', '');
    v.set('PLATFORM_WA_WABA_ID', '');
    v.set('PLATFORM_WA_DISPLAY_PHONE', '');
  }
  takeOrGenerate('PLATFORM_WA_WEBHOOK_TOKEN', generators.PLATFORM_WA_WEBHOOK_TOKEN);

  // SMS: üç Netgsm secret'ı tamsa netgsm, değilse mock (SMS yedeği bayrağı kapalı başlar: bootstrap-production.ts)
  const smsKeys = ['NETGSM_USERCODE', 'NETGSM_PASSWORD', 'NETGSM_HEADER'];
  const smsMissing = smsKeys.filter((k) => !filled(s[k]));
  let sms = 'mock';
  if (smsMissing.length === 0) {
    sms = 'netgsm';
    v.set('SMS_PROVIDER', 'netgsm');
    for (const k of smsKeys) v.set(k, clean(s[k]));
    if (clean(s.NETGSM_HEADER).length > 11) warnings.push('NETGSM_HEADER 11 karakterden uzun; Netgsm onaylı başlık en çok 11 karakterdir (15 §7).');
  } else {
    if (smsMissing.length < smsKeys.length) warnings.push(`Netgsm için eksik GitHub secret: ${smsMissing.join(', ')}. Hepsi eklenene kadar SMS gönderilmez (mock).`);
    else warnings.push('Netgsm secret\'ları yok: SMS gönderilmez (mock), SMS yedeği bayrağı kapalı başlar (15 §7).');
    v.set('SMS_PROVIDER', 'mock');
    for (const k of smsKeys) v.set(k, '');
  }

  // Web Push: çift birlikte; biri eksikse ikisi de yenilenir
  const pubOk = has('VAPID_PUBLIC_KEY');
  const privOk = has('VAPID_PRIVATE_KEY');
  if (pubOk && privOk) {
    takeOrGenerate('VAPID_PUBLIC_KEY', () => '');
    takeOrGenerate('VAPID_PRIVATE_KEY', () => '');
  } else {
    if (pubOk || privOk) warnings.push('VAPID anahtar çiftinin biri eksikti; yeni çift üretildi (cihazlar bildirimlere yeniden abone olur).');
    const pair = generators.vapid();
    v.set('VAPID_PUBLIC_KEY', pair.publicKey);
    v.set('VAPID_PRIVATE_KEY', pair.privateKey);
    generated.push('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY');
  }
  const subject = clean(cur.get('VAPID_SUBJECT'));
  v.set('VAPID_SUBJECT', /^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject) ? subject : `mailto:destek@${domain}`);

  // Yedekleme
  v.set('BACKUP_DIR', BACKUP_DIR);
  const retention = clean(cur.get('RETENTION_DAYS'));
  v.set('RETENTION_DAYS', /^\d{1,3}$/.test(retention) && Number(retention) >= 1 ? retention : '14');
  v.set('BACKUP_REMOTE', clean(s.BACKUP_REMOTE) || clean(cur.get('BACKUP_REMOTE')));
  const ping = clean(s.BACKUP_PING_URL) || clean(cur.get('BACKUP_PING_URL'));
  if (ping && !/^https:\/\/\S+$/.test(ping)) errors.push('BACKUP_PING_URL https:// ile başlamalı.');
  v.set('BACKUP_PING_URL', ping);
  if (!v.get('BACKUP_REMOTE')) {
    warnings.push('BACKUP_REMOTE yok: yedekler yalnız bu sunucuda (Türkiye) tutulur; ikinci bir Türkiye lokasyonu önerilir (15 §8).');
  }

  // Elle eklenenler: bilinen bölümlerde olmayan mevcut anahtarlar korunur
  const managed = new Set(SECTIONS.flatMap(([, keys]) => keys));
  const extras = new Map();
  for (const [k, val] of cur) if (!managed.has(k)) extras.set(k, val);

  let text = null;
  if (errors.length === 0) {
    try {
      text = serializeEnv(v, extras);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  const sensitive = [...new Set(SENSITIVE_KEYS.map((k) => v.get(k)).filter((x) => typeof x === 'string' && x.length >= 4))];
  return { ok: errors.length === 0, text, values: v, errors, warnings, generated, kept, whatsapp, sms, sensitive };
}

// --- Komut satırı -----------------------------------------------------------------------------------------

function main() {
  const { values: args } = parseArgs({ options: { current: { type: 'string' }, out: { type: 'string' } }, strict: true });
  if (!args.out) {
    console.error('Kullanım: node scripts/vps/env-merge.mjs --current <mevcut .env> --out <yeni .env>');
    process.exit(2);
  }
  let currentText = '';
  if (args.current) {
    try {
      currentText = readFileSync(args.current, 'utf8');
    } catch {
      currentText = '';
    }
  }
  const gh = process.env.GITHUB_ACTIONS === 'true';
  const res = mergeEnv({ current: parseDotenv(currentText), secrets: process.env });
  // Değerler önce maskelenir; sonra hiçbir çıktıda değer yoktur (yalnız anahtar adları)
  if (gh) for (const value of res.sensitive) console.log(`::add-mask::${value}`);
  for (const w of res.warnings) console.log(gh ? `::warning::${w}` : `Uyarı: ${w}`);
  if (!res.ok) {
    for (const e of res.errors) console.log(gh ? `::error::${e}` : `Hata: ${e}`);
    console.error('.env yazılmadı; sunucuya dokunulmadı.');
    process.exit(1);
  }
  writeFileSync(args.out, res.text, { mode: 0o600 });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `whatsapp=${res.whatsapp}\nsms=${res.sms}\nfirst_install=${currentText.trim() ? 'false' : 'true'}\n`);
  }
  console.log(`.env hazır: ${currentText.trim() ? 'mevcut dosya birleştirildi' : 'ilk kurulum'}.`);
  console.log(`  Üretilen gizli değerler: ${res.generated.length ? res.generated.join(', ') : 'yok'}`);
  console.log(`  Korunan gizli değerler : ${res.kept.length ? res.kept.join(', ') : 'yok'}`);
  console.log(`  WhatsApp (ortak numara): ${res.whatsapp === 'cloud' ? 'gerçek Meta Cloud API' : 'kapalı (mock)'}`);
  console.log(`  SMS                    : ${res.sms === 'netgsm' ? 'Netgsm' : 'kapalı (mock)'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
