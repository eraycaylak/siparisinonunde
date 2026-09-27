// src/mode.ts: kipe göre container ve Worker ayarları (00 §12a madde 10; 15 §13). Çalıştır: npm test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { containerEnv, modeSettings } from '../src/mode.ts';

test('canlı ortam (alan adı kipi): üretim kipi, 2FA zorunlu, geliştirici araçları kapalı ve Worker\'da 404, lead formu açık, dizinlenir', () => {
  assert.deepEqual(modeSettings('domain'), {
    deployEnv: 'production',
    devTools: '0',
    adminTotpRequired: 'true',
    publicLeads: '1',
    noindex: false,
    blockDevTools: true,
  });
});

test('gizli staging: dev kipi (simülatör), 2FA isteğe bağlı, noindex, geliştirici araçları parolanın arkasında', () => {
  assert.deepEqual(modeSettings('staging'), {
    deployEnv: 'dev',
    devTools: '1',
    adminTotpRequired: 'false',
    publicLeads: '1',
    noindex: true,
    blockDevTools: false,
  });
});

const INPUTS = {
  APP_BASE_URL: 'https://yemekgelsin.net',
  APP_VERSION: 'abc123',
  DATA_EPOCH: '3',
  SEED_MODE: 'admin',
  DEV_PASSWORD: 'yonetici-parolasi-123',
  SESSION_SECRET: 's'.repeat(64),
  TRACKING_SECRET: 't'.repeat(43),
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  WA_VERIFY_TOKEN: 'a'.repeat(32),
  PLATFORM_WA_WEBHOOK_TOKEN: 'b'.repeat(48),
  VAPID_PUBLIC_KEY: 'p'.repeat(87),
  VAPID_PRIVATE_KEY: 'q'.repeat(43),
};

test('containerEnv canlı ortam: DEPLOY_ENV=production, DEV_TOOLS=0, 2FA zorunlu, lead formu açık, seed admin', () => {
  const env = containerEnv('domain', INPUTS, { PLATFORM_WA_PROVIDER: 'mock' });
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.DEPLOY_ENV, 'production');
  assert.equal(env.DEV_TOOLS, '0');
  assert.equal(env.ADMIN_TOTP_REQUIRED, 'true');
  assert.equal(env.PUBLIC_LEADS_ENABLED, '1');
  assert.equal(env.SEED_MODE, 'admin');
  assert.equal(env.SEED_PASSWORD, INPUTS.DEV_PASSWORD);
  assert.equal(env.DATA_EPOCH, '3');
  assert.equal(env.APP_VERSION, 'abc123');
  assert.equal(env.PLATFORM_WA_PROVIDER, 'mock');
  // Mock'ta gösterim numarası verilmez (canlı vitrinde sahte numara görünmesin)
  assert.equal('PLATFORM_WA_DISPLAY_PHONE' in env, false);
  // WhatsApp ortamı geliştirici araçlarını açamaz
  assert.equal(containerEnv('domain', INPUTS, { PLATFORM_WA_PROVIDER: 'mock', DEV_TOOLS: '1' }).DEV_TOOLS, '0');
  // SEED_MODE tanımsız/geçersizse kipin varsayılanı
  assert.equal(containerEnv('domain', { ...INPUTS, SEED_MODE: undefined }, {}).SEED_MODE, 'admin');
  assert.equal(containerEnv('staging', { ...INPUTS, SEED_MODE: 'x' }, {}).SEED_MODE, 'demo');
});

test('containerEnv gizli staging: DEPLOY_ENV=dev, simülatör açık, 2FA isteğe bağlı', () => {
  const env = containerEnv('staging', { ...INPUTS, SEED_MODE: 'demo' }, { PLATFORM_WA_PROVIDER: 'mock' });
  assert.equal(env.DEPLOY_ENV, 'dev');
  assert.equal(env.DEV_TOOLS, '1');
  assert.equal(env.ADMIN_TOTP_REQUIRED, 'false');
  assert.equal(env.SEED_MODE, 'demo');
});

test('Worker ortamı containerEnv ile kurar; eski sabit değerler (DEPLOY_ENV dev, 2FA kapalı) kalmadı', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(src, /this\.envVars = containerEnv\(mode,/);
  assert.doesNotMatch(src, /ADMIN_TOTP_REQUIRED: 'false'/);
  assert.doesNotMatch(src, /env\.DEPLOY_ENV/);
});

test('entrypoint.sh: yedek 2 dakikada bir (değişiklik varsa), kapanışta her durumda', () => {
  const sh = readFileSync(new URL('../entrypoint.sh', import.meta.url), 'utf8');
  assert.match(sh, /BACKUP_INTERVAL_SEC="\$\{BACKUP_INTERVAL_SEC:-120\}"/);
  assert.match(sh, /backup_now force \|\| true\n  pg_ctl/);
  assert.match(sh, /relname <> 'jobs'/);
});
