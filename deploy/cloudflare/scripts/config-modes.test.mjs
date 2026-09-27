// scripts/config-modes.mjs: alan adı kipi (canlı ortam, demo verisi yok) ve gizli staging (yalnız isteğe bağlı VPS
// canlıdayken) — 00 §12a madde 10.
// Çalıştır: npm test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildConfig } from './config-modes.mjs';
import { stripJsonc } from './jsonc.mjs';

const base = () => JSON.parse(stripJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')));
const STAGING_URL = 'https://siparisinonunde-dev.ornek.workers.dev';

test('alan adı kipi (canlı ortam): yemekgelsin.net Custom Domain, SEED_MODE=admin, veri dönemi 3, uyarı ve demo vitrin yok, lead formu açık, simülatör yok', () => {
  const c = buildConfig(base(), { url: 'https://yemekgelsin.net/' });
  assert.deepEqual(c.routes.map((r) => r.pattern), ['yemekgelsin.net', 'www.yemekgelsin.net']);
  assert.equal(c.vars.APP_BASE_URL, 'https://yemekgelsin.net');
  assert.equal(c.vars.DEPLOY_MODE, 'domain');
  assert.equal(c.vars.SEED_MODE, 'admin');
  assert.equal(c.vars.DATA_EPOCH, '3');
  // DEPLOY_ENV Worker'da kipten türetilir (src/mode.ts: domain → production); eski değişken yazılmaz
  assert.equal('DEPLOY_ENV' in c.vars, false);
  assert.equal('DEPLOY_ENV' in buildConfig({ ...base(), vars: { ...base().vars, DEPLOY_ENV: 'dev' } }, { url: 'https://yemekgelsin.net' }).vars, false);
  assert.equal('STAGING_DATA_EPOCH' in c.vars, false);
  assert.deepEqual(c.containers[0].image_vars, {
    NEXT_PUBLIC_SITE_URL: 'https://yemekgelsin.net',
    NEXT_PUBLIC_DEMO_BANNER: '0',
    NEXT_PUBLIC_DEMO_STORE_SLUG: '',
    // /demo lead formu açık (aktarım aydınlatma metinlerinde yazılı); WhatsApp simülatörü derlenmez; destek hattı
    // verilmediyse boş
    NEXT_PUBLIC_LEAD_FORM: '1',
    NEXT_PUBLIC_DEV_TOOLS: '0',
    NEXT_PUBLIC_SUPPORT_WHATSAPP: '',
  });
  const withSupport = buildConfig(base(), { url: 'https://yemekgelsin.net', supportWhatsapp: '+90 532 123 45 67' });
  assert.equal(withSupport.containers[0].image_vars.NEXT_PUBLIC_SUPPORT_WHATSAPP, '905321234567');
  assert.throws(() => buildConfig(base(), { url: 'https://yemekgelsin.net', supportWhatsapp: '12' }), /SUPPORT_WHATSAPP/);
});

test('gizli staging: routes yok (yalnız workers.dev), SEED_MODE=demo, kendi veri dönemi, demo uyarısı açık', () => {
  const c = buildConfig(base(), { url: STAGING_URL, mode: 'staging' });
  assert.equal(c.routes, undefined);
  assert.equal(c.workers_dev, true);
  assert.equal(c.vars.APP_BASE_URL, STAGING_URL);
  assert.equal(c.vars.DEPLOY_MODE, 'staging');
  assert.equal(c.vars.SEED_MODE, 'demo');
  assert.equal(c.vars.DATA_EPOCH, base().vars.STAGING_DATA_EPOCH);
  assert.notEqual(c.vars.DATA_EPOCH, base().vars.DATA_EPOCH);
  assert.equal(c.containers[0].image_vars.NEXT_PUBLIC_DEMO_BANNER, '1');
  assert.equal(c.containers[0].image_vars.NEXT_PUBLIC_DEMO_STORE_SLUG, 'bozok-pide');
  assert.equal(c.containers[0].image_vars.NEXT_PUBLIC_SITE_URL, STAGING_URL);
  assert.equal(c.containers[0].image_vars.NEXT_PUBLIC_LEAD_FORM, '1');
  assert.equal(c.containers[0].image_vars.NEXT_PUBLIC_DEV_TOOLS, '1');
  // Staging gizlidir: destek hattı gösterilmez
  const s2 = buildConfig(base(), { url: STAGING_URL, mode: 'staging', supportWhatsapp: '905321234567' });
  assert.equal(s2.containers[0].image_vars.NEXT_PUBLIC_SUPPORT_WHATSAPP, '');
});

test('hatalı girdiler reddedilir', () => {
  assert.throws(() => buildConfig(base(), { url: 'http://yemekgelsin.net' }), /Geçersiz adres/);
  assert.throws(() => buildConfig(base(), { url: 'https://yemekgelsin.net', mode: 'staging' }), /yalnız workers\.dev/);
  assert.throws(() => buildConfig(base(), { url: STAGING_URL }), /routes "siparisinonunde-dev\.ornek\.workers\.dev"/);
  assert.throws(() => buildConfig(base(), { url: 'https://yemekgelsin.net', mode: 'prod' }), /Geçersiz kip/);
  const same = base();
  same.vars.STAGING_DATA_EPOCH = same.vars.DATA_EPOCH;
  assert.throws(() => buildConfig(same, { url: 'https://yemekgelsin.net' }), /aynı olamaz/);
  const bad = base();
  bad.vars.DATA_EPOCH = '../x';
  assert.throws(() => buildConfig(bad, { url: 'https://yemekgelsin.net' }), /DATA_EPOCH geçersiz/);
  // Girdi nesnesi değiştirilmez
  const b = base();
  buildConfig(b, { url: STAGING_URL, mode: 'staging' });
  assert.ok(Array.isArray(b.routes));
});

test('secrets.mjs --no-whatsapp (staging): WhatsApp secret\'ları ortamda olsa da yüklenmez', () => {
  const env = {
    PATH: process.env.PATH,
    DEV_PASSWORD: 'dev-parola-123',
    META_WA_TOKEN: 'EAAG-token',
    META_WA_PHONE_NUMBER_ID: '109876543210',
    META_APP_SECRET: 'app-secret',
    WA_PHONE: '+905321234567',
  };
  const script = new URL('./secrets.mjs', import.meta.url).pathname;
  const staging = spawnSync(process.execPath, [script, '/yok.json', '--no-whatsapp'], { env, encoding: 'utf8' });
  assert.equal(staging.status, 0, staging.stderr);
  const out = JSON.parse(staging.stdout);
  assert.equal(out.META_WA_TOKEN, undefined);
  assert.equal(out.WA_PHONE, undefined);
  assert.equal(out.DEV_PASSWORD, 'dev-parola-123');
  const domain = spawnSync(process.execPath, [script, '/yok.json'], { env, encoding: 'utf8' });
  assert.equal(JSON.parse(domain.stdout).META_WA_TOKEN, 'EAAG-token');
});
