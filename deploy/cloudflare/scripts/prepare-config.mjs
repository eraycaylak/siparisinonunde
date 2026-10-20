// wrangler.jsonc → wrangler.generated.jsonc: iş akışının seçtiği kipe göre (scripts/config-modes.mjs; 00 §12a madde 10)
// sitenin adresini derleme değişkenine (NEXT_PUBLIC_SITE_URL) ve çalışma değişkenine (APP_BASE_URL), kipi (DEPLOY_MODE),
// seed kipini (SEED_MODE), veri dönemini (DATA_EPOCH), demo uyarısı/vitrin, lead formu ve simülatör derleme değişkenlerini
// yazar. Ortam: SUPPORT_WHATSAPP (isteğe bağlı GitHub secret'ı; alan adı kipinde destek hattının WhatsApp bağlantısı).
// Kullanım:
//   node scripts/prepare-config.mjs https://yemekgelsin.net                        # alan adı kipi = canlı ortam (varsayılan)
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
// Dağıtılan commit (iş akışı APP_VERSION=DEPLOY_SHA verir): container'a BAŞLARKEN geçer, /api/v1/health `version`'da
// görünür; duman testi eski container yerine yeni sürüm yanıt verene kadar bekler.
// Aynı değer İMAJA da gömülür (image_vars → Dockerfile ARG/ENV IMAGE_VERSION → /api/v1/health `imageVersion`): ortam
// her başlatmada yeni Worker'dan gelir, imaj ise rollout'a bağlıdır; ikisi birlikte "yeni kod gerçekten çalışıyor"
// demektir (src/surum-yenileme.ts guncelMi, iş akışının duman testi).
// DEPLOY_ID (iş akışı: GitHub run kimliği-denemesi) yalnız Worker'da kalır: sürüm eşitlemenin döngü korumasının
// anahtarıdır, aynı commit'in yeniden dağıtımı yeni deneme hakkı alır (container'a geçmez).
const appVersion = (process.env.APP_VERSION ?? '').trim();
config.vars = { ...config.vars, APP_VERSION: appVersion, DEPLOY_ID: (process.env.DEPLOY_ID ?? '').trim() };
for (const c of config.containers ?? []) c.image_vars = { ...(c.image_vars ?? {}), IMAGE_VERSION: appVersion };
writeFileSync(join(root, 'wrangler.generated.jsonc'), `// scripts/prepare-config.mjs üretir; elle düzenlemeyin.\n${JSON.stringify(config, null, 2)}\n`);
const v = config.vars;
const iv = config.containers?.[0]?.image_vars ?? {};
console.log(`wrangler.generated.jsonc yazıldı: ${v.APP_BASE_URL} (kip ${v.DEPLOY_MODE}${v.DEPLOY_MODE === 'staging' ? ', gizli staging' : ', canlı ortam'}, seed ${v.SEED_MODE}, veri dönemi ${v.DATA_EPOCH}, lead formu ${iv.NEXT_PUBLIC_LEAD_FORM === '0' ? 'kapalı' : 'açık'}, simülatör ${iv.NEXT_PUBLIC_DEV_TOOLS === '1' ? 'açık' : 'kapalı'}, destek hattı ${iv.NEXT_PUBLIC_SUPPORT_WHATSAPP ? 'var' : 'yok'}${config.routes ? `, özel alan adları: ${config.routes.map((r) => r.pattern).join(', ')}` : ', özel alan adı yok'})`);
