// Siparişin Önünde — Cloudflare dev/demo ortamı (15 §13).
//
// Tek Worker, tek container örneği ("main"): container içinde PostgreSQL + API (:4000) + worker + web (:3000) çalışır
// (deploy/cloudflare/entrypoint.sh). Worker:
//   - Tüm siteyi dev parolasıyla (HTTP Basic, DEV_PASSWORD) korur; WhatsApp webhook'ları ve PWA dosyaları hariç.
//   - /api/* isteklerini API'ye (4000), diğerlerini web'e (3000) yönlendirir (üretimdeki Caddy düzeni).
//   - Container'ın "yedek.internal" adresine yaptığı istekleri R2'ye yazar/okur (veritabanı ve görsel yedeği).
// Gerçek işletme verisi bu ortama girmez: tüm sağlayıcılar mock, kişisel veri Türkiye dışında tutulamaz (00 §12a).

import { Container, ContainerProxy, getContainer, switchPort } from '@cloudflare/containers';

export { ContainerProxy };

interface Env {
  APP: DurableObjectNamespace<AppContainer>;
  BACKUPS: R2Bucket;
  /** Workers.dev adresi (https://…); iş akışı --var ile verir */
  APP_BASE_URL: string;
  DEV_PASSWORD: string;
  SESSION_SECRET: string;
  TRACKING_SECRET: string;
  ENCRYPTION_KEY: string;
  WA_VERIFY_TOKEN: string;
  /** Ortak numara webhook yolundaki gizli belirteç (/api/v1/webhooks/wa/shared/<belirteç>); scripts/secrets.mjs üretir */
  PLATFORM_WA_WEBHOOK_TOKEN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
}

const API_PORT = 4000;
const WEB_PORT = 3000;
const INSTANCE = 'main';

/**
 * Parolasız erişilen yollar: WhatsApp sağlayıcı webhook'ları (işletmeye özel /api/v1/webhooks/wa/<belirteç> ve ortak
 * numara /api/v1/webhooks/wa/shared/<belirteç>; ikisi de gizli belirteçle korunur) ve tarayıcının kimlik bilgisi
 * göndermediği PWA dosyaları.
 */
const PUBLIC_PREFIXES = ['/api/v1/webhooks/', '/_next/static/'];
const PUBLIC_PATHS = new Set(['/panel-sw.js', '/panel/manifest.webmanifest', '/icon.svg', '/favicon.ico', '/robots.txt']);

// --- Yedek (R2) ---------------------------------------------------------------------------------------

/** Container → http://yedek.internal/{db|uploads}: GET son yedek, PUT yeni yedek (+ haftanın günü kopyası, 7 gün). */
async function handleBackup(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const kind = pathname.replace(/^\/+/, '');
  if (kind !== 'db' && kind !== 'uploads') return new Response('bilinmeyen yedek', { status: 404 });
  const ext = kind === 'db' ? 'dump' : 'tar.gz';
  const latestKey = `${kind}/son.${ext}`;

  if (request.method === 'GET') {
    const obj = await env.BACKUPS.get(latestKey);
    if (!obj) return new Response('yedek yok', { status: 404 });
    return new Response(obj.body, { headers: { 'content-type': 'application/octet-stream' } });
  }
  if (request.method === 'PUT') {
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return new Response('boş yedek', { status: 400 });
    const day = new Date().getUTCDay();
    await env.BACKUPS.put(latestKey, body);
    await env.BACKUPS.put(`${kind}/gun-${day}.${ext}`, body);
    return new Response(null, { status: 204 });
  }
  return new Response('yöntem desteklenmiyor', { status: 405 });
}

// --- Container ----------------------------------------------------------------------------------------

export class AppContainer extends Container<Env> {
  defaultPort = WEB_PORT;
  requiredPorts = [WEB_PORT, API_PORT];
  // Son istekten 30 dk sonra uyur (SIGTERM → son yedek). Açık panel (SSE) bağlantısı uyumayı engeller.
  sleepAfter = '30m';
  enableInternet = true;

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = {
      NODE_ENV: 'production',
      DEPLOY_ENV: 'dev',
      DEV_TOOLS: '1',
      TZ: 'UTC',
      APP_BASE_URL: env.APP_BASE_URL,
      SESSION_SECRET: env.SESSION_SECRET,
      TRACKING_SECRET: env.TRACKING_SECRET,
      ENCRYPTION_KEY: env.ENCRYPTION_KEY,
      WA_VERIFY_TOKEN: env.WA_VERIFY_TOKEN,
      // Dev ortamında hiçbir gerçek mesaj gönderilmez (DEPLOY_ENV=dev yalnız bu koşulda DEV_TOOLS'a izin verir)
      WA_DEFAULT_PROVIDER: 'mock',
      PLATFORM_WA_PROVIDER: 'mock',
      // Ortak numara (00 §12a madde 8): tüm dükkanların tek numarası (mock; simülatörde "Siparişin Önünde · ortak
      // numara"). Webhook belirteci tanımsızsa ortak webhook 404 döner; dev'de de gerçek yol denenebilsin diye verilir.
      PLATFORM_WA_DISPLAY_PHONE: '+905550000000',
      PLATFORM_WA_WEBHOOK_TOKEN: env.PLATFORM_WA_WEBHOOK_TOKEN,
      SMS_PROVIDER: 'mock',
      // Site dev parolasıyla korunuyor; yönetici girişinde 2FA dev ortamında isteğe bağlı
      ADMIN_TOTP_REQUIRED: 'false',
      VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
      VAPID_SUBJECT: env.APP_BASE_URL,
      UPLOAD_DIR: '/data/uploads',
      LOG_LEVEL: 'info',
    };
  }

  /** Container çalışıp iki port da dinliyor mu; değilse başlatır (ilk açılış: geri yükleme + migration ~1 dk). */
  async ensureReady(): Promise<boolean> {
    const state = await this.getState();
    if (state.status === 'healthy') return true;
    try {
      await this.startAndWaitForPorts({ ports: [WEB_PORT, API_PORT], cancellationOptions: { portReadyTimeoutMS: 150_000 } });
      return true;
    } catch (err) {
      console.error('container başlatılamadı', err);
      return false;
    }
  }

  override onStart(): void {
    console.log('container başladı');
  }

  override onStop(): void {
    console.log('container durdu');
  }

  override onError(error: unknown): void {
    console.error('container hatası', error);
  }
}

AppContainer.outboundByHost = {
  'yedek.internal': (request: Request, env: Env) => handleBackup(request, env),
};

// --- Worker -------------------------------------------------------------------------------------------

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** HTTP Basic: kullanıcı adı serbest, parola DEV_PASSWORD. */
function authorized(request: Request, env: Env): boolean {
  if (!env.DEV_PASSWORD) return false;
  const header = request.headers.get('authorization') ?? '';
  const [scheme, encoded] = header.split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !encoded) return false;
  let decoded = '';
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const password = decoded.slice(decoded.indexOf(':') + 1);
  return timingSafeEqual(password, env.DEV_PASSWORD);
}

const unauthorized = () =>
  new Response('Siparişin Önünde dev ortamı: parola gerekli.', {
    status: 401,
    headers: {
      'www-authenticate': 'Basic realm="Siparisin Onunde dev", charset="UTF-8"',
      'content-type': 'text/plain; charset=utf-8',
      'x-robots-tag': 'noindex, nofollow',
    },
  });

const STARTING_PAGE = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5"><title>Başlatılıyor · Siparişin Önünde</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#faf7f2;color:#1f2937;text-align:center}</style></head>
<body><main><h1 style="font-size:1.25rem">Sistem başlatılıyor</h1><p>Dev ortamı bir süre kullanılmadığı için uykudaydı. Sayfa birkaç saniye içinde kendiliğinden yenilenecek.</p></main></body></html>`;

function withDevHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.set('x-robots-tag', 'noindex, nofollow');
  return out;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (!isPublic(url.pathname) && !authorized(request, env)) return unauthorized();

    const app = getContainer(env.APP, INSTANCE);
    const isNavigation = request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html');
    const state = await app.getState();
    if (state.status !== 'healthy') {
      if (isNavigation) {
        // Uyuyan container'ı arka planda uyandır; kullanıcı bekleme sayfası görür
        ctx.waitUntil(app.ensureReady());
        return new Response(STARTING_PAGE, {
          status: 503,
          headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '5', 'x-robots-tag': 'noindex, nofollow' },
        });
      }
      if (!(await app.ensureReady())) return new Response('Sistem başlatılamadı, biraz sonra tekrar deneyin.', { status: 503 });
    }

    // Uygulama gerçek istemci IP'sini X-Forwarded-For'dan okur (Fastify trustProxy); Basic parola içeriye iletilmez
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) headers.set('x-forwarded-for', ip);
    headers.set('x-forwarded-proto', 'https');
    headers.set('x-forwarded-host', url.host);
    const forwarded = new Request(request, { headers });

    const port = url.pathname.startsWith('/api/') ? API_PORT : WEB_PORT;
    return withDevHeaders(await app.fetch(switchPort(forwarded, port)));
  },
} satisfies ExportedHandler<Env>;
