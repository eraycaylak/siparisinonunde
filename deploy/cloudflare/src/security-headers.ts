// Worker'ın her yanıta eklediği güvenlik başlıkları (denetim 2026-10-04 madde 3.8; 15 §13).
// Saf fonksiyon: scripts/security-headers.test.mjs ile denenir (node --test; Node'un tür ayıklamasıyla çalışır, bu
// yüzden yalnız silinebilir TypeScript sözdizimi kullanılır).
//
// Neden Worker'da: canlı yolda tek giriş kapısı Worker'dır. Next.js kendi başlıklarını yalnız web (3000) yanıtlarına
// yazar; /api/* istekleri (JSON uçları VE yüklenen görseller /api/v1/uploads/*) doğrudan Fastify'a (4000) gider ve
// oradan başlıksız dönüyordu. Burada yazılınca "/api/* dahil" her yanıt kapsanır; Next'in yazdıklarının üzerine
// aynı değerler yazılır (set, append değil), yani çift başlık olmaz.
//
// HSTS: Caddy yolundakiyle aynı değer (Caddyfile) — `preload` BİLEREK yok: preload listesine girmek alt alan adları
// dahil geri dönüşü çok zor bir taahhüttür, önce alan adı yapısı oturmalı.
//
// CSP ve satır içi script: Next.js tema başlatma script'ini, JSON-LD'yi ve kendi önyükleme script'lerini SATIR İÇİ
// gönderiyor (apps/web/app/layout.tsx, components/common/json-ld.tsx). Worker, Next'in ürettiği nonce'ı bilemez;
// nonce'a geçmek Next tarafında bir middleware ister (bkz. docs/15 §13 "Güvenlik başlıkları" notu). Bu yüzden
// script-src'de 'unsafe-inline' var, 'unsafe-eval' YOK (üretim derlemesi eval kullanmıyor). İlk yayında kırılan bir
// şey olup olmadığını görmek için CSP_REPORT_ONLY=1 ile yalnız rapor kipinde başlanabilir: tarayıcı kuralı uygulamaz,
// yalnız konsola yazar.

/** Harita altlığı (apps/web/components/settings/map/use-maplibre.ts MAP_STYLE_URL): stil, glif ve döşemeler XHR ile gelir. */
export const MAP_TILES_ORIGIN = 'https://tiles.openfreemap.org';

/** Caddy yolundakiyle aynı (Caddyfile); `preload` bilerek yok. */
export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';

/**
 * İçerik güvenliği kuralları. Gerekçeler:
 * - `img-src … https:`: ürün görselinin adresi işletmenin girdiği serbest metin olabilir (`products.image_url`),
 *   kendi yüklediği görsel aynı kökenden (/api/v1/uploads/*) gelir; `http:` yine engellenir.
 * - `worker-src 'self' blob:`: panel bildirim service worker'ı (/panel-sw.js) ve MapLibre'nin blob worker'ı.
 * - `connect-src`: aynı köken (API, SSE sipariş akışı) + harita altlığı.
 * - `frame-ancestors 'none'` + `frame-src 'none'`: uygulamada hiç iframe yok, vitrin de gömülmüyor.
 */
export const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${MAP_TILES_ORIGIN}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self'",
  'upgrade-insecure-requests',
];

export const CSP_VALUE = CSP_DIRECTIVES.join('; ');

export interface SecurityHeaderOptions {
  /** İstek https üzerinden mi geldi (HSTS yalnız o zaman anlamlıdır) */
  https: boolean;
  /** CSP yalnız rapor kipinde mi gönderilsin (wrangler vars.CSP_REPORT_ONLY="1"): tarayıcı uygulamaz, konsola yazar */
  cspReportOnly: boolean;
}

/**
 * Yanıta yazılacak başlıklar. `Permissions-Policy` ve `Referrer-Policy` Next.js'in seçtiği değerlerle aynıdır
 * (apps/web/next.config.ts): kurye ekranı konum izni istediği için `geolocation=(self)` açık kalır.
 */
export function securityHeaders(opts: SecurityHeaderOptions): Record<string, string> {
  const out: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()',
  };
  out[opts.cspReportOnly ? 'content-security-policy-report-only' : 'content-security-policy'] = CSP_VALUE;
  // Düz http isteğinde HSTS tarayıcı tarafından yok sayılır; yalnız https'te gönderilir
  if (opts.https) out['strict-transport-security'] = HSTS_VALUE;
  return out;
}

/** Başlıkları yanıta yazar (Next.js'in yazdığı aynı adlı başlıkların üzerine; çift başlık olmaz). */
export function applySecurityHeaders(headers: Headers, opts: SecurityHeaderOptions): void {
  for (const [name, value] of Object.entries(securityHeaders(opts))) headers.set(name, value);
}
