// src/security-headers.ts: her yanıta yazılan güvenlik başlıkları (denetim 2026-10-04 madde 3.8; 15 §13).
// Çalıştır: npm test (node --test; Node .ts dosyasındaki türleri ayıklar).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CSP_VALUE, HSTS_VALUE, MAP_TILES_ORIGIN, applySecurityHeaders, securityHeaders } from '../src/security-headers.ts';
import { stripJsonc } from './jsonc.mjs';

const CANLI = { https: true, cspReportOnly: false };

test('canlı yanıtta HSTS, CSP, nosniff, çerçeve, yönlendiren ve izin başlıkları var', () => {
  const h = securityHeaders(CANLI);
  assert.equal(h['strict-transport-security'], HSTS_VALUE);
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['x-frame-options'], 'DENY');
  assert.equal(h['referrer-policy'], 'strict-origin-when-cross-origin');
  // Kurye ekranı konum izni ister: geolocation kapatılmamalı
  assert.match(h['permissions-policy'], /geolocation=\(self\)/);
  assert.match(h['permissions-policy'], /camera=\(\), microphone=\(\)/);
  assert.equal(h['content-security-policy'], CSP_VALUE);
  assert.equal('content-security-policy-report-only' in h, false);
});

test('HSTS yalnız https isteğinde gönderilir (düz http\'de tarayıcı yok sayar)', () => {
  const h = securityHeaders({ https: false, cspReportOnly: false });
  assert.equal('strict-transport-security' in h, false);
  // Diğer başlıklar yine yazılır
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['content-security-policy'], CSP_VALUE);
  // Yayına alırken `preload` taahhüdü verilmiyor (geri dönüşü zor)
  assert.equal(HSTS_VALUE.includes('preload'), false);
  assert.match(HSTS_VALUE, /max-age=31536000; includeSubDomains/);
});

test('CSP_REPORT_ONLY: kural uygulanmaz, yalnız rapor başlığı gönderilir', () => {
  const h = securityHeaders({ https: true, cspReportOnly: true });
  assert.equal(h['content-security-policy-report-only'], CSP_VALUE);
  assert.equal('content-security-policy' in h, false);
});

test('CSP uygulamayı kırmayan ama gevşek olmayan kuralları içeriyor', () => {
  // Next.js satır içi script gönderiyor (tema başlatma, JSON-LD): 'unsafe-inline' zorunlu, 'unsafe-eval' DEĞİL
  assert.match(CSP_VALUE, /script-src 'self' 'unsafe-inline'/);
  assert.equal(CSP_VALUE.includes("'unsafe-eval'"), false);
  // Harita altlığı (MapLibre) stil/glif/döşemeleri XHR ile çeker ve blob worker açar
  assert.ok(CSP_VALUE.includes(`connect-src 'self' ${MAP_TILES_ORIGIN}`));
  assert.match(CSP_VALUE, /worker-src 'self' blob:/);
  // Ürün görselinin adresi işletmenin girdiği serbest metin olabilir; http: yine engelli
  assert.match(CSP_VALUE, /img-src 'self' data: blob: https:/);
  assert.equal(CSP_VALUE.includes('img-src *'), false);
  for (const kural of [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "manifest-src 'self'",
  ]) {
    assert.ok(CSP_VALUE.includes(kural), kural);
  }
});

test('başlıklar yanıtta Next.js\'in yazdıklarının üzerine yazılır (çift başlık olmaz)', () => {
  const headers = new Headers({ 'x-frame-options': 'SAMEORIGIN', 'x-content-type-options': 'nosniff' });
  applySecurityHeaders(headers, CANLI);
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.deepEqual(headers.getSetCookie?.() ?? [], []);
  assert.equal(headers.get('content-security-policy'), CSP_VALUE);
  // Aynı başlık iki kez değil, bir kez
  assert.equal((headers.get('x-content-type-options') ?? '').includes(','), false);
});

test('wrangler.jsonc: CSP rapor kipi anahtarı tanımlı ve varsayılan olarak kural uygulanıyor', () => {
  const config = JSON.parse(stripJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')));
  assert.equal(config.vars.CSP_REPORT_ONLY, '0');
});
