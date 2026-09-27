// Yemek Gelsin — Cloudflare dev/demo ortamı (15 §13).
//
// Tek Worker, tek container örneği ("main"): container içinde PostgreSQL + API (:4000) + worker + web (:3000) çalışır
// (deploy/cloudflare/entrypoint.sh). Adres: https://yemekgelsin.net (Custom Domain; 00 §12a madde 9), workers.dev yedek.
// Worker (kurallar src/access.ts):
//   - Site herkese açıktır. HTTP Basic (DEV_PASSWORD) yalnız geliştirici araçlarını korur: /dev/* ve /api/v1/dev/*.
//   - www.yemekgelsin.net → yemekgelsin.net (301); workers.dev'deki sayfa gezinmeleri özel alan adına (302).
//     API ve webhook istekleri workers.dev'de de çalışır.
//   - /api/* isteklerini API'ye (4000), diğerlerini web'e (3000) yönlendirir (üretimdeki Caddy düzeni).
//   - Container'ın "yedek.internal" adresine yaptığı istekleri R2'ye yazar/okur (veritabanı ve görsel yedeği);
//     anahtarlar veri dönemi önekiyle (ör. e2/db/son.dump). Container dönemini açılışta alır ve yola yazar (/e2/db);
//     DATA_EPOCH artırılınca yeni container yedek bulamaz, demo sıfırdan kurulur.
// Gerçek işletme verisi bu ortama girmez: tüm sağlayıcılar mock, kişisel veri Türkiye dışında tutulamaz (00 §12a).

import { Container, ContainerProxy, getContainer, switchPort } from '@cloudflare/containers';
import { isNavigation, isProtectedPath, normalizeEpoch, parseBackupPath, redirectFor } from './access';

export { ContainerProxy };

interface Env {
  APP: DurableObjectNamespace<AppContainer>;
  BACKUPS: R2Bucket;
  /** Sitenin kanonik adresi (https://yemekgelsin.net); scripts/prepare-config.mjs iş akışının SITE_URL'sinden yazar */
  APP_BASE_URL: string;
  /** "dev": container'da geliştirici araçları (yalnız mock sağlayıcılarla) ve tüm yanıtlarda x-robots-tag noindex */
  DEPLOY_ENV: string;
  /** Veri dönemi: container'a açılışta verilir, R2 anahtarlarının öneki e<DATA_EPOCH>/; artırılınca demo sıfırdan kurulur (15 §13) */
  DATA_EPOCH: string;
  /** /dev/* ve /api/v1/dev/* parolası; demo hesaplarının parolası da budur (SEED_PASSWORD) */
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

// --- Yedek (R2) ---------------------------------------------------------------------------------------

/**
 * Container → http://yedek.internal/[e<dönem>/]{db|uploads}: GET son yedek, PUT yeni yedek (+ haftanın günü kopyası,
 * 7 gün). Dönem yoldan okunur (container açılışta aldığı DATA_EPOCH'u yazar; src/access.ts parseBackupPath), Worker'ın
 * o anki DATA_EPOCH'undan değil: yeniden dağıtımda kapanan eski container'ın son yedeği yeni döneme düşmez.
 */
async function handleBackup(request: Request, env: Env): Promise<Response> {
  const target = parseBackupPath(new URL(request.url).pathname);
  if (!target) return new Response('bilinmeyen yedek', { status: 404 });
  const { prefix, kind } = target;
  const ext = kind === 'db' ? 'dump' : 'tar.gz';
  const latestKey = `${prefix}${kind}/son.${ext}`;

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
    await env.BACKUPS.put(`${prefix}${kind}/gun-${day}.${ext}`, body);
    return new Response(null, { status: 204 });
  }
  return new Response('yöntem desteklenmiyor', { status: 405 });
}

/** Geçersiz DATA_EPOCH'ta Durable Object kurucusu patlamasın: değer olduğu gibi geçer, entrypoint.sh reddeder. */
function safeEpoch(raw: string | undefined): string {
  try {
    return normalizeEpoch(raw);
  } catch (err) {
    console.error(String(err));
    return String(raw);
  }
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
      DEPLOY_ENV: env.DEPLOY_ENV || 'dev',
      DEV_TOOLS: '1',
      TZ: 'UTC',
      APP_BASE_URL: env.APP_BASE_URL,
      // Veri dönemi container'ın ömrü boyunca sabittir: entrypoint.sh yedek yoluna yazar (/e2/db). Geçersizse
      // entrypoint açılmadan çıkar; iş akışı da dağıtımdan önce denetler (scripts/prepare-config.mjs).
      DATA_EPOCH: safeEpoch(env.DATA_EPOCH),
      SESSION_SECRET: env.SESSION_SECRET,
      TRACKING_SECRET: env.TRACKING_SECRET,
      ENCRYPTION_KEY: env.ENCRYPTION_KEY,
      WA_VERIFY_TOKEN: env.WA_VERIFY_TOKEN,
      // Dev ortamında hiçbir gerçek mesaj gönderilmez (DEPLOY_ENV=dev yalnız bu koşulda DEV_TOOLS'a izin verir)
      WA_DEFAULT_PROVIDER: 'mock',
      PLATFORM_WA_PROVIDER: 'mock',
      // Ortak numara (00 §12a madde 8): tüm dükkanların tek numarası (mock; simülatörde "Yemek Gelsin · ortak
      // numara"). Webhook belirteci tanımsızsa ortak webhook 404 döner; dev'de de gerçek yol denenebilsin diye verilir.
      PLATFORM_WA_DISPLAY_PHONE: '+905550000000',
      PLATFORM_WA_WEBHOOK_TOKEN: env.PLATFORM_WA_WEBHOOK_TOKEN,
      SMS_PROVIDER: 'mock',
      // Yönetici 2FA'sı dev ortamında isteğe bağlı; sahibi /admin/guvenlik'ten açabilir
      ADMIN_TOTP_REQUIRED: 'false',
      // Tüm demo hesaplarının parolası = DEV_PASSWORD (packages/db/src/seed.ts; değişirse açılışta eşitlenir)
      SEED_PASSWORD: env.DEV_PASSWORD,
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
  new Response('Yemek Gelsin geliştirici araçları: parola gerekli.', {
    status: 401,
    headers: {
      'www-authenticate': 'Basic realm="Yemek Gelsin dev", charset="UTF-8"',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });

const STARTING_PAGE = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5"><title>Başlatılıyor · Yemek Gelsin</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#faf7f2;color:#1f2937;text-align:center}</style></head>
<body><main><h1 style="font-size:1.25rem">Sistem başlatılıyor</h1><p>Site bir süre kullanılmadığı için uykudaydı. Sayfa birkaç saniye içinde kendiliğinden yenilenecek.</p></main></body></html>`;

/** DEPLOY_ENV=dev iken arama motorları dizinlemez. */
function isDev(env: Env): boolean {
  return (env.DEPLOY_ENV || 'dev') === 'dev';
}

function withEnvHeaders(res: Response, env: Env): Response {
  if (!isDev(env)) return res;
  const out = new Response(res.body, res);
  out.headers.set('x-robots-tag', 'noindex, nofollow');
  return out;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const accept = request.headers.get('accept');
    const navigation = isNavigation(request.method, accept);

    // www → kök alan adı (301); workers.dev'deki sayfa gezinmeleri → özel alan adı (302). Container gerekmez.
    const redirect = redirectFor(url, request.method, accept, env.APP_BASE_URL);
    if (redirect) {
      return withEnvHeaders(new Response(null, { status: redirect.status, headers: { location: redirect.location } }), env);
    }
    // Yalnız geliştirici araçları parolalıdır
    if (isProtectedPath(url.pathname) && !authorized(request, env)) return unauthorized();

    const app = getContainer(env.APP, INSTANCE);
    const state = await app.getState();
    if (state.status !== 'healthy') {
      if (navigation) {
        // Uyuyan container'ı arka planda uyandır; kullanıcı bekleme sayfası görür
        ctx.waitUntil(app.ensureReady());
        return withEnvHeaders(
          new Response(STARTING_PAGE, {
            status: 503,
            headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '5', 'cache-control': 'no-store' },
          }),
          env,
        );
      }
      if (!(await app.ensureReady())) {
        return withEnvHeaders(new Response('Sistem başlatılamadı, biraz sonra tekrar deneyin.', { status: 503 }), env);
      }
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
    return withEnvHeaders(await app.fetch(switchPort(forwarded, port)), env);
  },
} satisfies ExportedHandler<Env>;
