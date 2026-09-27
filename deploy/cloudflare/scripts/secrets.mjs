// Dağıtımda yüklenecek gizli değerler (wrangler deploy --secrets-file). Worker'da zaten olanlara dokunulmaz
// (ENCRYPTION_KEY değişirse yedekteki şifreli veriler okunamaz); eksikler rastgele üretilir. DEV_PASSWORD her
// dağıtımda GitHub secret'ından güncellenir.
// Gerçek WhatsApp (isteğe bağlı; src/whatsapp-env.ts): META_WA_TOKEN, META_WA_PHONE_NUMBER_ID, META_WA_WABA_ID,
// META_APP_SECRET, WA_PHONE ortamda doluysa her dağıtımda yüklenir (boşsa dosyaya yazılmaz; iş akışı Worker'da kalmış
// eskisini siler). WA_PHONE E.164'e çevrilir; geçersiz telefon ya da rakam olmayan Meta kimliği dağıtımı durdurur.
// Gizli staging (--no-whatsapp): WhatsApp secret'ları hiç yüklenmez; staging canlı numarayı kullanmaz (00 §12a madde 10).
// Kullanım: node scripts/secrets.mjs <wrangler secret list çıktısı (JSON)> [--no-whatsapp] > secrets.json
import { createECDH, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WA_SECRET_NAMES, isMetaId, normalizeE164 } from '../src/whatsapp-env.ts';

const noWhatsapp = process.argv.includes('--no-whatsapp');
let existing = new Set();
try {
  const list = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  existing = new Set(Array.isArray(list) ? list.map((s) => s.name) : []);
} catch {
  existing = new Set();
}

function vapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const priv = Buffer.alloc(32);
  const raw = ecdh.getPrivateKey();
  raw.copy(priv, 32 - raw.length);
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: priv.toString('base64url') };
}

const generators = {
  SESSION_SECRET: () => randomBytes(48).toString('base64url'),
  TRACKING_SECRET: () => randomBytes(32).toString('base64url'),
  ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
  WA_VERIFY_TOKEN: () => randomBytes(16).toString('hex'),
  // Ortak numara webhook yolu (/api/v1/webhooks/wa/shared/<belirteç>): en az 16 karakter, "dev" ile başlamaz (hex)
  PLATFORM_WA_WEBHOOK_TOKEN: () => randomBytes(24).toString('hex'),
};

const out = {};
for (const [name, gen] of Object.entries(generators)) if (!existing.has(name)) out[name] = gen();
// VAPID çifti birlikte üretilir; biri eksikse ikisi de yenilenir (eski cihaz abonelikleri yeniden açılır)
if (!existing.has('VAPID_PUBLIC_KEY') || !existing.has('VAPID_PRIVATE_KEY')) {
  const { publicKey, privateKey } = vapidKeys();
  out.VAPID_PUBLIC_KEY = publicKey;
  out.VAPID_PRIVATE_KEY = privateKey;
}
const devPassword = process.env.DEV_PASSWORD ?? '';
if (devPassword.length < 8) {
  console.error('DEV_PASSWORD en az 8 karakter olmalı (GitHub > Settings > Secrets and variables > Actions)');
  process.exit(1);
}
out.DEV_PASSWORD = devPassword;

// Gerçek WhatsApp secret'ları: yalnız doluysa (değerler loga yazılmaz)
const waErrors = [];
for (const name of noWhatsapp ? [] : WA_SECRET_NAMES) {
  const value = (process.env[name] ?? '').trim();
  if (!value) continue;
  if (name === 'WA_PHONE') {
    const phone = normalizeE164(value);
    if (!phone) waErrors.push('WA_PHONE telefon numarası olmalı, ülke koduyla (E.164), ör. +905321234567');
    else out[name] = phone;
  } else if ((name === 'META_WA_PHONE_NUMBER_ID' || name === 'META_WA_WABA_ID') && !isMetaId(value)) {
    waErrors.push(`${name} yalnız rakamlardan oluşmalı (Meta > WhatsApp > API Setup sayfasındaki kimlik; telefon numarası değil)`);
  } else {
    out[name] = value;
  }
}
if (waErrors.length) {
  for (const e of waErrors) console.error(`HATA: ${e} (GitHub > Settings > Secrets and variables > Actions; docs/15 §6.2a)`);
  process.exit(1);
}
console.error(`Yüklenecek gizli değerler: ${Object.keys(out).join(', ')}`);
process.stdout.write(JSON.stringify(out));
