// wrangler.jsonc → wrangler.generated.jsonc: iş akışının seçtiği kipe göre (scripts/config-modes.mjs; 00 §12a madde 10)
// sitenin adresini derleme değişkenine (NEXT_PUBLIC_SITE_URL) ve çalışma değişkenine (APP_BASE_URL), kipi (DEPLOY_MODE),
// seed kipini (SEED_MODE), veri dönemini (DATA_EPOCH), demo uyarısı/vitrin ve lead formu derleme değişkenlerini yazar.
// Ortam: SUPPORT_WHATSAPP (isteğe bağlı GitHub secret'ı; alan adı kipinde /demo'da destek hattının WhatsApp bağlantısı).
// Kullanım:
//   node scripts/prepare-config.mjs https://yemekgelsin.net                        # alan adı kipi (varsayılan)
//   node scripts/prepare-config.mjs https://siparisinonunde-dev.x.workers.dev --mode staging
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildConfig } from './config-modes.mjs';
import { stripJsonc } from './jsonc.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values, positionals } = parseArgs({ options: { mode: { type: 'string', default: 'domain' } }, allowPositionals: true });

let config;
try {
  config = buildConfig(JSON.parse(stripJsonc(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'))), {
    url: positionals[0],
    mode: values.mode,
    supportWhatsapp: process.env.SUPPORT_WHATSAPP ?? '',
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
// Dağıtılan commit (iş akışı APP_VERSION=github.sha verir): container'a geçer, /api/v1/health'te görünür; duman testi
// eski container yerine yeni sürüm yanıt verene kadar bekler.
config.vars = { ...config.vars, APP_VERSION: process.env.APP_VERSION ?? '' };
writeFileSync(join(root, 'wrangler.generated.jsonc'), `// scripts/prepare-config.mjs üretir; elle düzenlemeyin.\n${JSON.stringify(config, null, 2)}\n`);
const v = config.vars;
const iv = config.containers?.[0]?.image_vars ?? {};
console.log(`wrangler.generated.jsonc yazıldı: ${v.APP_BASE_URL} (kip ${v.DEPLOY_MODE}, seed ${v.SEED_MODE}, veri dönemi ${v.DATA_EPOCH}, lead formu ${iv.NEXT_PUBLIC_LEAD_FORM === '0' ? 'kapalı' : 'açık'}, destek hattı ${iv.NEXT_PUBLIC_SUPPORT_WHATSAPP ? 'var' : 'yok'}${config.routes ? `, özel alan adları: ${config.routes.map((r) => r.pattern).join(', ')}` : ', özel alan adı yok'})`);
