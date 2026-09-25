// Dağıtımda yüklenecek gizli değerler (wrangler deploy --secrets-file). Worker'da zaten olanlara dokunulmaz
// (ENCRYPTION_KEY değişirse yedekteki şifreli veriler okunamaz); eksikler rastgele üretilir. DEV_PASSWORD her
// dağıtımda GitHub secret'ından güncellenir.
// Kullanım: node scripts/secrets.mjs <wrangler secret list çıktısı (JSON)> > secrets.json
import { createECDH, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

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
console.error(`Yüklenecek gizli değerler: ${Object.keys(out).join(', ')}`);
process.stdout.write(JSON.stringify(out));
