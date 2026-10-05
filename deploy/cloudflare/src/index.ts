// Yemek Gelsin — CANLI ORTAM, Cloudflare (00 §12a madde 10; 15 §13).
//
// Tek Worker, tek container örneği ("main"): container içinde PostgreSQL + API (:4000) + worker + web (:3000) çalışır
// (deploy/cloudflare/entrypoint.sh). İki kip (DEPLOY_MODE; iş akışı seçer, scripts/config-modes.mjs; ayarlar src/mode.ts):
//   - domain  (CANLI ORTAM): https://yemekgelsin.net (Custom Domain), workers.dev yedek. Gerçek veri, üretim kipi:
//             DEPLOY_ENV=production, yönetici 2FA'sı zorunlu, geliştirici araçları kapalı (/dev/* ve /api/v1/dev/* burada
//             404), kayıt ve lead formu açık, arama motorlarına açık. Seed yalnız platform yöneticisini ve bayrakları kurar
//             (SEED_MODE=admin; demo verisi yok). Kişisel veri Cloudflare'de (yurt dışı; KVKK m.9 standart sözleşme).
//   - staging (yalnız isteğe bağlı Türkiye VPS'i canlıdayken, VPS_HOST): yalnız workers.dev, gizli: sağlık uçları dışında
//             her yol parolalı; demo verili (SEED_MODE=demo), WhatsApp her zaman simülatör, kendi veri dönemi, noindex.
// Worker (kurallar src/access.ts):
//   - www.yemekgelsin.net → yemekgelsin.net (301); workers.dev'deki sayfa gezinmeleri özel alan adına (302).
//     API ve webhook istekleri workers.dev'de de çalışır.
//   - /api/* isteklerini API'ye (4000), diğerlerini web'e (3000) yönlendirir (Caddy düzeniyle aynı).
//   - Container'ın "yedek.internal" adresine yaptığı istekleri R2'ye yazar/okur (veritabanı ve görsel yedeği);
//     anahtarlar veri dönemi önekiyle (ör. e3/db/son.dump). Container dönemini açılışta alır ve yola yazar (/e3/db);
//     DATA_EPOCH artırılınca yeni container yedek bulamaz, veri sıfırdan kurulur (staging'in dönemi ayrıdır).
//   - Her yanıta "x-yg-ortam: cloudflare" ekler: isteğe bağlı VPS iş akışı DNS geçişinden sonra trafiğin artık Worker'dan
//     gelmediğini bununla anlar (.github/workflows/deploy-production.yml).
//   - Her yanıta güvenlik başlıklarını yazar (HSTS, CSP, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy;
//     src/security-headers.ts). /api/* ve yüklenen görseller Next.js'e uğramadığı için bu tek yer kapsayıcıdır.
//   - Gelen webhook'u container alamazsa (dağıtım, yeniden başlatma, çökme) ham isteği R2 tamponuna yazar ve sağlayıcıya
//     200 döner; container ayağa kalkınca kayıtlar sırayla geri verilir (src/webhook-spool.ts). Twilio gelen mesaj
//     webhook'unu yeniden teslim etmediği için bu tampon olmadan o mesaj kalıcı olarak kayboluyordu.
// Ortak numara (WhatsApp) alan adı kipinde (src/whatsapp-env.ts): GitHub secret'ları D360_API_KEY ve WA_PHONE tamsa
// 360dialog (varsayılan yol, 15 §6.2); META_WA_TOKEN, META_WA_PHONE_NUMBER_ID, META_APP_SECRET ve WA_PHONE (+ isteğe bağlı
// META_WA_WABA_ID) tamsa Meta Cloud API doğrudan (15 §6.2b); ikisi birlikte verilirse iş akışı durur. Hiçbiri tam değilse
// taklit (mock), yani çalışan WhatsApp yok (vitrinde ve QR'da WhatsApp bağlantısı gösterilmez). SMS her zaman mock.

import { Container, ContainerProxy, getContainer, switchPort } from '@cloudflare/containers';
import {
  isDevToolsPath,
  isNavigation,
  isWebhookPath,
  normalizeDeployMode,
  normalizeEpoch,
  parseBackupPath,
  redirectFor,
  requiresAuth,
} from './access';
import { uyariGonder } from './alert';
import { containerEnv, modeSettings, type ModeSettings } from './mode';
import { applySecurityHeaders, type SecurityHeaderOptions } from './security-headers';
import {
  DRAIN_HEADER,
  DRAIN_PATH,
  bosOzet,
  runDrain,
  shouldSpool,
  tamponaAlVeOnayla,
  type DrainOzeti,
  type UyariKancasi,
} from './webhook-spool';
import { WA_SECRET_NAMES, whatsappContainerEnv } from './whatsapp-env';

export { ContainerProxy };

interface Env {
  APP: DurableObjectNamespace<AppContainer>;
  BACKUPS: R2Bucket;
  /** Sitenin kanonik adresi (https://yemekgelsin.net); scripts/prepare-config.mjs iş akışının SITE_URL'sinden yazar */
  APP_BASE_URL: string;
  /** Veri dönemi: container'a açılışta verilir, R2 anahtarlarının öneki e<DATA_EPOCH>/; artırılınca veri sıfırdan kurulur (15 §13) */
  DATA_EPOCH: string;
  /** Dağıtılan commit (prepare-config yazar); container'da APP_VERSION, sağlık ucunda görünür */
  APP_VERSION?: string;
  /**
   * domain (canlı ortam, yemekgelsin.net; DEPLOY_ENV=production) | staging (gizli, workers.dev, demo verili; DEPLOY_ENV=dev).
   * Container'ın DEPLOY_ENV, DEV_TOOLS, ADMIN_TOTP_REQUIRED değerleri ve noindex bu kipten türetilir (src/mode.ts).
   */
  DEPLOY_MODE?: string;
  /** Container'daki seed: admin (yalnız platform yöneticisi + bayraklar) | demo (demo işletmeler) */
  SEED_MODE?: string;
  /**
   * Seed hesaplarının parolası (SEED_PASSWORD): canlı ortamda platform yöneticisinin (admin@yemekgelsin.net) parolası;
   * gizli staging'de ayrıca tüm sitenin HTTP Basic parolası
   */
  DEV_PASSWORD: string;
  SESSION_SECRET: string;
  TRACKING_SECRET: string;
  ENCRYPTION_KEY: string;
  WA_VERIFY_TOKEN: string;
  /** Ortak numara webhook yolundaki gizli belirteç (/api/v1/webhooks/wa/shared/<belirteç>); scripts/secrets.mjs üretir */
  PLATFORM_WA_WEBHOOK_TOKEN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  // Gerçek WhatsApp (isteğe bağlı GitHub secret'ları; iş akışı yalnız doluysa yükler, boşaltılınca siler; 15 §13, §6.2)
  /** 360dialog API anahtarı (varsayılan yol; numara anahtara bağlıdır) */
  D360_API_KEY?: string;
  /** Twilio hesap kimliği (AC…); gönderim adresindeki kimlik (docs/16 §3.1) */
  TWILIO_ACCOUNT_SID?: string;
  /** Twilio Auth Token: gönderim ve webhook imzası (X-Twilio-Signature) */
  TWILIO_AUTH_TOKEN?: string;
  /** Meta sistem kullanıcısı token'ı (süresiz; Meta doğrudan yolu) */
  META_WA_TOKEN?: string;
  /** Ortak numaranın Phone number ID'si */
  META_WA_PHONE_NUMBER_ID?: string;
  /** WhatsApp Business Account ID (admin kurulumundaki abonelik ve şablon adımları) */
  META_WA_WABA_ID?: string;
  /** Meta uygulamasının App secret'ı (webhook imzası) */
  META_APP_SECRET?: string;
  /** Ortak numara, E.164 */
  WA_PHONE?: string;
  // --- İzleme ve dayanıklılık (denetim 2026-10-04 madde 1.6, 1.7, 3.8) ---
  /**
   * Tamponlanan webhook'ları container'a geri verme ucunun (POST /__yg/webhook-drain) paylaşılan sırrı. Tanımsızsa uç
   * 404 döner (yalnız Worker'ın kendi cron'u boşaltır). Değeri koda YAZILMAZ: Worker secret'ı (15 §13).
   */
  WEBHOOK_DRAIN_SECRET?: string;
  /**
   * Kısa JSON uyarıların gönderildiği adres (webhook tamponlandı, drain hatası, container açılmadı). apps/api ile
   * AYNI ad kullanılır (apps/api/src/lib/alert.ts) ve src/mode.ts containerEnv ile container'a da geçirilir, yani
   * tek secret iki katmanı birden açar. Tanımsızsa yalnız günlük satırı kalır.
   */
  ALERT_WEBHOOK_URL?: string;
  /** Container'a geçirilir (apps/api süzgeci): dış kanala gidecek en düşük ağırlık, varsayılan "warning". */
  ALERT_MIN_SEVERITY?: string;
  /** "1": CSP yalnız rapor kipinde gönderilir (ilk yayında kırılan bir şey var mı diye); src/security-headers.ts */
  CSP_REPORT_ONLY?: string;
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
  // Son istekten 30 dk sonra uyur (SIGTERM → son yedek). Açık panel (SSE) bağlantısı uyumayı engeller. Canlı ortamda
  // Worker'ın Cron Trigger'ı (5 dk'da bir, aşağıda scheduled) container'ı hiç uyutmaz: uyanış (R2'den geri yükleme +
  // migration) WhatsApp yanıtını 20+ sn geciktiriyordu ve Twilio webhook'u 15 sn'de keser; arka plan işleri (alarm,
  // zaman aşımı iptali, saklama) de ancak container ayaktayken çalışır.
  sleepAfter = '30m';
  enableInternet = true;

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    const mode = normalizeDeployMode(env.DEPLOY_MODE);
    const staging = mode === 'staging';
    // Ortak numara kipi: D360_API_KEY + WA_PHONE → 360dialog; TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + WA_PHONE → Twilio;
    // META_* + WA_PHONE → Meta Cloud API; değilse mock. Gizli staging canlı numarayı ASLA kullanmaz (iş akışı
    // secret'ları da yüklemez).
    const wa = whatsappContainerEnv(staging ? {} : env);
    if (wa.conflict) console.error(`WhatsApp: ${wa.conflict}`);
    const someWaSecret = !staging && WA_SECRET_NAMES.some((k) => (env[k] ?? '').trim() !== '');
    console.log(
      `kip: ${mode} (DEPLOY_ENV=${modeSettings(mode).deployEnv}); ` +
        (wa.mode === 'd360'
          ? 'WhatsApp: gerçek numara (360dialog)'
          : wa.mode === 'twilio'
            ? 'WhatsApp: gerçek numara (Twilio)'
            : wa.mode === 'cloud'
              ? 'WhatsApp: gerçek numara (Meta Cloud API)'
              : `WhatsApp: mock (${staging ? 'simülatör' : 'canlı ortamda çalışan WhatsApp yok'})${someWaSecret && wa.missing.length ? `; eksik: ${wa.missing.join(', ')}` : ''}`),
    );
    // Ortam değişkenleri ve gerekçeleri: src/mode.ts containerEnv (DEPLOY_ENV, DEV_TOOLS, 2FA kipten türetilir)
    this.envVars = containerEnv(mode, { ...env, DATA_EPOCH: safeEpoch(env.DATA_EPOCH) }, wa.env);
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

  // --- Webhook tamponunu boşaltma (denetim 1.7) -------------------------------------------------------
  // Tek container örneği ("main") olduğu için bu Durable Object tamponun tek kapısıdır: aşağıdaki kilitle aynı anda
  // iki boşaltma turu çalışmaz, yani kayıtlar sıra bozulmadan ve tekrarsız geri verilir. Turun kendisi
  // src/webhook-spool.ts runDrain'dedir (denenebilsin diye).
  #drain: Promise<DrainOzeti> | null = null;

  /** Tamponu boşalt; bir tur çalışıyorsa onun sonucu beklenir (yeni tur açılmaz). */
  async drainWebhooks(limit?: number): Promise<DrainOzeti> {
    const calisan = this.#drain;
    if (calisan) return calisan;
    const tur = this.#tur(limit);
    this.#drain = tur;
    try {
      return await tur;
    } finally {
      if (this.#drain === tur) this.#drain = null;
    }
  }

  async #tur(limit?: number): Promise<DrainOzeti> {
    const state = await this.getState();
    // Container ayakta değilken boşaltmak isteği 150 sn bekletir: kayıtlar sonraki tura kalsın
    if (state.status !== 'healthy') return bosOzet();
    return runDrain({
      bucket: this.env.BACKUPS,
      epoch: safeEpoch(this.env.DATA_EPOCH),
      limit,
      uyar: (olay, ayrinti) => uyariGonder(this.env.ALERT_WEBHOOK_URL, olay, ayrinti),
      drainSecret: this.env.WEBHOOK_DRAIN_SECRET,
      baseUrl: this.env.APP_BASE_URL,
      gonder: (istek) => this.containerFetch(istek, API_PORT),
    });
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
  new Response('Yemek Gelsin staging: parola gerekli.', {
    status: 401,
    headers: {
      'www-authenticate': 'Basic realm="Yemek Gelsin staging", charset="UTF-8"',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

/** Canlı ortamda geliştirici araçları yoktur: container'a gitmeden 404. */
const devToolsNotFound = () =>
  new Response('Bulunamadı.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

const STARTING_PAGE = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5"><title>Başlatılıyor · Yemek Gelsin</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#faf7f2;color:#1f2937;text-align:center}</style></head>
<body><main><h1 style="font-size:1.25rem">Sistem başlatılıyor</h1><p>Site bir süre kullanılmadığı için uykudaydı. Sayfa birkaç saniye içinde kendiliğinden yenilenecek.</p></main></body></html>`;

/**
 * Ortam ve güvenlik başlıkları: her yanıtta "x-yg-ortam: cloudflare" (isteğe bağlı VPS iş akışı trafiğin Worker'dan mı
 * geldiğini bununla ayırır); gizli staging'de ayrıca "x-robots-tag: noindex, nofollow" (canlı ortam arama motorlarına
 * açıktır). Güvenlik başlıkları (HSTS, CSP, nosniff…) buradan geçen HER yanıta yazılır — /api/* ve yüklenen görseller
 * (/api/v1/uploads/*) dahil, çünkü o yanıtlar Next.js'e hiç uğramaz (src/security-headers.ts; denetim 3.8).
 */
function withEnvHeaders(res: Response, settings: ModeSettings, guvenlik: SecurityHeaderOptions): Response {
  const out = new Response(res.body, res);
  out.headers.set('x-yg-ortam', 'cloudflare');
  if (settings.noindex) out.headers.set('x-robots-tag', 'noindex, nofollow');
  applySecurityHeaders(out.headers, guvenlik);
  return out;
}

/**
 * Gelen webhook'u R2 tamponuna yazıp sağlayıcıya 200 döner (ayrıntı: src/webhook-spool.ts tamponaAlVeOnayla).
 * Uyarı gönderimi yanıtı bekletmez: ctx.waitUntil ile istekten sonra sürer.
 */
const tamponaAl = (env: Env, ctx: ExecutionContext, request: Request, url: URL, govde: ArrayBuffer, neden: string) => {
  const uyar: UyariKancasi = (olay, ayrinti) => ctx.waitUntil(uyariGonder(env.ALERT_WEBHOOK_URL, olay, ayrinti));
  return tamponaAlVeOnayla(
    { bucket: env.BACKUPS, epoch: safeEpoch(env.DATA_EPOCH), uyar },
    { yontem: request.method, yol: `${url.pathname}${url.search}`, basliklar: request.headers, govde },
    neden,
  );
};

/**
 * POST /__yg/webhook-drain — tamponu container'a geri verir. Paylaşılan sır (WEBHOOK_DRAIN_SECRET) zorunludur;
 * sır tanımsız ya da yanlışsa ucun varlığı bile belli olmasın diye 404 döner. Worker'ın kendi Cron Trigger'ı bu uca
 * HTTP ile değil doğrudan (RPC) gider, yani sır yoksa da zamanlanmış boşaltma çalışır.
 */
async function handleDrain(request: Request, env: Env): Promise<Response> {
  const json = (govde: unknown, status: number) =>
    new Response(JSON.stringify(govde), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  // Sır ÖNCE bakılır: yanlış ya da eksik sırda yöntem hatası bile dönülmez (405 "yöntem desteklenmiyor" yanıtı
  // ucun var olduğunu açığa vuruyordu; gizli staging'de parola kapısını da atlıyordu).
  const sir = (env.WEBHOOK_DRAIN_SECRET ?? '').trim();
  const verilen = request.headers.get(DRAIN_HEADER) ?? '';
  if (!sir || !timingSafeEqual(verilen, sir)) return devToolsNotFound();
  if (request.method !== 'POST') {
    return new Response('yöntem desteklenmiyor', { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
  }
  try {
    return json(await getContainer(env.APP, INSTANCE).drainWebhooks(), 200);
  } catch (err) {
    console.error('webhook drain ucu hatası', err);
    return json({ ok: false, hata: 'drain başarısız' }, 500);
  }
}

/**
 * Container'ı arka planda uyandırır, ayağa kalkarsa tamponu boşaltır. Yanıtı bekletmemek için yalnız
 * `ctx.waitUntil` ile çağrılır; hata atmaz (tur başarısız olursa kayıtlar R2'de durur, 5 dakikalık cron yeniden dener).
 */
async function uyandirVeBosalt(app: DurableObjectStub<AppContainer>): Promise<void> {
  try {
    if (await app.ensureReady()) await app.drainWebhooks();
    else console.error('webhook tamponu: container açılmadı, kayıtlar sonraki tura kaldı');
  } catch (err) {
    console.error('webhook tamponu boşaltılamadı (container uyandırma)', err);
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const accept = request.headers.get('accept');
    const navigation = isNavigation(request.method, accept);
    const mode = normalizeDeployMode(env.DEPLOY_MODE);
    const settings = modeSettings(mode);
    const guvenlik: SecurityHeaderOptions = {
      https: url.protocol === 'https:',
      cspReportOnly: (env.CSP_REPORT_ONLY ?? '').trim() === '1',
    };

    // Tamponu boşaltma ucu: paylaşılan sırla korunur, container'a hiç gitmez (yönlendirme ve parola kapısından önce)
    if (url.pathname === DRAIN_PATH) return withEnvHeaders(await handleDrain(request, env), settings, guvenlik);

    // www → kök alan adı (301); workers.dev'deki sayfa gezinmeleri → özel alan adı (302). Container gerekmez.
    const redirect = redirectFor(url, request.method, accept, env.APP_BASE_URL);
    if (redirect) {
      return withEnvHeaders(new Response(null, { status: redirect.status, headers: { location: redirect.location } }), settings, guvenlik);
    }
    // Canlı ortamda geliştirici araçları 404; gizli staging'de sağlık uçları dışında her yol parolalı
    if (settings.blockDevTools && isDevToolsPath(url.pathname)) return withEnvHeaders(devToolsNotFound(), settings, guvenlik);
    if (requiresAuth(url.pathname, mode) && !authorized(request, env)) return withEnvHeaders(unauthorized(), settings, guvenlik);

    // Gelen webhook (POST): gövde belleğe alınır ki container alamazsa R2 tamponuna yazılabilsin (denetim 1.7).
    // Yalnız webhook yolları; GET /webhooks/* (Meta doğrulaması) canlı yanıt ister, tamponlanmaz.
    const webhookPost = request.method === 'POST' && isWebhookPath(url.pathname);
    const govde = webhookPost ? await request.arrayBuffer() : null;

    const app = getContainer(env.APP, INSTANCE);
    const state = await app.getState();
    let yenidenAyaktaMi = false;
    if (state.status !== 'healthy') {
      if (navigation) {
        // Uyuyan container'ı arka planda uyandır; kullanıcı bekleme sayfası görür
        ctx.waitUntil(app.ensureReady());
        return withEnvHeaders(
          new Response(STARTING_PAGE, {
            status: 503,
            headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '5', 'cache-control': 'no-store' },
          }),
          settings,
          guvenlik,
        );
      }
      // Gelen webhook: container'ın AÇILMASINI BEKLEMEDEN tampona yazılır ve sağlayıcıya 200 dönülür. Beklemek üç
      // şeyi birden bozuyordu: (1) ensureReady 150 sn'ye kadar sürer, Twilio 15 sn'de keser; (2) istemci koparsa
      // Worker iptal edilebilir ve kayıt hiç yazılmaz — tam da önlenmek istenen kayıp; (3) bekleyen isteklerin
      // tampon zaman damgası geliş sırasını değil bekleyişin bittiği anı gösterir, yani mesaj SIRASI bozulur
      // (sohbet durumu sıraya duyarlı). Container arka planda uyandırılır, hemen ardından tampon sırayla boşaltılır.
      if (govde) {
        const yanit = await tamponaAl(env, ctx, request, url, govde, 'container_hazir_degil');
        if (yanit.ok) {
          ctx.waitUntil(uyandirVeBosalt(app));
          return withEnvHeaders(yanit, settings, guvenlik);
        }
        // Tampona yazılamadı (R2 erişilemez; uyarı tamponaAl içinde verildi): container'ı bekleyip isteği doğrudan
        // iletmeyi dene — 200 dönmek kaydı olmayan bir kayba onay vermek olurdu.
      }
      if (!(await app.ensureReady())) {
        // Uyarı burada gönderilmez: container düştüğünde her istek bir uyarı üretir ve kanalı boğar. Uyarıyı 5
        // dakikalık uyanık tutma turu verir (aşağıdaki scheduled); webhook yolu ise her hâlde uyarı üretir.
        console.error('container başlatılamadı (istek 503)');
        return withEnvHeaders(new Response('Sistem başlatılamadı, biraz sonra tekrar deneyin.', { status: 503 }), settings, guvenlik);
      }
      yenidenAyaktaMi = true;
    }

    // Container yeni ayağa kalktı: tamponda bekleyen kayıt olabilir, sırayla geri verilir (yanıtı bekletmez).
    if (yenidenAyaktaMi) {
      ctx.waitUntil(app.drainWebhooks().then(() => undefined, (err) => console.error('webhook drain başlatılamadı', err)));
    }

    // Uygulama gerçek istemci IP'sini X-Forwarded-For'dan okur (Fastify trustProxy); Basic parola (staging) içeriye iletilmez
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) headers.set('x-forwarded-for', ip);
    headers.set('x-forwarded-proto', 'https');
    headers.set('x-forwarded-host', url.host);
    // Webhook gövdesi okunduğu için istek yeniden kurulur (okunmuş gövdeli istek aktarılamaz). Gövdenin KOPYASI
    // verilir: container yanıtı 5xx gelirse tampona yazılacak baytlar her durumda elimizde kalsın.
    const forwarded = govde
      ? new Request(url.toString(), { method: request.method, headers, body: govde.slice(0) })
      : new Request(request, { headers });

    const port = url.pathname.startsWith('/api/') ? API_PORT : WEB_PORT;
    try {
      const res = await app.fetch(switchPort(forwarded, port));
      // Container isteği aldı ama sunucu hatası döndü (DB düştü, süreç çöktü): webhook'u kaybetme, tampona al.
      // 401/404 gibi geçerli retler olduğu gibi sağlayıcıya döner (shouldSpool).
      if (govde && shouldSpool(res.status)) {
        return withEnvHeaders(await tamponaAl(env, ctx, request, url, govde, `container_${res.status}`), settings, guvenlik);
      }
      return withEnvHeaders(res, settings, guvenlik);
    } catch (err) {
      if (govde) {
        console.error('webhook container\'a iletilemedi', err);
        return withEnvHeaders(await tamponaAl(env, ctx, request, url, govde, 'container_hatasi'), settings, guvenlik);
      }
      throw err;
    }
  },

  /**
   * Uyanık tutma (Cron Trigger, wrangler.jsonc triggers.crons): canlı ortamda container'a 5 dk'da bir sağlık isteği gider;
   * her istek uyku sayacını (sleepAfter) sıfırlar, container uyumaz. Uyuyorsa uyandırılır (ör. dağıtımdan sonra).
   * Maliyet: basic örnek sürekli açık ≈ 7 $/ay (bellek + disk sağlanan kaynağa, CPU yalnız kullanıma göre; 15 §13).
   * Gizli staging'de çalışmaz (config-modes.mjs tetikleyiciyi de siler).
   */
  async scheduled(_controller, env, ctx): Promise<void> {
    if (normalizeDeployMode(env.DEPLOY_MODE) !== 'domain') return;
    ctx.waitUntil(
      (async () => {
        const app = getContainer(env.APP, INSTANCE);
        try {
          if (!(await app.ensureReady())) {
            console.error('uyanık tutma: container başlatılamadı');
            await uyariGonder(env.ALERT_WEBHOOK_URL, 'container_baslatilamadi', { kaynak: 'uyanik_tutma' });
            return;
          }
          // Sağlık yoklaması kendi try'ındadır: yoklama patlasa bile AŞAĞIDAKİ tampon boşaltma çalışmalı — yoksa
          // bozuk bir /health ucu tamponu süresiz rehin alır (kayıtlar her turda atlanır).
          try {
            const res = await app.fetch(switchPort(new Request('http://container/api/v1/health'), API_PORT));
            if (!res.ok) {
              console.error(`uyanık tutma: sağlık ucu ${res.status}`);
              await uyariGonder(env.ALERT_WEBHOOK_URL, 'uyanik_tutma_hatasi', { durum: res.status });
            }
          } catch (err) {
            console.error('uyanık tutma: sağlık yoklaması başarısız', err);
            await uyariGonder(env.ALERT_WEBHOOK_URL, 'uyanik_tutma_hatasi', { hata: String(err).slice(0, 200) });
          }
          // Dağıtım/çökme penceresinde tamponlanan webhook'lar: container ayaktayken sırayla geri verilir (denetim 1.7).
          // En kötü durumda kayıt bir sonraki turu (5 dk) bekler; kaybolmaz.
          await app.drainWebhooks();
        } catch (err) {
          console.error('uyanık tutma hatası', err);
          await uyariGonder(env.ALERT_WEBHOOK_URL, 'uyanik_tutma_hatasi', { hata: String(err).slice(0, 200) });
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
