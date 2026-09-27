// scripts/vps/env-merge.mjs testleri (node --test; bağımlılık yok). Uygulamanın gerçek yapılandırma denetimiyle uyumu:
// apps/api/test/production-env.test.ts.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GENERATED_KEYS, formatValue, mergeEnv, normalizeE164, parseDotenv } from './env-merge.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'env-merge.mjs');
const BASE = { CLOUDFLARE_API_TOKEN: 'cf-token-abcdefghijklmnopqrstuvwxyz0123' };
const META = {
  META_WA_TOKEN: 'EAAGmetaSystemUserToken0123456789',
  META_WA_PHONE_NUMBER_ID: '109876543210987',
  META_WA_WABA_ID: '203040506070809',
  META_APP_SECRET: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  WA_PHONE: '0532 123 45 67',
};
const NETGSM = { NETGSM_USERCODE: '8501234567', NETGSM_PASSWORD: 'p@ss#word$1', NETGSM_HEADER: 'YEMEKGELSIN' };

const first = (secrets = BASE) => mergeEnv({ current: new Map(), secrets });
const again = (prevText, secrets = BASE) => mergeEnv({ current: parseDotenv(prevText), secrets });

test('ilk kurulum: gizli değerler üretilir, sabitler canlı ortam değerleridir, sağlayıcılar mock', () => {
  const r = first();
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.deepEqual([...r.generated].sort(), [...GENERATED_KEYS].sort());
  assert.deepEqual(r.kept, []);
  const v = r.values;
  assert.equal(v.get('DOMAIN'), 'yemekgelsin.net');
  assert.equal(v.get('APP_BASE_URL'), 'https://yemekgelsin.net');
  assert.equal(v.get('ACME_EMAIL'), 'destek@yemekgelsin.net');
  assert.equal(v.get('DEPLOY_ENV'), 'production');
  assert.equal(v.get('DEV_TOOLS'), '0');
  assert.equal(v.get('ADMIN_TOTP_REQUIRED'), 'true');
  assert.equal(v.get('DEMO_STORE_SLUG'), '');
  assert.equal(v.get('DEMO_BANNER'), '0');
  assert.equal(v.get('BACKUP_DIR'), '/opt/yemekgelsin/backups');
  assert.equal(v.get('RETENTION_DAYS'), '14');
  assert.equal(v.get('PLATFORM_WA_PROVIDER'), 'mock');
  assert.equal(v.get('SMS_PROVIDER'), 'mock');
  assert.equal(r.whatsapp, 'mock');
  assert.equal(r.sms, 'mock');
  assert.match(v.get('POSTGRES_PASSWORD'), /^[a-f0-9]{48}$/);
  assert.ok(v.get('SESSION_SECRET').length >= 32);
  assert.ok(v.get('TRACKING_SECRET').length >= 32);
  assert.equal(Buffer.from(v.get('ENCRYPTION_KEY'), 'base64').length, 32);
  assert.match(v.get('PLATFORM_WA_WEBHOOK_TOKEN'), /^[a-f0-9]{48}$/);
  assert.match(v.get('VAPID_PUBLIC_KEY'), /^[A-Za-z0-9_-]{86,88}$/);
  assert.match(v.get('VAPID_PRIVATE_KEY'), /^[A-Za-z0-9_-]{42,44}$/);
  assert.equal(v.get('VAPID_SUBJECT'), 'mailto:destek@yemekgelsin.net');
  // Metin geri okunabilir ve aynı değerleri verir
  const parsed = parseDotenv(r.text);
  for (const [k, val] of v) assert.equal(parsed.get(k) ?? '', val, k);
  // Gizli değerler maskelenecekler listesinde
  for (const k of GENERATED_KEYS) assert.ok(r.sensitive.includes(v.get(k)), k);
  assert.ok(r.sensitive.includes(BASE.CLOUDFLARE_API_TOKEN));
});

test('üretilen gizli değerler sonsuza dek korunur; ikinci birleştirmede hiçbiri yeniden üretilmez', () => {
  const r1 = first();
  const r2 = again(r1.text);
  assert.equal(r2.ok, true, r2.errors.join('\n'));
  assert.deepEqual(r2.generated, []);
  assert.deepEqual([...r2.kept].sort(), [...GENERATED_KEYS].sort());
  for (const k of GENERATED_KEYS) assert.equal(r2.values.get(k), r1.values.get(k), k);
  assert.equal(r2.text, r1.text);
});

test('sağlayıcı değerleri her dağıtımda GitHub secret\'larından yazılır: gerçek WhatsApp ve Netgsm, sonra kaldırılınca mock', () => {
  const r1 = first({ ...BASE, ...META, ...NETGSM });
  assert.equal(r1.ok, true, r1.errors.join('\n'));
  const v = r1.values;
  assert.equal(r1.whatsapp, 'cloud');
  assert.equal(v.get('PLATFORM_WA_PROVIDER'), 'cloud');
  assert.equal(v.get('PLATFORM_WA_API_KEY'), META.META_WA_TOKEN);
  assert.equal(v.get('PLATFORM_WA_PHONE_NUMBER_ID'), META.META_WA_PHONE_NUMBER_ID);
  assert.equal(v.get('PLATFORM_WA_WABA_ID'), META.META_WA_WABA_ID);
  assert.equal(v.get('WA_APP_SECRET'), META.META_APP_SECRET);
  assert.equal(v.get('PLATFORM_WA_DISPLAY_PHONE'), '+905321234567');
  assert.equal(r1.sms, 'netgsm');
  assert.equal(v.get('SMS_PROVIDER'), 'netgsm');
  assert.equal(v.get('NETGSM_PASSWORD'), NETGSM.NETGSM_PASSWORD);
  // Özel karakterli parola tek tırnakla yazılır ve aynen geri okunur
  assert.match(r1.text, /^NETGSM_PASSWORD='p@ss#word\$1'$/m);
  assert.equal(parseDotenv(r1.text).get('NETGSM_PASSWORD'), NETGSM.NETGSM_PASSWORD);

  // Token yenilendi: yeni değer yazılır, gizli anahtarlar aynı kalır
  const r2 = again(r1.text, { ...BASE, ...META, META_WA_TOKEN: 'EAAGyeniToken987654321', ...NETGSM });
  assert.equal(r2.values.get('PLATFORM_WA_API_KEY'), 'EAAGyeniToken987654321');
  assert.equal(r2.values.get('PLATFORM_WA_WEBHOOK_TOKEN'), v.get('PLATFORM_WA_WEBHOOK_TOKEN'));

  // Secret'lar kaldırıldı: mock, eski değerler silinir
  const r3 = again(r1.text);
  assert.equal(r3.ok, true);
  assert.equal(r3.whatsapp, 'mock');
  assert.equal(r3.values.get('PLATFORM_WA_API_KEY'), '');
  assert.equal(r3.values.get('WA_APP_SECRET'), '');
  assert.equal(r3.values.get('PLATFORM_WA_DISPLAY_PHONE'), '');
  assert.equal(r3.values.get('SMS_PROVIDER'), 'mock');
  assert.equal(r3.values.get('NETGSM_PASSWORD'), '');
  assert.ok(!r3.text.includes(META.META_WA_TOKEN));
  // Webhook belirteci ve doğrulama belirteci korunur (Meta'daki adres değişmesin)
  assert.equal(r3.values.get('PLATFORM_WA_WEBHOOK_TOKEN'), v.get('PLATFORM_WA_WEBHOOK_TOKEN'));
  assert.equal(r3.values.get('WA_VERIFY_TOKEN'), v.get('WA_VERIFY_TOKEN'));
});

test('360dialog (varsayılan yol): D360_API_KEY + WA_PHONE → d360; iki yol birlikte hata; telefon eksikse mock', () => {
  const r = first({ ...BASE, D360_API_KEY: 'd360-anahtar-XYZ', WA_PHONE: '0532 123 45 67' });
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.whatsapp, 'd360');
  assert.equal(r.values.get('PLATFORM_WA_PROVIDER'), 'd360');
  assert.equal(r.values.get('PLATFORM_WA_API_KEY'), 'd360-anahtar-XYZ');
  assert.equal(r.values.get('PLATFORM_WA_DISPLAY_PHONE'), '+905321234567');
  assert.equal(r.values.get('WA_APP_SECRET'), '');
  assert.equal(r.values.get('PLATFORM_WA_PHONE_NUMBER_ID'), '');
  assert.ok(r.sensitive.includes('d360-anahtar-XYZ'));

  const both = first({ ...BASE, ...META, D360_API_KEY: 'd360-anahtar-XYZ' });
  assert.equal(both.ok, false);
  assert.match(both.errors.join('\n'), /belirsiz/);

  const noPhone = first({ ...BASE, D360_API_KEY: 'd360-anahtar-XYZ' });
  assert.equal(noPhone.ok, true);
  assert.equal(noPhone.whatsapp, 'mock');
  assert.match(noPhone.warnings.join('\n'), /360dialog için WA_PHONE/);

  const spaced = first({ ...BASE, D360_API_KEY: 'd360 anahtar', WA_PHONE: '+905321234567' });
  assert.match(spaced.errors.join('\n'), /D360_API_KEY boşluk içeremez/);
});

test('eksik ya da hatalı secret: anlaşılır Türkçe hata, dosya yazılmaz', () => {
  const noToken = mergeEnv({ current: new Map(), secrets: {} });
  assert.equal(noToken.ok, false);
  assert.equal(noToken.text, null);
  assert.match(noToken.errors.join('\n'), /CLOUDFLARE_API_TOKEN GitHub secret'ı yok.*Zone > DNS > Edit/);

  const badPhone = first({ ...BASE, ...META, WA_PHONE: '12' });
  assert.equal(badPhone.ok, false);
  assert.match(badPhone.errors.join('\n'), /WA_PHONE telefon numarası olmalı/);

  const badId = first({ ...BASE, ...META, META_WA_PHONE_NUMBER_ID: '+90 532 123 45 67' });
  assert.match(badId.errors.join('\n'), /META_WA_PHONE_NUMBER_ID yalnız rakamlardan/);

  const badSupport = first({ ...BASE, SUPPORT_WHATSAPP: '12345' });
  assert.match(badSupport.errors.join('\n'), /SUPPORT_WHATSAPP/);

  const badPing = first({ ...BASE, BACKUP_PING_URL: 'http://izleme.example/ping' });
  assert.match(badPing.errors.join('\n'), /BACKUP_PING_URL https/);
});

test('bozuk mevcut gizli değer kendiliğinden değiştirilmez: hata ve ne yapılacağı', () => {
  const r1 = first();
  const cur = parseDotenv(r1.text);
  cur.set('ENCRYPTION_KEY', 'kisa');
  cur.set('SESSION_SECRET', 'dev-only-change-me-32chars-minimum');
  const r2 = mergeEnv({ current: cur, secrets: BASE });
  assert.equal(r2.ok, false);
  const msg = r2.errors.join('\n');
  assert.match(msg, /ENCRYPTION_KEY geçersiz: 32 bayt base64.*Kendiliğinden değiştirilmedi.*çözülemez/);
  assert.match(msg, /SESSION_SECRET geçersiz/);
  assert.equal(r2.values.get('ENCRYPTION_KEY'), 'kisa');
});

test('kısmi secret\'lar uyarıdır (mock sürer); WABA yoksa uyarı; Caddy için ayrı token önceliklidir', () => {
  const partial = first({ ...BASE, META_WA_TOKEN: 'x', NETGSM_USERCODE: 'u' });
  assert.equal(partial.ok, true);
  assert.equal(partial.whatsapp, 'mock');
  assert.equal(partial.sms, 'mock');
  assert.match(partial.warnings.join('\n'), /Gerçek WhatsApp için eksik GitHub secret: META_WA_PHONE_NUMBER_ID, META_APP_SECRET, WA_PHONE/);
  assert.match(partial.warnings.join('\n'), /Netgsm için eksik GitHub secret: NETGSM_PASSWORD, NETGSM_HEADER/);

  const noWaba = first({ ...BASE, ...META, META_WA_WABA_ID: '' });
  assert.equal(noWaba.ok, true);
  assert.equal(noWaba.values.get('PLATFORM_WA_WABA_ID'), '');
  assert.match(noWaba.warnings.join('\n'), /META_WA_WABA_ID yok/);

  // Ayrı token yoksa Workers yetkili token sunucuya (Caddy) yazılır: yüksek sesli uyarı ve ne yapılacağı
  const shared = first(BASE);
  assert.equal(shared.ok, true);
  assert.match(shared.warnings.join('\n'), /CADDY_CLOUDFLARE_API_TOKEN yok: .*Workers yetkisi.*Zone > DNS > Edit \+ Zone > Zone > Read/);

  const caddy = first({ ...BASE, CADDY_CLOUDFLARE_API_TOKEN: 'yalniz-dns-token-123456789' });
  assert.equal(caddy.values.get('CLOUDFLARE_API_TOKEN'), 'yalniz-dns-token-123456789');
  assert.doesNotMatch(caddy.warnings.join('\n'), /CADDY_CLOUDFLARE_API_TOKEN yok/);
});

test('elle eklenen anahtarlar ve LOG_LEVEL/RETENTION_DAYS korunur; VAPID çiftinin biri eksikse ikisi de yenilenir', () => {
  const r1 = first();
  const cur = parseDotenv(`${r1.text}\nOZEL_AYAR="deger # ile"\nLOG_LEVEL=debug\nRETENTION_DAYS=30\n`);
  cur.delete('VAPID_PRIVATE_KEY');
  const r2 = mergeEnv({ current: cur, secrets: BASE });
  assert.equal(r2.ok, true, r2.errors.join('\n'));
  assert.equal(r2.values.get('LOG_LEVEL'), 'debug');
  assert.equal(r2.values.get('RETENTION_DAYS'), '30');
  assert.match(r2.text, /# --- Elle eklenenler \(iş akışı dokunmaz\) ---\nOZEL_AYAR='deger # ile'/);
  assert.equal(parseDotenv(r2.text).get('OZEL_AYAR'), 'deger # ile');
  assert.notEqual(r2.values.get('VAPID_PUBLIC_KEY'), r1.values.get('VAPID_PUBLIC_KEY'));
  assert.deepEqual(r2.generated, ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']);
  assert.match(r2.warnings.join('\n'), /VAPID anahtar çiftinin biri eksikti/);
});

test('parseDotenv ve formatValue', () => {
  const m = parseDotenv(["# yorum", 'export A=1', "B='tek # tırnak'", 'C="çift \\"x\\" y"', 'D=açık # yorum', 'bozuk satır', 'E='].join('\n'));
  assert.deepEqual(Object.fromEntries(m), { A: '1', B: 'tek # tırnak', C: 'çift "x" y', D: 'açık', E: '' });
  assert.equal(formatValue('K', 'abc+/=:@.-_,%'), 'abc+/=:@.-_,%');
  assert.equal(formatValue('K', 'a b$c'), "'a b$c'");
  assert.throws(() => formatValue('K', "a'b"), /tek tırnak/);
  assert.throws(() => formatValue('K', 'a\nb'), /satır sonu/);
  assert.equal(normalizeE164('+90 (532) 123-45-67'), '+905321234567');
  assert.equal(normalizeE164('5321234567'), '+905321234567');
  assert.equal(normalizeE164('abc'), null);
});

test('komut satırı: GitHub\'da değerler maskelenir ve loga basılmaz; dosya 600; hatada dosya yazılmaz', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-merge-'));
  const cur = join(dir, 'current.env');
  const out = join(dir, 'new.env');
  writeFileSync(cur, '');
  const env = { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', ...BASE, ...META };
  const ok = spawnSync(process.execPath, [SCRIPT, '--current', cur, '--out', out], { env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  const text = readFileSync(out, 'utf8');
  assert.equal(statSync(out).mode & 0o777, 0o600);
  const values = parseDotenv(text);
  const masked = new Set([...ok.stdout.matchAll(/^::add-mask::(.+)$/gm)].map((m) => m[1]));
  for (const k of ['POSTGRES_PASSWORD', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'PLATFORM_WA_API_KEY', 'WA_APP_SECRET', 'CLOUDFLARE_API_TOKEN']) {
    assert.ok(masked.has(values.get(k)), `${k} maskelenmedi`);
  }
  // add-mask satırları dışında hiçbir çıktı satırı gizli değer içermez
  const visible = ok.stdout.split('\n').filter((l) => !l.startsWith('::add-mask::')).join('\n') + ok.stderr;
  for (const value of masked) assert.ok(!visible.includes(value), 'gizli değer loga düştü');
  assert.match(ok.stdout, /WhatsApp \(ortak numara\): gerçek Meta Cloud API/);

  const out2 = join(dir, 'hatali.env');
  const bad = spawnSync(process.execPath, [SCRIPT, '--current', cur, '--out', out2], { env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'true' }, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^::error::CLOUDFLARE_API_TOKEN GitHub secret'ı yok/m);
  assert.equal(existsSync(out2), false);
});
