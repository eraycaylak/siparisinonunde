// Gelen webhook tamponu ve geri verme (drain) — denetim 2026-10-04 madde 1.7 / B8; docs/06 §2 ilke 2 "sipariş kaçmaz".
// Saf fonksiyonlar + R2 erişimi: scripts/webhook-spool.test.mjs ile denenir (node --test; Node'un tür ayıklamasıyla
// çalışır, bu yüzden yalnız silinebilir TypeScript sözdizimi kullanılır).
//
// SORUN: container kapanıp yenisi R2'den geri yükleme + migration ile açılırken (dağıtım, OOM, çökme; ~20–60 sn)
// Worker isteği 150 sn bekletiyordu; Twilio 15 sn'de keser ve gelen mesaj webhook'unu BİR DAHA teslim etmez. O anki
// Akış B onay kodu ya da sipariş mesajı kalıcı olarak yok oluyordu ve kaybın hiçbir kaydı kalmıyordu.
//
// ÇÖZÜM: container alamadığında Worker ham isteği R2'ye yazar ve sağlayıcıya 200 döner (sağlayıcı yeniden denemesin,
// mesaj da kaybolmasın). Container ayağa kalkınca kayıtlar SIRAYLA container'a geri verilir; kabul edileni silinir,
// edilmeyeni yerinde bırakılır. İmza başlıkları (X-Twilio-Signature, X-Hub-Signature-256) aynen saklanır: container
// kaydı kendi doğrulamasından geçirir, yani tampon doğrulamayı atlatan bir arka kapı değildir.
//
// ANAHTAR DÜZENİ: `e<dönem>/webhook-tampon/<alınma ms, 14 hane>-<gövde özeti, 16 hane>.json`
//   - sıralı: R2 listesi anahtar sırasına göre döner, yani kayıtlar GELİŞ SIRASINDA boşaltılır (WhatsApp sohbet
//     durumu sıraya duyarlıdır);
//   - tekil: aynı anda gelen iki farklı mesaj aynı anahtara düşmez;
//   - idempotent: aynı istek iki kez yazılmaya çalışılırsa (sağlayıcı tekrarı) `e<dönem>/webhook-tampon-imza/<özet>`
//     mührü görülür ve ikinci kopya yazılmaz. Mühür, kayıt başarıyla boşaltılınca silinir (sonsuz birikmez).
//   - dönem öneki (DATA_EPOCH) ŞART: gizli staging ile canlı ortam AYNI R2 kovasını paylaşır, staging canlının
//     webhook'larını boşaltmamalı.

// Çalışma zamanında başka bir modüle BAĞIMLI DEĞİL (yalnız tür importu): Node'un tür ayıklamasıyla doğrudan
// yüklenebilsin diye. Uyarı gönderimi (src/alert.ts) ve yol kuralı (src/access.ts isWebhookPath) dışarıdan verilir.
import type { UyariAyrinti, UyariOlayi } from './alert';

/** Tamponu container'a geri verme ucu (yalnız paylaşılan sırla; Worker'ın kendi cron'u da bunu çağırır). */
export const DRAIN_PATH = '/__yg/webhook-drain';

/** Paylaşılan sır başlığı: ucu çağırmak için zorunlu, geri verilen istekte container'a da gönderilir (WEBHOOK_DRAIN_SECRET). */
export const DRAIN_HEADER = 'x-yg-drain-key';

/** Geri verilen (tampondan gelen) isteğin işareti: değer kaydın alınma zamanıdır (container bunu loglayabilir). */
export const REPLAY_HEADER = 'x-yg-webhook-replay';

/** Tampona yazılan en büyük gövde (WhatsApp webhook'ları onlarca KB'dır; daha büyüğü tampona alınmaz). */
export const MAX_SPOOL_BYTES = 1_048_576;

/** Bir boşaltma turunda en çok kaç kayıt (tur kısa kalsın; kalanı sonraki tur alır). */
export const DRAIN_BATCH = 25;

/**
 * Tamponda saklanan başlıklar. Beyaz liste: imza ve içerik türü doğrulama için ZORUNLU, istemci IP'si hız sınırı ve
 * denetim kaydı için gerekli. Çerez/authorization gibi başlıklar ve `content-length`, `host` gibi aktarım başlıkları
 * BİLEREK saklanmaz (gövde yeniden kurulurken Worker kendisi yazar).
 */
export const STORED_HEADERS: readonly string[] = [
  'content-type',
  'x-twilio-signature',
  'x-hub-signature-256',
  'x-hub-signature',
  'user-agent',
  'cf-connecting-ip',
];

/**
 * Uyarı kancası: Worker bunu src/alert.ts uyariGonder'a bağlar. Söz dönerse beklenir (Durable Object içinde isteğin
 * bitmesini beklemeden gönderim kesilmesin); istek yolunda ctx.waitUntil ile bağlanıp undefined döndürülür.
 */
export type UyariKancasi = (olay: UyariOlayi, ayrinti: UyariAyrinti) => void | Promise<unknown>;

const SPOOL_DIR = 'webhook-tampon';
const MARK_DIR = 'webhook-tampon-imza';
const EPOCH_RE = /^[0-9]{1,6}$/;

/**
 * Log ve uyarılarda kullanılacak maskeli yol: webhook belirteci (ortak numarada PLATFORM_WA_WEBHOOK_TOKEN) ve sorgu
 * dizesi gizlenir (apps/api/src/lib/log.ts ile aynı kural).
 */
export function maskWebhookPath(path: string): string {
  const yol = path.split('?')[0] ?? '';
  return yol.replace(/(\/webhooks\/wa\/(?:shared\/)?)[^/?#]+/, '$1••••');
}

/** R2 anahtar öneki: dönem geçerliyse "e3/", değilse "" (geçersiz dönemle container hiç açılmaz). */
export function spoolPrefix(epoch: string | undefined): string {
  const e = (epoch ?? '').trim();
  return EPOCH_RE.test(e) ? `e${e}/` : '';
}

/** Tampon klasörü (listeleme öneki). */
export function spoolDir(epoch: string | undefined): string {
  return `${spoolPrefix(epoch)}${SPOOL_DIR}/`;
}

/** Kayıt anahtarı: zaman + özet (sıralı ve tekil). */
export function recordKey(epoch: string | undefined, alindiMs: number, ozet: string): string {
  return `${spoolDir(epoch)}${String(alindiMs).padStart(14, '0')}-${ozet.slice(0, 16)}.json`;
}

/** Mühür anahtarı: aynı gövdenin ikinci kez yazılmasını engeller. */
export function markerKey(epoch: string | undefined, ozet: string): string {
  return `${spoolPrefix(epoch)}${MARK_DIR}/${ozet}`;
}

/** SHA-256, onaltılık. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  // Parça parça: tek seferde yayılan büyük dizi çağrı yığınını taşırır
  for (let i = 0; i < arr.length; i += 0x8000) out += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return btoa(out);
}

export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Tampondaki bir kayıt (R2'de JSON olarak durur). */
export interface SpoolRecord {
  /** Kayıt biçimi sürümü (ileride alan eklenirse eski kayıtlar okunabilsin) */
  surum: 1;
  /** Alınma zamanı (ISO 8601, UTC) */
  alindi: string;
  yontem: string;
  /** Çağrılan yol + sorgu, AYNEN (Twilio imzası adres üzerinden hesaplanır; değişirse doğrulama bozulur) */
  yol: string;
  basliklar: Record<string, string>;
  /** Ham gövde, base64 (JSON ya da form-encoded olabilir; bayt bayt korunur) */
  govdeB64: string;
  /** Ham gövdenin SHA-256'sı (idempotency mührü ve teşhis) */
  ozet: string;
}

/** Saklanacak başlıklar (beyaz liste; yoksa atlanır). */
export function storedHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of STORED_HEADERS) {
    const value = headers.get(name);
    if (value !== null && value !== '') out[name] = value;
  }
  return out;
}

export function encodeRecord(kayit: SpoolRecord): string {
  return JSON.stringify(kayit);
}

/** Bozuk/eski kayıtta null döner (çağıran kaydı siler değil, yerinde bırakır ve uyarır). */
export function parseRecord(text: string): SpoolRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const k = raw as Partial<SpoolRecord>;
  if (k.surum !== 1 || typeof k.yol !== 'string' || typeof k.yontem !== 'string' || typeof k.govdeB64 !== 'string') return null;
  if (!k.yol.startsWith('/') || typeof k.alindi !== 'string') return null;
  return {
    surum: 1,
    alindi: k.alindi,
    yontem: k.yontem,
    yol: k.yol,
    basliklar: k.basliklar && typeof k.basliklar === 'object' ? (k.basliklar as Record<string, string>) : {},
    govdeB64: k.govdeB64,
    ozet: typeof k.ozet === 'string' ? k.ozet : '',
  };
}

/** Kaydın ham gövdesi. */
export function recordBody(kayit: SpoolRecord): Uint8Array {
  return fromBase64(kayit.govdeB64);
}

/**
 * Yanıt tampona düşmeli mi: yalnız sunucu hatası (5xx) ve ağ hatası (status 0). 401 (imza geçersiz) ve 404
 * (bilinmeyen belirteç) GEÇERLİ retlerdir — onları tamponlamak çöp biriktirir, olduğu gibi sağlayıcıya döner.
 */
export function shouldSpool(status: number): boolean {
  return status === 0 || status >= 500;
}

export interface SpoolInput {
  yontem: string;
  /** Yol + sorgu (ör. /api/v1/webhooks/wa/shared/abc?x=1) */
  yol: string;
  basliklar: Headers;
  govde: ArrayBuffer;
}

export interface SpoolResult {
  anahtar: string;
  ozet: string;
  /** false: aynı gövde zaten tamponda (sağlayıcı tekrarı), ikinci kopya yazılmadı */
  yeni: boolean;
}

/**
 * İsteği tampona yazar. Hata atarsa çağıran sağlayıcıya 200 DÖNMEMELİ (kaydı olmayan kayıp olur).
 * Kişisel veri: ham gövde müşterinin telefonunu ve mesaj metnini taşır — veritabanı yedeğiyle aynı kovada,
 * aynı KVKK saklama kurallarına tabidir (08 §2.8; boşaltılan kayıt hemen silinir).
 */
export async function spoolWebhook(
  deps: { bucket: R2Bucket; epoch: string | undefined; now?: number },
  istek: SpoolInput,
): Promise<SpoolResult> {
  if (istek.govde.byteLength > MAX_SPOOL_BYTES) {
    throw new Error(`webhook gövdesi tampon sınırını aşıyor (${istek.govde.byteLength} > ${MAX_SPOOL_BYTES})`);
  }
  const alindiMs = deps.now ?? Date.now();
  const ozet = await sha256Hex(istek.govde);
  const muhur = markerKey(deps.epoch, ozet);
  const varMi = await deps.bucket.head(muhur);
  const anahtar = recordKey(deps.epoch, alindiMs, ozet);
  if (varMi) return { anahtar, ozet, yeni: false };

  const kayit: SpoolRecord = {
    surum: 1,
    alindi: new Date(alindiMs).toISOString(),
    yontem: istek.yontem,
    yol: istek.yol,
    basliklar: storedHeaders(istek.basliklar),
    govdeB64: toBase64(istek.govde),
    ozet,
  };
  await deps.bucket.put(anahtar, encodeRecord(kayit), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { ozet, alindi: kayit.alindi },
  });
  // Mühür kayıttan SONRA yazılır: arada kesilirse kayıt elde kalır (iki kopya, kayıp değil)
  await deps.bucket.put(muhur, anahtar, { customMetadata: { anahtar } });
  return { anahtar, ozet, yeni: true };
}

export interface DeliveryResult {
  ok: boolean;
  /** HTTP durumu; ağ hatasında 0 */
  status: number;
}

export interface DrainOzeti {
  /** Bu turda listede bulunan kayıt */
  bulundu: number;
  /** Container kabul etti (2xx) → kayıt ve mührü silindi */
  gonderildi: number;
  /** Container kalıcı reddetti (4xx) → kayıt BIRAKILDI, uyarı verildi (elle bakılmalı) */
  reddedildi: number;
  /** Okunamayan/ayrıştırılamayan kayıt → bırakıldı */
  bozuk: number;
  /** Geçici hata (5xx/ağ) → bırakıldı ve tur durduruldu */
  basarisiz: number;
  /** Sıra bozulmasın diye tur erken bitti mi */
  durdu: boolean;
  /** Tur sonunda tamponda kalan (silinmeyen) kayıt sayısı */
  kalan: number;
  /** Listede batch sınırının ötesinde daha kayıt var mı */
  dahaVar: boolean;
}

export function bosOzet(): DrainOzeti {
  return { bulundu: 0, gonderildi: 0, reddedildi: 0, bozuk: 0, basarisiz: 0, durdu: false, kalan: 0, dahaVar: false };
}

/**
 * Tamponu geliş sırasında boşaltır.
 * - 2xx → kayıt ve mührü silinir.
 * - 5xx / ağ hatası → kayıt bırakılır ve TUR DURDURULUR: container hâlâ hasta, ayrıca sonraki kaydı önce göndermek
 *   mesaj sırasını bozardı (sohbet durumu sıraya duyarlı).
 * - 4xx → kayıt bırakılır, uyarı verilir, sıradakine geçilir (tek bir kalıcı ret bütün kuyruğu tıkamasın).
 * Kayıt KENDİLİĞİNDEN SİLİNMEZ: "sipariş kaçmaz" ilkesi gereği hiçbir kayıt sessizce atılmaz, operatör bakana kadar
 * tamponda durur ve her turda uyarı üretir.
 */
export async function drainSpool(deps: {
  bucket: R2Bucket;
  epoch: string | undefined;
  teslim: (kayit: SpoolRecord, anahtar: string) => Promise<DeliveryResult>;
  limit?: number;
  /** Kalıcı ret ya da bozuk kayıt görülünce çağrılır (uyarı/log; akışı durdurmaz) */
  bildir?: (olay: 'reddedildi' | 'bozuk', anahtar: string, status: number) => void;
}): Promise<DrainOzeti> {
  const limit = deps.limit ?? DRAIN_BATCH;
  const ozet = bosOzet();
  const liste = await deps.bucket.list({ prefix: spoolDir(deps.epoch), limit });
  const anahtarlar = liste.objects.map((o) => o.key).sort();
  ozet.bulundu = anahtarlar.length;
  ozet.dahaVar = Boolean(liste.truncated);

  for (const anahtar of anahtarlar) {
    const nesne = await deps.bucket.get(anahtar);
    if (!nesne) continue; // başka bir tur almış
    const kayit = parseRecord(await nesne.text());
    if (!kayit) {
      ozet.bozuk++;
      deps.bildir?.('bozuk', anahtar, 0);
      continue;
    }
    const sonuc = await deps.teslim(kayit, anahtar);
    if (sonuc.ok) {
      await deps.bucket.delete(anahtar);
      if (kayit.ozet) await deps.bucket.delete(markerKey(deps.epoch, kayit.ozet));
      ozet.gonderildi++;
      continue;
    }
    if (shouldSpool(sonuc.status)) {
      ozet.basarisiz++;
      ozet.durdu = true;
      break;
    }
    ozet.reddedildi++;
    deps.bildir?.('reddedildi', anahtar, sonuc.status);
  }
  ozet.kalan = ozet.bulundu - ozet.gonderildi;
  return ozet;
}

// --- Worker ile tampon arasındaki bağ ----------------------------------------------------------------
// Aşağısı Worker'ın iki hareketi: (1) alınan webhook'u tampona yazıp sağlayıcıya 200 dönmek, (2) container ayaktayken
// tamponu sırayla geri vermek. Bağımlılıklar (R2, container'a gönderim, bekletme) parametre olarak verilir, böylece
// scripts/webhook-spool.test.mjs gerçek Cloudflare ortamı olmadan deneyebilir.

export interface TamponOrtami {
  bucket: R2Bucket;
  /** DATA_EPOCH (doğrulanmış) */
  epoch: string | undefined;
  /** Uyarı gönderimi (src/alert.ts); verilmezse yalnız günlük satırı kalır */
  uyar?: UyariKancasi;
  now?: number;
}

/**
 * Gelen webhook'u tampona yazar ve sağlayıcıya 200 döner (Twilio gelen mesaj webhook'unu bir daha teslim etmez).
 * Yazamazsa 503 döner: kaydı olmayan bir kayba 200 demek sorunu görünmez kılar.
 */
export async function tamponaAlVeOnayla(
  ortam: TamponOrtami,
  istek: { yontem: string; yol: string; basliklar: Headers; govde: ArrayBuffer },
  neden: string,
): Promise<Response> {
  const yol = maskWebhookPath(istek.yol);
  try {
    const sonuc = await spoolWebhook({ bucket: ortam.bucket, epoch: ortam.epoch, now: ortam.now }, istek);
    console.warn(`webhook tamponlandı (${neden}): ${yol} → ${sonuc.anahtar}${sonuc.yeni ? '' : ' (aynısı zaten tamponda)'}`);
    await ortam.uyar?.('webhook_tamponlandi', {
      neden,
      yol,
      anahtar: sonuc.anahtar,
      bayt: istek.govde.byteLength,
      yeni: sonuc.yeni,
    });
    return new Response(JSON.stringify({ ok: true, tamponlandi: true }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (err) {
    console.error(`webhook TAMPONLANAMADI (${neden}): ${yol}`, err);
    await ortam.uyar?.('webhook_tampon_yazilamadi', { neden, yol, hata: String(err).slice(0, 200) });
    return new Response('Şu an alınamıyor.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '10', 'cache-control': 'no-store' },
    });
  }
}

export interface DrainOrtami extends TamponOrtami {
  /** Kaydı container'a gönderir (Worker'da: containerFetch, API portu) */
  gonder: (istek: Request) => Promise<Response>;
  /** WEBHOOK_DRAIN_SECRET: geri verilen isteğe eklenir, container "bu Worker'dan geldi" diyebilir */
  drainSecret?: string;
  /** APP_BASE_URL (x-forwarded-host için) */
  baseUrl?: string;
  limit?: number;
}

/** Tampondaki kaydı birebir container isteğine çevirir (imza başlıkları ve yol aynen korunur). */
export function replayRequest(kayit: SpoolRecord, ortam: Pick<DrainOrtami, 'drainSecret' | 'baseUrl'>): Request {
  const headers = new Headers(kayit.basliklar);
  const ip = headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  headers.set('x-forwarded-proto', 'https');
  try {
    if (ortam.baseUrl) headers.set('x-forwarded-host', new URL(ortam.baseUrl).host);
  } catch {
    // APP_BASE_URL bozuksa başlık yazılmaz; container kendi APP_BASE_URL'sini bilir
  }
  // Container bu isteğin tampondan geldiğini görür (değer: kaydın alınma zamanı)
  headers.set(REPLAY_HEADER, kayit.alindi);
  const sir = (ortam.drainSecret ?? '').trim();
  if (sir) headers.set(DRAIN_HEADER, sir);
  return new Request(`http://container${kayit.yol}`, { method: kayit.yontem, headers, body: recordBody(kayit) });
}

/** Bir boşaltma turu: kayıtları sırayla geri verir, sonucu günlüğe yazar ve gerekirse uyarır. */
export async function runDrain(ortam: DrainOrtami): Promise<DrainOzeti> {
  let ozet = bosOzet();
  try {
    ozet = await drainSpool({
      bucket: ortam.bucket,
      epoch: ortam.epoch,
      limit: ortam.limit,
      teslim: async (kayit) => {
        try {
          const res = await ortam.gonder(replayRequest(kayit, ortam));
          return { ok: res.ok, status: res.status };
        } catch (err) {
          console.error('webhook drain: container isteği başarısız', err);
          return { ok: false, status: 0 };
        }
      },
      bildir: (olay, anahtar, status) => {
        console.error(`webhook drain: kayıt ${olay} (durum ${status}) ${anahtar}`);
        void ortam.uyar?.('webhook_drain_reddedildi', { olay, anahtar, durum: status });
      },
    });
  } catch (err) {
    console.error('webhook drain: tur başarısız', err);
    await ortam.uyar?.('webhook_drain_hatasi', { hata: String(err).slice(0, 200) });
    return ozet;
  }
  if (ozet.gonderildi > 0) console.log(`webhook drain: ${ozet.gonderildi} kayıt container'a verildi, ${ozet.kalan} kaldı`);
  if (ozet.basarisiz > 0) {
    await ortam.uyar?.('webhook_drain_hatasi', {
      gonderildi: ozet.gonderildi,
      basarisiz: ozet.basarisiz,
      kalan: ozet.kalan,
    });
  }
  return ozet;
}
