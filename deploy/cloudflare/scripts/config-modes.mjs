// Cloudflare ortamının iki kipi (00 §12a madde 10; 15 §13). wrangler.jsonc alan adı kipini (CANLI ORTAM) tanımlar; bu
// modül iş akışının seçtiği kipe göre wrangler.generated.jsonc içeriğini kurar (scripts/prepare-config.mjs). Saf fonksiyon:
// testleri scripts/config-modes.test.mjs. Container'ın çalışma ayarları (DEPLOY_ENV, DEV_TOOLS, 2FA, noindex) kipten
// Worker'da türetilir (src/mode.ts); burada yalnız adres, seed, veri dönemi ve web derleme değişkenleri yazılır.
//
//   domain  — CANLI ORTAM: https://yemekgelsin.net (Custom Domain routes), veri dönemi vars.DATA_EPOCH, SEED_MODE=admin
//             (yalnız platform yöneticisi + bayraklar; demo verisi yok), "Demo ortamı" uyarısı ve demo vitrin bağlantısı
//             yok, /demo lead formu açık (NEXT_PUBLIC_LEAD_FORM=1), WhatsApp simülatörü derlenmez (NEXT_PUBLIC_DEV_TOOLS=0),
//             varsa destek hattı (SUPPORT_WHATSAPP → NEXT_PUBLIC_SUPPORT_WHATSAPP) gösterilir.
//   staging — yalnız isteğe bağlı Türkiye VPS'i canlıdayken (VPS_HOST secret'ı): yalnız workers.dev (routes yok), gizli
//             (tüm site parolalı), kendi veri dönemi vars.STAGING_DATA_EPOCH, SEED_MODE=demo, uyarı açık, WhatsApp her
//             zaman simülatör (NEXT_PUBLIC_DEV_TOOLS=1), lead formu açık (yalnız ekip dener), destek hattı gösterilmez.

export const MODES = ['domain', 'staging'];
const EPOCH = /^[0-9]{1,6}$/;

/**
 * @param {object} base wrangler.jsonc (ayrıştırılmış)
 * @param {{ url: string, mode?: 'domain' | 'staging', supportWhatsapp?: string }} opts supportWhatsapp: destek hattı
 *   (GitHub secret SUPPORT_WHATSAPP; ülke koduyla, rakamlar), yalnız alan adı kipinde derlemeye yazılır
 * @returns {object} wrangler.generated.jsonc içeriği
 */
export function buildConfig(base, { url, mode = 'domain', supportWhatsapp = '' }) {
  if (!MODES.includes(mode)) throw new Error(`Geçersiz kip: "${mode}" (domain | staging)`);
  const support = String(supportWhatsapp ?? '').replace(/[\s+\-().]/g, '');
  if (support && !/^[1-9]\d{9,14}$/.test(support)) throw new Error('SUPPORT_WHATSAPP ülke koduyla telefon olmalı (rakamlarla, ör. 905321234567)');
  const siteUrl = String(url ?? '').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/.test(siteUrl)) throw new Error(`Geçersiz adres: "${siteUrl}" (https://… bekleniyor)`);
  const host = new URL(siteUrl).hostname;
  const config = structuredClone(base);
  const vars = { ...(config.vars ?? {}) };
  const domainEpoch = String(vars.DATA_EPOCH ?? '').trim();
  const stagingEpoch = String(vars.STAGING_DATA_EPOCH ?? '').trim();
  if (!EPOCH.test(domainEpoch)) throw new Error(`wrangler.jsonc vars.DATA_EPOCH geçersiz: "${domainEpoch}" (yalnız rakam, en çok 6 hane)`);
  if (!EPOCH.test(stagingEpoch)) throw new Error(`wrangler.jsonc vars.STAGING_DATA_EPOCH geçersiz: "${stagingEpoch}" (yalnız rakam, en çok 6 hane)`);
  if (stagingEpoch === domainEpoch) throw new Error('STAGING_DATA_EPOCH, DATA_EPOCH ile aynı olamaz (staging demo verisi alan adı verisine karışır)');
  delete vars.STAGING_DATA_EPOCH;
  // Container'ın DEPLOY_ENV'i kipten türetilir (src/mode.ts: domain → production, staging → dev); eski bir değişken kalmasın
  delete vars.DEPLOY_ENV;

  const staging = mode === 'staging';
  if (staging) {
    if (!host.endsWith('.workers.dev')) throw new Error(`staging yalnız workers.dev adresinde çalışır ("${siteUrl}")`);
    delete config.routes;
    config.workers_dev = true;
  } else {
    const patterns = (config.routes ?? []).filter((r) => r.custom_domain).map((r) => r.pattern);
    if (!patterns.includes(host)) throw new Error(`alan adı kipinde wrangler.jsonc routes "${host}" Custom Domain'ini içermeli`);
  }
  config.vars = {
    ...vars,
    APP_BASE_URL: siteUrl,
    DEPLOY_MODE: mode,
    SEED_MODE: staging ? 'demo' : 'admin',
    DATA_EPOCH: staging ? stagingEpoch : domainEpoch,
  };
  for (const c of config.containers ?? []) {
    c.image_vars = {
      ...c.image_vars,
      NEXT_PUBLIC_SITE_URL: siteUrl,
      NEXT_PUBLIC_DEMO_BANNER: staging ? '1' : '0',
      NEXT_PUBLIC_DEMO_STORE_SLUG: staging ? 'bozok-pide' : '',
      NEXT_PUBLIC_LEAD_FORM: '1',
      NEXT_PUBLIC_DEV_TOOLS: staging ? '1' : '0',
      NEXT_PUBLIC_SUPPORT_WHATSAPP: staging ? '' : support,
    };
  }
  return config;
}
