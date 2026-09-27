// src/access.ts kuralları (15 §13). Çalıştır: npm test (node --test; Node 22 .ts dosyasındaki türleri ayıklar).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { isNavigation, isProtectedPath, normalizeEpoch, normalizePathForAuth, parseBackupPath, redirectFor } from '../src/access.ts';
import { stripJsonc } from './jsonc.mjs';

const SITE = 'https://yemekgelsin.net';
const HTML = 'text/html,application/xhtml+xml';

test('yalnız geliştirici araçları parolalı', () => {
  for (const p of ['/dev', '/dev/', '/dev/whatsapp', '/api/v1/dev', '/api/v1/dev/wa/accounts', '/DEV/whatsapp', '/api/v1/Dev/x']) {
    assert.equal(isProtectedPath(p), true, p);
  }
  for (const p of ['/', '/s/bozok-pide', '/t/abc', '/panel/giris', '/admin/giris', '/api/v1/health', '/api/v1/webhooks/wa/x', '/devices', '/api/v1/devtools', '/yasal/gizlilik']) {
    assert.equal(isProtectedPath(p), false, p);
  }
});

test('kodlanmış ya da çift eğik çizgili yollar korumayı aşamaz', () => {
  for (const p of ['/api/v1/%64ev/x', '/api/v1/%2564ev/x', '//api/v1/dev/x', '/api//v1/dev', '/%64ev/whatsapp', '/dev;x', '/api/v1/dev%2Fx', '/api/v1/dev%']) {
    assert.equal(isProtectedPath(p), true, p);
  }
  assert.equal(normalizePathForAuth('/A%20b//c'), '/a b/c');
});

test('www → kök alan adı 301 (yol ve sorgu korunur), gövdeli istek 308', () => {
  assert.deepEqual(redirectFor(new URL('https://www.yemekgelsin.net/fiyatlar?x=1'), 'GET', '*/*', SITE), {
    status: 301,
    location: 'https://yemekgelsin.net/fiyatlar?x=1',
  });
  assert.deepEqual(redirectFor(new URL('https://www.yemekgelsin.net/api/v1/x'), 'POST', null, SITE), {
    status: 308,
    location: 'https://yemekgelsin.net/api/v1/x',
  });
  assert.equal(redirectFor(new URL('https://yemekgelsin.net/'), 'GET', HTML, SITE), null);
});

test('workers.dev: sayfa gezintisi özel alan adına 302, API ve webhook çalışmaya devam eder', () => {
  const dev = 'https://siparisinonunde-dev.ornek.workers.dev';
  assert.deepEqual(redirectFor(new URL(`${dev}/panel/giris?a=b`), 'GET', HTML, SITE), {
    status: 302,
    location: 'https://yemekgelsin.net/panel/giris?a=b',
  });
  assert.equal(redirectFor(new URL(`${dev}/api/v1/health`), 'GET', HTML, SITE), null);
  assert.equal(redirectFor(new URL(`${dev}/api/v1/health`), 'GET', '*/*', SITE), null);
  assert.equal(redirectFor(new URL(`${dev}/api/v1/webhooks/wa/shared/x`), 'POST', 'application/json', SITE), null);
  assert.equal(redirectFor(new URL(`${dev}/_next/static/a.js`), 'GET', '*/*', SITE), null);
  // Site adresi workers.dev ise (yedek yapılandırma) yönlendirme yok
  assert.equal(redirectFor(new URL(`${dev}/`), 'GET', HTML, dev), null);
});

test('gezinme tanımı', () => {
  assert.equal(isNavigation('GET', HTML), true);
  assert.equal(isNavigation('HEAD', HTML), true);
  assert.equal(isNavigation('POST', HTML), false);
  assert.equal(isNavigation('GET', '*/*'), false);
  assert.equal(isNavigation('GET', null), false);
});

test('veri dönemi (DATA_EPOCH) değeri', () => {
  assert.equal(normalizeEpoch('2'), '2');
  assert.equal(normalizeEpoch(' 3 '), '3');
  assert.equal(normalizeEpoch(''), '');
  assert.equal(normalizeEpoch(undefined), '');
  assert.throws(() => normalizeEpoch('../x'), /DATA_EPOCH/);
  assert.throws(() => normalizeEpoch('1234567'), /DATA_EPOCH/);
});

test('yedek yolu: dönem container\'ın yolundan okunur, dönemsiz yol eski öneksiz anahtarlara gider', () => {
  assert.deepEqual(parseBackupPath('/e2/db'), { prefix: 'e2/', kind: 'db' });
  assert.deepEqual(parseBackupPath('/e3/uploads'), { prefix: 'e3/', kind: 'uploads' });
  // İlk sürümün entrypoint'i (dönemsiz): yeniden dağıtımda kapanan eski container'ın son yedeği yeni döneme düşmez
  assert.deepEqual(parseBackupPath('/db'), { prefix: '', kind: 'db' });
  assert.deepEqual(parseBackupPath('/uploads'), { prefix: '', kind: 'uploads' });
  for (const p of ['/', '/x', '/e2', '/e2/x', '/ex/db', '/e1234567/db', '/../db', '/e2/../db', '/db/son.dump', '/E2/db']) {
    assert.equal(parseBackupPath(p), null, p);
  }
});

test('wrangler.jsonc: DATA_EPOCH geçerli, özel alan adları ve workers.dev yedeği tanımlı', () => {
  const config = JSON.parse(stripJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')));
  assert.match(String(config.vars.DATA_EPOCH), /^[0-9]{1,6}$/);
  assert.equal(config.workers_dev, true);
  const host = new URL(config.vars.APP_BASE_URL).hostname;
  const patterns = config.routes.filter((r) => r.custom_domain).map((r) => r.pattern);
  assert.ok(patterns.includes(host), `routes ${host} içermeli`);
});
