// GET /api/v1/health — süreç ve veritabanı durumu (Docker sağlık denetimi).
// GET /api/v1/health/worker — arka plan işlerinin gecikmesi + son yedeğin yaşı + disk/bellek baskısı
//   (ölçüm SAYILARI yalnız `HEALTH_METRICS_TOKEN` başlığıyla; aşağıya bakın).
//
// "ÇALIŞIYOR MU" İLE "SAĞLIKLI MI" AYRI SİNYALLERDİR (denetim 2026-10-05 bulgu A). `/health/worker` iki şey söyler:
//   - `ok` + durum kodu: hizmet GERÇEKTEN verilebiliyor mu. `ok:false` + **503** yalnız veritabanı düştüyse, vadesi
//     gelmiş bekleyen iş 300 sn'den fazla geciktiyse ya da takılı `running` iş varsa üretilir. Dış izleme ve
//     dağıtımın duman testi buna bakar.
//   - `degraded` + `warnings[]`: ölçülebilir bir eşik aşıldı (yedek eskidi, disk azaldı, bellek tavana yaklaştı)
//     ama hizmet sürüyor → durum kodu **200** kalır, haber yolu uyarı kanalıdır (`alert()`, lib/alert.ts).
//
// Neden ayrıldı: bu eşikler ilk yazıldığında `ok:false` + 503 üretiyordu. Dağıtımın duman testi `/health/worker`'dan
// 200 bekler ve kırmızıysa son adım `wrangler rollback` çalıştırır (.github/workflows/deploy-dev-cloudflare.yml) —
// yani SAĞLAM bir dağıtım, yalnızca son yedek biraz eski diye otomatik geri alınıyordu. Yedek eskimesi, dolan disk ve
// yüksek bellek bir dağıtım hatası DEĞİLDİR; geri alma onları düzeltmez, üstüne yeni container açılışı son yedekten
// sonraki ~2 dakikayı kaybettirir. Eşik aşımı artık dağıtımı ve container'ı değil NÖBETÇİYİ rahatsız eder.
//
// "AYAKTA MI" İLE "ÖLÇÜM" DE AYRI SİNYALLERDİR (denetim 2026-10-05 bulgu A-2). Bu uç KİMLİK DOĞRULAMASIZDIR ve
// Worker'da parola kapısının dışındadır (deploy/cloudflare/src/access.ts HEALTH_PATHS): herkese açıktır.
//   - SADE ALANLAR her isteğe yazılır: `ok`, `degraded`, `warnings`, `db`, `jobLagSec`, `stuckJobs`, `maxLagSec`,
//     `time`. Dış izleme ve dağıtımın duman testi bunlara bakar (docs/15 §10, §12) — SÖZLEŞME, değişmez.
//   - AYRINTILI ÖLÇÜMLER (`lastBackupAgeSec`, `diskFreePct`/`diskFreeMb`, `memUsedPct`/`memRssMb` ve bunların
//     eşikleri) yalnız doğru `HEALTH_METRICS_TOKEN` başlığını taşıyan isteğe yazılır; belirteçsiz yanıtta bu
//     alanlar HİÇ BULUNMAZ (`null` değil, yok). Gerekçe: bu sayılar altyapının iç durumudur ve saldırgana
//     ZAMANLAMA bilgisi verir — "yedek 2 dk'da bir alınıyor, son tur 110 sn önceydi" penceresini, diskin ne
//     zaman dolacağını, belleğin OOM'a ne kadar yakın olduğunu. Arızanın SINIFI (`warnings`) açık kalır çünkü
//     haber yolu odur; MİKTARI ve ANI gizlidir.
//
// Eşikler neden `/health`'te DEĞİL (denetim 2026-10-04 madde 1.5 ve H23): `/api/v1/health` üç yerin canlılık probudur —
// docker-compose `api` healthcheck'i, Worker'ın uyanık tutma cron'u (deploy/cloudflare/src/index.ts) ve dağıtımın
// sürüm kapısı. Orada 503 dönmek container'ı yeniden başlatır ve dağıtımı bloke eder; "disk doluyor" halinde yeniden
// başlatma döngüsü sorunu büyütür. `/health`'in alanları ve anlamları DEĞİŞMEDİ (duman testi onlara bakıyor).

import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { timingSafeEqual } from 'node:crypto';
import { readFile, statfs } from 'node:fs/promises';
import { getHeapStatistics } from 'node:v8';
import { z } from 'zod';
import { alert, type AlertInput, type AlertSeverity } from '../lib/alert';

const healthResponse = z.object({
  ok: z.boolean(),
  db: z.enum(['up', 'down']),
  time: z.string(),
  uptimeSec: z.number(),
  /** Çalışan sürüm (dağıtımın commit'i, APP_VERSION); dağıtım iş akışı yeni sürüm gelene kadar bekler. */
  version: z.string().nullable(),
});

/**
 * `/health/worker` uyarı kodları: eşiği aşan ölçümün makine tarafından okunan adı. Aynı ad `alert()` `kind`'ı olarak
 * da gider, yani runbook'ta (docs/17 §1.1) tek satırla izlenir.
 */
export const HEALTH_WARNINGS = ['backup_stale', 'disk_low', 'memory_high'] as const;
export type HealthWarning = (typeof HEALTH_WARNINGS)[number];

const workerHealthResponse = z.object({
  /** Hizmet verilebiliyor mu: yalnız db düştüyse, kuyruk geciktiyse ya da takılı iş varsa false (→ 503). */
  ok: z.boolean(),
  /** Eşik aşan bir ölçüm var mı (yedek/disk/bellek). true olsa bile durum kodu 200'dür: hizmet sürüyor. */
  degraded: z.boolean(),
  /** Aşılan eşiklerin kodları; `degraded` bu dizinin boş olmamasıdır. */
  warnings: z.array(z.enum(HEALTH_WARNINGS)),
  db: z.enum(['up', 'down']),
  /** Vadesi gelmiş en eski bekleyen işin gecikmesi (sn); kuyruk boşsa 0. */
  jobLagSec: z.number().int().nullable(),
  /** 10 dk'dan uzun süredir `running` kalan iş sayısı. */
  stuckJobs: z.number().int().nullable(),
  maxLagSec: z.number().int(),
  // ─── AYRINTILI ÖLÇÜMLER (yalnız `HEALTH_METRICS_TOKEN` başlığıyla) ────────────────────────────────────────
  // Hepsi `.optional()`: belirteçsiz yanıtta alan HİÇ BULUNMAZ. "Yok" ile "bilinmiyor" (`null`) bilerek
  // ayrıldı — `null` yazmak "ölçemedim" demektir ve nöbetçiyi yanlış yere bakmaya yollar.
  /**
   * Son başarılı yedeğin üzerinden geçen süre (sn); durum dosyasının `lastSuccessUnix` alanından. Dosya yoksa,
   * okunamazsa ya da hiç başarılı tur yoksa null — null uyarı üretmez.
   */
  lastBackupAgeSec: z.number().int().nullable().optional(),
  maxBackupAgeSec: z.number().int().optional(),
  /** İzlenen yoldaki boş disk oranı (%) ve boş alan (MiB); yol okunamazsa null. */
  diskFreePct: z.number().int().nullable().optional(),
  diskFreeMb: z.number().int().nullable().optional(),
  minDiskFreePct: z.number().int().optional(),
  /** Bu sürecin yığın kullanımının kendi tavanına oranı (%) ve yerleşik belleği (MiB). */
  memUsedPct: z.number().int().nullable().optional(),
  memRssMb: z.number().int().optional(),
  maxMemUsedPct: z.number().int().optional(),
  time: z.string(),
});

/**
 * Ayrıntılı ölçümleri isteyen tarafın göndereceği başlık. Küçük harf yazılır: Node/Fastify gelen başlık adlarını
 * küçük harfe indirir, yani `X-Health-Metrics-Token` de bu anahtarla okunur.
 */
export const HEALTH_METRICS_HEADER = 'x-health-metrics-token';

/**
 * Belirteç bu uzunluğun altındaysa KURULMAMIŞ sayılır (ayrıntılar gizli kalır). Uç kimlik doğrulamasız ve
 * herkese açıktır: 6 karakterlik bir belirteç kaba kuvvetle dakikalar içinde bulunur, yani kısa belirteç
 * korumayı açmaz, yalnız açıldığı YANILSAMASINI verir. Üretme: `openssl rand -hex 24` (48 karakter).
 * Kısa değer sessizce yutulmasın diye uç ilk yoklamada bir kez `log.warn` yazar.
 */
export const HEALTH_METRICS_TOKEN_MIN_LEN = 24;

/** Kenar boşlukları kırpılmış belirteç; kurulmamış ya da çok kısaysa null. */
function normalizeMetricsToken(token: string | undefined): string | null {
  const value = (token ?? '').trim();
  return value.length >= HEALTH_METRICS_TOKEN_MIN_LEN ? value : null;
}

/**
 * Ayrıntılı ölçümler bu yanıtta görünecek mi?
 *
 * KARAR (denetim 2026-10-05 bulgu A-2): **belirteç tanımlı değilse ayrıntılar GİZLENİR ve uç yine 200 döner.**
 *   - Neden gizlenir: ters karar ("belirteç yoksa herkese açık") açığı VARSAYILAN yapardı — kimse bir secret
 *     tanımlamayı hatırlamadığı sürece sızıntı sürer. Gizlemenin bedeli küçüktür: eşik aşımının haber yolu
 *     ayrıntı alanları DEĞİL, `warnings` + uyarı kanalıdır (`alert()`, lib/alert.ts) ve ikisi de açık kalır.
 *     Worker'ın yedek gözcüsü de kararını `warnings`'ten verir (deploy/cloudflare/src/alert.ts
 *     `yedekDurumunuOku`): belirteç yoksa uyarı gider, yalnız gövdesindeki iki sayı eksilir.
 *   - Neden 200, neden 401/503 değil: bu uç container healthcheck'i, dağıtımın duman testi ve dış izlemenin
 *     yokladığı yerdir. "İzleme kurulmamış" bir yapılandırma eksiği olabilir, ama sağlık ucunu kırmızı
 *     yakmak dağıtımı geri aldırır ve container'ı yeniden başlatır — dosya başındaki aynı tuzak.
 *
 * Karşılaştırma sabit süreli: belirteci karakter karakter tahmin etmeyi (zamanlama saldırısı) kapatır.
 */
export function metricsAllowed(presented: string | string[] | undefined, token: string | undefined): boolean {
  const expected = normalizeMetricsToken(token);
  if (expected === null) return false;
  // Başlık iki kez gönderilirse Node çoğu başlıkta değerleri birleştirir, bazılarında dizi verir: ilkini al.
  const raw = Array.isArray(presented) ? presented[0] : presented;
  if (typeof raw !== 'string') return false;
  const got = Buffer.from(raw.trim(), 'utf8');
  const want = Buffer.from(expected, 'utf8');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** scripts/worker-health.ts ile aynı eşik (WORKER_HEALTH_MAX_LAG_SEC varsayılanı). */
export const WORKER_MAX_LAG_SEC = 300;

/**
 * Yedek ve kaynak eşiklerinin varsayılanları (docs/15 §10). Her biri aynı adlı ortam değişkeniyle ezilir ve
 * **0 = o eşik kapalı** demektir: ölçüm yine yapılır (ve belirteçli yanıtta görünür), ama uyarı üretmez.
 */
export const HEALTH_LIMIT_DEFAULTS = {
  /** `HEALTH_MAX_BACKUP_AGE_SEC`: 120 sn'lik yedek turunun ~7 kez kaçırılması (docs/15 §8, §13). */
  maxBackupAgeSec: 900,
  /** `HEALTH_MIN_DISK_FREE_PCT`: deponun başka yerlerdeki eşiğiyle aynı (docs/15 §14.3 dağıtım kapısı, 06 §14.1 "Disk > %85 → P2"). */
  minDiskFreePct: 15,
  /** `HEALTH_MAX_MEM_USED_PCT`: yığının tavanına (V8 `heap_size_limit`) oranı; üstü OOM'a yakın. */
  maxMemUsedPct: 95,
} as const;

/**
 * Aynı uyarı kodu için iki `alert()` arasındaki en kısa süre. Bu uç dışarıdan **dakikada bir** yoklanır ve
 * `sendAlert` soğumadan ÖNCE log satırı yazar: burada dizginlemezsek düzelmeyen tek bir arıza günde ~1400
 * `log.error` satırı üretir. Eşik aşımı 30 dakikada bir haber verir.
 *
 * İKİ KATMAN VARDIR, ikisi de 30 dk: (1) buradaki `dueWarnings` — log satırını da dizginler, uyarı düzelince kodu
 * hafızadan siler; (2) `lib/alert.ts` `sendAlert`'in kendi soğuması (varsayılan 10 dk, `healthWarningAlert` bunu
 * `cooldownMs` ile aynı 30 dk'ya çeker) — yalnız **webhook** gönderimini dizginler ve düzelmeyle SIFIRLANMAZ.
 * Sonuç: eşik aşımı düzelip 30 dk içinde tekrarlarsa log satırı hemen yazılır, ama webhook o pencerenin sonunu
 * bekler. İstenen davranış "tekrarda hemen webhook" olursa `healthWarningAlert`'teki `cooldownMs` 0'a çekilir
 * (o zaman tek dizgin `dueWarnings` olur).
 */
export const HEALTH_ALERT_COOLDOWN_MS = 30 * 60_000;

/**
 * Yedek döngüsünün bıraktığı durum dosyası. Yolu yazan tarafla AYNI değişken belirler: `BACKUP_STATE_FILE`
 * (`deploy/cloudflare/entrypoint.sh` `backup_state_write`); `BACKUP_STATUS_FILE` yalnız geriye dönük addır.
 *
 * Sözleşme (yazan taraf: entrypoint.sh, aynı dosyayı yalnız o betik yazar) — tek satır JSON, atomik (mktemp + mv):
 * `{"lastSuccessUnix":1759600000,"lastAttemptUnix":…,"consecutiveFailures":0,"lastResult":"ok","note":"yuklendi",…}`
 *   - yaş **`lastSuccessUnix`**'ten hesaplanır: dosya her TURDA (hata turunda da) yazılır, ama `lastSuccessUnix`
 *     yalnız başarılı turda tazelenir — yani `pg_dump`/yükleme hatası yaşı büyütür ve eşiği aşınca uyarı olur;
 *     "değişiklik yok, yüklemedim" turu başarılıdır ve yaşı sıfırlar (yoksa siparişsiz bir gece yanlış alarm);
 *   - hiç başarılı tur olmamışsa yazan taraf `lastSuccessUnix: 0` yazar (taze açılış, `lastResult:"bos"`): yaş
 *     `null` sayılır, uyarı üretilmez;
 *   - container diski geçici olduğu için dosya her açılışta yoktur: o durumda da alan `null` döner ve uyarı
 *     üretilmez (ilk yedek turundan önce nöbetçi boşuna uyandırılmasın).
 */
export const BACKUP_STATE_FILE_DEFAULT = '/tmp/yedek-durum.json';

export interface HealthLimits {
  maxBackupAgeSec: number;
  minDiskFreePct: number;
  maxMemUsedPct: number;
}

/** Bilinmeyen (null) ya da eşiği kapalı (0) olan ölçümler uyarı üretmez. */
export interface HealthResources {
  lastBackupAgeSec: number | null;
  diskFreePct: number | null;
  diskFreeMb: number | null;
  memUsedPct: number | null;
  memRssMb: number;
}

type Env = Record<string, string | undefined>;

const MIB = 1024 * 1024;

/** Negatif olmayan tam sayı ortam değişkeni; yok/geçersizse varsayılan. */
function intEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

export function healthLimits(env: Env = process.env): HealthLimits {
  return {
    maxBackupAgeSec: intEnv(env.HEALTH_MAX_BACKUP_AGE_SEC, HEALTH_LIMIT_DEFAULTS.maxBackupAgeSec),
    minDiskFreePct: intEnv(env.HEALTH_MIN_DISK_FREE_PCT, HEALTH_LIMIT_DEFAULTS.minDiskFreePct),
    maxMemUsedPct: intEnv(env.HEALTH_MAX_MEM_USED_PCT, HEALTH_LIMIT_DEFAULTS.maxMemUsedPct),
  };
}

/**
 * Durum dosyasının içeriğinden son başarılı yedeğin yaşını (sn) çıkarır: `lastSuccessUnix` (yazan tarafın alanı),
 * yoksa `ts` (eski/VPS biçimi). Bozuk JSON, eksik ya da geçersiz alan → null (bilinmiyor; uyarı üretmez). Hiç
 * başarılı tur yoksa alan `0` gelir ve bu da null sayılır. İleri tarihli değer (saat sapması) 0'a kırpılır.
 */
export function backupAgeSecFrom(raw: string, nowMs: number = Date.now()): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const state = parsed as { lastSuccessUnix?: unknown; ts?: unknown } | null;
  const at = state?.lastSuccessUnix ?? state?.ts;
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return null;
  return Math.max(0, Math.round(nowMs / 1000 - at));
}

async function readBackupAgeSec(env: Env): Promise<number | null> {
  try {
    const path = env.BACKUP_STATE_FILE || env.BACKUP_STATUS_FILE || BACKUP_STATE_FILE_DEFAULT;
    return backupAgeSecFrom(await readFile(path, 'utf8'));
  } catch {
    // Dosya yok (ilk yedek turundan önce) ya da okunamadı: yedek yaşı bilinmiyor
    return null;
  }
}

/**
 * Disk ve bellek ölçümü, yalnız Node'un kendi API'leriyle (ek bağımlılık yok).
 * - Disk: `fs.statfs` izlenen yolda (`HEALTH_DISK_PATH`, varsayılan `UPLOAD_DIR` ya da `/data`). Yol yoksa
 *   (geliştirme makinesi) null döner.
 * - Bellek: `process.memoryUsage().heapUsed` / V8 `heap_size_limit` (= `--max-old-space-size`). Sürecin kendi OOM
 *   sınırına ne kadar yaklaştığını ölçer. cgroup'un `memory.current`'ı (`process.availableMemory()`) BİLEREK
 *   kullanılmıyor: sayfa önbelleğini de sayar, geri kazanılabilir önbellek dolu container'da sürekli yanlış alarm olur.
 */
async function readResources(env: Env): Promise<Omit<HealthResources, 'lastBackupAgeSec'>> {
  let diskFreePct: number | null = null;
  let diskFreeMb: number | null = null;
  try {
    const fs = await statfs(env.HEALTH_DISK_PATH || env.UPLOAD_DIR || '/data');
    const total = Number(fs.blocks) * Number(fs.bsize);
    const free = Number(fs.bavail) * Number(fs.bsize);
    if (total > 0 && free >= 0) {
      diskFreePct = Math.round((free / total) * 100);
      diskFreeMb = Math.round(free / MIB);
    }
  } catch {
    // Yol okunamadı: disk durumu bilinmiyor
  }
  const { rss, heapUsed } = process.memoryUsage();
  const heapLimit = getHeapStatistics().heap_size_limit;
  return {
    diskFreePct,
    diskFreeMb,
    memUsedPct: heapLimit > 0 ? Math.round((heapUsed / heapLimit) * 100) : null,
    memRssMb: Math.round(rss / MIB),
  };
}

/**
 * Eşiği aşan ölçümlerin kodları. Bilinmeyen (null) ölçüm ve kapalı (0) eşik uyarı üretmez. Dönen dizi BOŞSA
 * `degraded:false`'tur. Bu işlev hizmet durumunu (`ok`) HİÇ etkilemez: 503 kararı yalnız db + kuyruktandır.
 */
export function resourceWarnings(r: HealthResources, limits: HealthLimits): HealthWarning[] {
  const out: HealthWarning[] = [];
  if (limits.maxBackupAgeSec > 0 && r.lastBackupAgeSec !== null && r.lastBackupAgeSec > limits.maxBackupAgeSec) out.push('backup_stale');
  if (limits.minDiskFreePct > 0 && r.diskFreePct !== null && r.diskFreePct < limits.minDiskFreePct) out.push('disk_low');
  if (limits.maxMemUsedPct > 0 && r.memUsedPct !== null && r.memUsedPct > limits.maxMemUsedPct) out.push('memory_high');
  return out;
}

/**
 * Uyarı kodunun ağırlığı. Yedek zinciri kopması ve OOM'a giden bellek geri alınamaz veri kaybı riskidir (critical);
 * azalan disk hâlâ zaman tanır (warning, 06 §14.1 "Disk > %85 → P2").
 */
const WARNING_SEVERITY: Record<HealthWarning, AlertSeverity> = {
  backup_stale: 'critical',
  disk_low: 'warning',
  memory_high: 'critical',
};

/**
 * Uyarı kodunu `alert()` gövdesine çevirir. Kişisel veri yoktur: yalnız ölçüm, eşik ve runbook atfı
 * (CLAUDE.md kural 7).
 */
export function healthWarningAlert(code: HealthWarning, r: HealthResources, limits: HealthLimits): AlertInput {
  const base = { kind: code, severity: WARNING_SEVERITY[code], dedupeKey: code, cooldownMs: HEALTH_ALERT_COOLDOWN_MS };
  if (code === 'backup_stale') {
    return {
      ...base,
      message: `Son başarılı veritabanı yedeği ${r.lastBackupAgeSec} sn önce alındı (eşik ${limits.maxBackupAgeSec} sn): yedek zinciri kopmuş olabilir, canlı veri yalnız geçici container diskinde. docs/17 §2.2`,
      data: { lastBackupAgeSec: r.lastBackupAgeSec, maxBackupAgeSec: limits.maxBackupAgeSec },
    };
  }
  if (code === 'disk_low') {
    return {
      ...base,
      message: `Boş disk %${r.diskFreePct} (${r.diskFreeMb} MiB; eşik %${limits.minDiskFreePct}): veritabanı ve görseller aynı diski paylaşıyor. docs/17 §2.6`,
      data: { diskFreePct: r.diskFreePct, diskFreeMb: r.diskFreeMb, minDiskFreePct: limits.minDiskFreePct },
    };
  }
  return {
    ...base,
    message: `API sürecinin yığın kullanımı %${r.memUsedPct} (RSS ${r.memRssMb} MiB; eşik %${limits.maxMemUsedPct}): OOM'a yakın, süreç ölürse işler yarıda kalır. docs/17 §2.6`,
    data: { memUsedPct: r.memUsedPct, memRssMb: r.memRssMb, maxMemUsedPct: limits.maxMemUsedPct },
  };
}

/** Uyarı kodu başına son `alert()` anı. Süreç belleğindedir: yeniden başlatma dizgini sıfırlar (zararsız). */
const warnedAt = new Map<string, number>();

/**
 * "HEALTH_METRICS_TOKEN çok kısa" satırı süreç ömründe BİR KEZ yazılır: bu uç dakikada bir yoklanır, her turda
 * yazmak günde ~1400 satır eder (aynı gerekçe `HEALTH_ALERT_COOLDOWN_MS`'te).
 */
let shortMetricsTokenWarned = false;

/** Testler için dizgin belleğini boşaltır (uç testleri birbirinin soğumasını miras almasın). */
export function resetHealthWarningCooldown(): void {
  warnedAt.clear();
  shortMetricsTokenWarned = false;
}

/**
 * Soğumayı geçen, yani gerçekten `alert()`'e verilecek uyarı kodlarını seçer ve `seen`'i günceller. Artık
 * görülmeyen kod hafızadan SİLİNİR: arıza düzelip tekrarlarsa bu katman dizgin uygulamaz (log satırı hemen yazılır).
 * Webhook gönderimi `sendAlert`'in kendi soğumasına da tabidir ve O düzelmeyle sıfırlanmaz — bkz.
 * `HEALTH_ALERT_COOLDOWN_MS` açıklaması.
 */
export function dueWarnings(
  warnings: readonly HealthWarning[],
  seen: Map<string, number>,
  nowMs: number,
  cooldownMs: number = HEALTH_ALERT_COOLDOWN_MS,
): HealthWarning[] {
  for (const code of [...seen.keys()]) {
    if (!warnings.includes(code as HealthWarning)) seen.delete(code);
  }
  const due: HealthWarning[] = [];
  for (const code of warnings) {
    const prev = seen.get(code);
    if (cooldownMs > 0 && prev !== undefined && nowMs - prev < cooldownMs) continue;
    seen.set(code, nowMs);
    due.push(code);
  }
  return due;
}

const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/health', { schema: { response: { 200: healthResponse, 503: healthResponse } } }, async (_request, reply) => {
    let db: 'up' | 'down' = 'up';
    try {
      await app.db.execute(sql`select 1`);
    } catch {
      db = 'down';
    }
    const body = {
      ok: db === 'up',
      db,
      time: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      version: process.env.APP_VERSION || null,
    };
    return reply.status(db === 'up' ? 200 : 503).send(body);
  });

  app.get('/health/worker', { schema: { response: { 200: workerHealthResponse, 503: workerHealthResponse } } }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    let lag: number | null = null;
    let stuck: number | null = null;
    let db: 'up' | 'down' = 'up';
    try {
      const rows = (await app.db.execute<{ lag: number | null; stuck: number }>(sql`
        select
          coalesce(extract(epoch from (now() - min(run_at) filter (where status = 'pending' and run_at <= now())))::int, 0) as lag,
          count(*) filter (where status = 'running' and locked_at < now() - interval '10 minutes')::int as stuck
        from jobs
        where status in ('pending', 'running')`)) as unknown as { lag: number | null; stuck: number }[];
      lag = Number(rows[0]?.lag ?? 0);
      stuck = Number(rows[0]?.stuck ?? 0);
    } catch {
      db = 'down';
    }
    // Eşikler her istekte ortamdan okunur: operatör bir eşiği kodu değiştirmeden (0 = kapalı) devre dışı bırakabilir.
    const limits = healthLimits();
    const [lastBackupAgeSec, usage] = await Promise.all([readBackupAgeSec(process.env), readResources(process.env)]);
    const resources: HealthResources = { lastBackupAgeSec, ...usage };
    const warnings = resourceWarnings(resources, limits);
    // `ok` YALNIZ hizmet verilemiyorsa false: veritabanı düştü, kuyruk gecikti ya da iş takıldı. Yedek/disk/bellek
    // eşikleri buraya GİRMEZ (dosya başındaki gerekçe: duman testi bu uca bakıyor ve kırmızısı geri alma tetikliyor).
    const ok = db === 'up' && lag !== null && lag <= WORKER_MAX_LAG_SEC && stuck === 0;
    // Ayrıntılı ölçümler kime görünür: belirteç kurulu değilse KİMSEYE, kuruluysa yalnız doğru belirteci taşıyan
    // isteğe (gerekçe `metricsAllowed` açıklamasında). Ölçüm her turda YAPILIR — `alert()` ve `warnings` ondan
    // beslenir; gizlenen şey yalnız yanıta yazılması.
    const metricsToken = process.env.HEALTH_METRICS_TOKEN;
    const detailed = metricsAllowed(request.headers[HEALTH_METRICS_HEADER], metricsToken);
    // Değer verilmiş ama eşiğin altında: korumanın açıldığı sanılmasın diye bir kez haber ver.
    if (!shortMetricsTokenWarned && (metricsToken ?? '').trim() !== '' && normalizeMetricsToken(metricsToken) === null) {
      shortMetricsTokenWarned = true;
      app.log.warn(
        `HEALTH_METRICS_TOKEN ${HEALTH_METRICS_TOKEN_MIN_LEN} karakterden kısa: kurulmamış sayıldı, /health/worker ayrıntılı ölçümleri gizli kalıyor (docs/15 §10)`,
      );
    }
    const body = {
      ok,
      degraded: warnings.length > 0,
      warnings,
      db,
      jobLagSec: lag,
      stuckJobs: stuck,
      maxLagSec: WORKER_MAX_LAG_SEC,
      ...(detailed
        ? {
            lastBackupAgeSec: resources.lastBackupAgeSec,
            maxBackupAgeSec: limits.maxBackupAgeSec,
            diskFreePct: resources.diskFreePct,
            diskFreeMb: resources.diskFreeMb,
            minDiskFreePct: limits.minDiskFreePct,
            memUsedPct: resources.memUsedPct,
            memRssMb: resources.memRssMb,
            maxMemUsedPct: limits.maxMemUsedPct,
          }
        : {}),
      time: new Date().toISOString(),
    };
    // Eşik aşımının tek haber yolu budur (durum kodu 200 kaldığı için dış izleme görmez). `alert()` ateşle-ve-unut:
    // yanıtı bekletmez, hata atmaz; kanal yoksa yalnız log satırı kalır.
    for (const code of dueWarnings(warnings, warnedAt, Date.now())) {
      alert({ log: app.log, config: app.config }, healthWarningAlert(code, resources, limits));
    }
    return reply.status(ok ? 200 : 503).send(body);
  });
};

export default healthRoutes;
