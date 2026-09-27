// wrangler.jsonc → wrangler.generated.jsonc: sitenin adresini derleme değişkenine (NEXT_PUBLIC_SITE_URL) ve çalışma
// değişkenine (APP_BASE_URL) yazar. İş akışı SITE_URL'yi verir (varsayılan https://yemekgelsin.net).
// Kullanım: node scripts/prepare-config.mjs https://yemekgelsin.net
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsonc } from './jsonc.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+$/.test(url)) {
  console.error(`Geçersiz adres: "${url}" (https://… bekleniyor)`);
  process.exit(1);
}

const config = JSON.parse(stripJsonc(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')));
// Veri dönemi (15 §13): yalnız rakam; container entrypoint'i geçersiz değerde açılmaz, burada dağıtımdan önce durdurulur
const epoch = String(config.vars?.DATA_EPOCH ?? '').trim();
if (epoch !== '' && !/^[0-9]{1,6}$/.test(epoch)) {
  console.error(`wrangler.jsonc vars.DATA_EPOCH geçersiz: "${epoch}" (yalnız rakam, en çok 6 hane)`);
  process.exit(1);
}
config.vars = { ...config.vars, APP_BASE_URL: url };
for (const c of config.containers ?? []) c.image_vars = { ...c.image_vars, NEXT_PUBLIC_SITE_URL: url };
writeFileSync(join(root, 'wrangler.generated.jsonc'), `// scripts/prepare-config.mjs üretir; elle düzenlemeyin.\n${JSON.stringify(config, null, 2)}\n`);
console.log(`wrangler.generated.jsonc yazıldı (${url})`);
