// src/whatsapp-env.ts: ortak numaranın kipi, Cloudflare ortamı (15 §13). Çalıştır: npm test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REQUIRED_WA_SECRETS, WA_SECRET_NAMES, isMetaId, normalizeE164, whatsappContainerEnv, whatsappSecretsConflict } from '../src/whatsapp-env.ts';

const FULL = {
  META_WA_TOKEN: ' EAAG-token ',
  META_WA_PHONE_NUMBER_ID: '109876543210',
  META_WA_WABA_ID: '209876543210',
  META_APP_SECRET: 'app-secret',
  WA_PHONE: '+905321234567',
};

test('dört secret tamsa gerçek Meta Cloud API (geliştirici araçlarını kip belirler, src/mode.ts)', () => {
  const r = whatsappContainerEnv(FULL);
  assert.equal(r.mode, 'cloud');
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.env, {
    PLATFORM_WA_PROVIDER: 'cloud',
    PLATFORM_WA_API_KEY: 'EAAG-token',
    PLATFORM_WA_PHONE_NUMBER_ID: '109876543210',
    PLATFORM_WA_WABA_ID: '209876543210',
    WA_APP_SECRET: 'app-secret',
    PLATFORM_WA_DISPLAY_PHONE: '+905321234567',
  });
  // WABA isteğe bağlı: yoksa değişken hiç verilmez
  const noWaba = whatsappContainerEnv({ ...FULL, META_WA_WABA_ID: '' });
  assert.equal(noWaba.mode, 'cloud');
  assert.equal('PLATFORM_WA_WABA_ID' in noWaba.env, false);
});

test('biri bile eksikse ya da telefon geçersizse mock; gösterim numarası verilmez (canlı vitrinde sahte numara görünmesin)', () => {
  const mockEnv = { PLATFORM_WA_PROVIDER: 'mock' };
  assert.deepEqual(whatsappContainerEnv({}), { mode: 'mock', missing: [...REQUIRED_WA_SECRETS], env: mockEnv });
  for (const k of REQUIRED_WA_SECRETS) {
    const r = whatsappContainerEnv({ ...FULL, [k]: '  ' });
    assert.equal(r.mode, 'mock', k);
    assert.deepEqual(r.missing, [k]);
    assert.deepEqual(r.env, mockEnv);
    assert.equal(JSON.stringify(r).includes('EAAG'), false, 'simülatör kipinde token container\'a gitmez');
  }
  const bad = whatsappContainerEnv({ ...FULL, WA_PHONE: 'numara' });
  assert.equal(bad.mode, 'mock');
  assert.deepEqual(bad.missing, ['WA_PHONE (E.164 değil)']);
});

const D360 = { D360_API_KEY: ' d360-anahtar-AbC123 ', WA_PHONE: '0532 123 45 67' };

test('360dialog (varsayılan yol): D360_API_KEY + WA_PHONE → d360; imza anahtarı ve Meta kimlikleri verilmez', () => {
  const r = whatsappContainerEnv(D360);
  assert.equal(r.mode, 'd360');
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.env, { PLATFORM_WA_PROVIDER: 'd360', PLATFORM_WA_API_KEY: 'd360-anahtar-AbC123', PLATFORM_WA_DISPLAY_PHONE: '+905321234567' });
  assert.equal('conflict' in r, false);
  // Kısmi (eski) META_* artıkları çakışma değildir: 360dialog seçilir, Meta değerleri container'a gitmez
  const leftover = whatsappContainerEnv({ ...D360, META_WA_TOKEN: 'EAAG-eski', META_WA_WABA_ID: '209876543210' });
  assert.equal(leftover.mode, 'd360');
  assert.equal(JSON.stringify(leftover.env).includes('EAAG'), false);
  assert.equal('PLATFORM_WA_WABA_ID' in leftover.env, false);
  assert.equal(WA_SECRET_NAMES.includes('D360_API_KEY'), true);
});

test('360dialog: telefon eksik ya da geçersizse mock ve eksik listesi; anahtar container\'a gitmez', () => {
  const noPhone = whatsappContainerEnv({ D360_API_KEY: 'k-123' });
  assert.deepEqual(noPhone, { mode: 'mock', missing: ['WA_PHONE'], env: { PLATFORM_WA_PROVIDER: 'mock' } });
  const bad = whatsappContainerEnv({ D360_API_KEY: 'k-123', WA_PHONE: 'numara' });
  assert.deepEqual(bad, { mode: 'mock', missing: ['WA_PHONE (E.164 değil)'], env: { PLATFORM_WA_PROVIDER: 'mock' } });
});

test('iki yol birlikte (D360_API_KEY + tam META_* seti): belirsiz → gerçek numara açılmaz, Türkçe hata', () => {
  const both = { ...FULL, D360_API_KEY: 'k-123' };
  const msg = whatsappSecretsConflict(both);
  assert.match(msg, /belirsiz/);
  assert.match(msg, /D360_API_KEY/);
  assert.match(msg, /META_WA_TOKEN/);
  const r = whatsappContainerEnv(both);
  assert.equal(r.mode, 'mock');
  assert.equal(r.conflict, msg);
  assert.deepEqual(r.env, { PLATFORM_WA_PROVIDER: 'mock' });
  assert.equal(JSON.stringify(r.env).includes('k-123'), false);
  // Tek yol çakışma değildir
  assert.equal(whatsappSecretsConflict(FULL), null);
  assert.equal(whatsappSecretsConflict(D360), null);
  assert.equal(whatsappSecretsConflict({ ...FULL, D360_API_KEY: '   ' }), null);
  assert.equal(whatsappSecretsConflict({ ...D360, META_WA_TOKEN: 'x', META_APP_SECRET: 'y' }), null);
});

test('telefon E.164\'e çevrilir; Meta kimliği yalnız rakam', () => {
  for (const v of ['+90 532 123 45 67', '0532 123 45 67', '905321234567', '00905321234567', '5321234567', '(0532) 123-45-67']) {
    assert.equal(normalizeE164(v), '+905321234567', v);
  }
  assert.equal(normalizeE164('+44 20 7946 0958'), '+442079460958');
  for (const v of ['', '   ', 'abc', '123', '+0532', undefined, null]) assert.equal(normalizeE164(v), null, String(v));
  assert.equal(whatsappContainerEnv({ ...FULL, WA_PHONE: '0532 123 45 67' }).env.PLATFORM_WA_DISPLAY_PHONE, '+905321234567');
  assert.equal(isMetaId('109876543210'), true);
  assert.equal(isMetaId(' 109876543210 '), true);
  for (const v of ['+905321234567', 'abc123', '12', '', undefined]) assert.equal(isMetaId(v), false, String(v));
});

test('secrets.mjs: WhatsApp secret\'ları yalnız doluysa yüklenir, telefon çevrilir, hatalı değer dağıtımı durdurur', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wa-secrets-'));
  const existing = join(dir, 'existing.json');
  writeFileSync(existing, JSON.stringify([{ name: 'SESSION_SECRET' }]));
  const run = (env) =>
    spawnSync(process.execPath, [new URL('./secrets.mjs', import.meta.url).pathname, existing], {
      env: { PATH: process.env.PATH, DEV_PASSWORD: 'parola-12345', ...env },
      encoding: 'utf8',
    });
  const none = run({});
  assert.equal(none.status, 0, none.stderr);
  const outNone = JSON.parse(none.stdout);
  assert.equal(Object.keys(outNone).some((k) => k.startsWith('META_') || k === 'WA_PHONE'), false);
  assert.equal('SESSION_SECRET' in outNone, false);

  const full = run({ ...FULL, META_WA_WABA_ID: '', WA_PHONE: '0532 123 45 67' });
  assert.equal(full.status, 0, full.stderr);
  const out = JSON.parse(full.stdout);
  assert.equal(out.WA_PHONE, '+905321234567');
  assert.equal(out.META_WA_TOKEN, 'EAAG-token');
  assert.equal('META_WA_WABA_ID' in out, false);
  assert.equal(full.stderr.includes('EAAG'), false, 'değerler loga yazılmaz');

  const bad = run({ WA_PHONE: 'numara', META_WA_PHONE_NUMBER_ID: '+905321234567' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /WA_PHONE/);
  assert.match(bad.stderr, /META_WA_PHONE_NUMBER_ID yalnız rakamlardan/);
  assert.equal(bad.stdout, '');

  // 360dialog: anahtar ve telefon yüklenir; değer loga yazılmaz
  const d360 = run({ D360_API_KEY: ' d360-gizli-anahtar ', WA_PHONE: '+90 532 123 45 67' });
  assert.equal(d360.status, 0, d360.stderr);
  const outD = JSON.parse(d360.stdout);
  assert.equal(outD.D360_API_KEY, 'd360-gizli-anahtar');
  assert.equal(outD.WA_PHONE, '+905321234567');
  assert.equal(Object.keys(outD).some((k) => k.startsWith('META_')), false);
  assert.equal(d360.stderr.includes('d360-gizli'), false, 'değerler loga yazılmaz');

  // İki yol birlikte: dağıtım durur (Türkçe hata), hiçbir şey yazılmaz
  const both = run({ ...FULL, D360_API_KEY: 'd360-gizli-anahtar' });
  assert.equal(both.status, 1);
  assert.match(both.stderr, /belirsiz/);
  assert.equal(both.stdout, '');
  assert.equal(both.stderr.includes('d360-gizli'), false);

  // Boşluklu anahtar: kopyalama hatası
  const spaced = run({ D360_API_KEY: 'd360 gizli', WA_PHONE: '+905321234567' });
  assert.equal(spaced.status, 1);
  assert.match(spaced.stderr, /D360_API_KEY boşluk içeremez/);

  // Staging: hiçbir WhatsApp secret'ı yüklenmez, çakışma da denetlenmez
  const stagingRun = spawnSync(process.execPath, [new URL('./secrets.mjs', import.meta.url).pathname, existing, '--no-whatsapp'], {
    env: { PATH: process.env.PATH, DEV_PASSWORD: 'parola-12345', ...FULL, D360_API_KEY: 'd360-gizli-anahtar' },
    encoding: 'utf8',
  });
  assert.equal(stagingRun.status, 0, stagingRun.stderr);
  const outS = JSON.parse(stagingRun.stdout);
  assert.equal(Object.keys(outS).some((k) => k.startsWith('META_') || k === 'WA_PHONE' || k === 'D360_API_KEY'), false);
});
