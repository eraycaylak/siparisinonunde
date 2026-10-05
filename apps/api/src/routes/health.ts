// GET /api/v1/health — süreç ve veritabanı durumu (Docker sağlık denetimi).
// GET /api/v1/health/worker — arka plan işlerinin gecikmesi + son yedeğin yaşı + disk/bellek baskısı; dış izleme
// (Uptime Kuma vb.) bunu izler: worker takılırsa (süreç ayakta olsa bile), son başarılı yedek çok eskiyse ya da
// disk/bellek eşiği aşılmışsa 503 döner ve nöbetçiye bildirim gider (sipariş kaçmaz: alarm zinciri işlerdedir).
//
// Yedek ve kaynak eşikleri neden `/health`'te DEĞİL (denetim 2026-10-04 madde 1.5 ve H23): `/api/v1/health` üç yerin
// canlılık probudur — docker-compose `api` healthcheck'i, Worker'ın uyanık tutma cron'u (deploy/cloudflare/src/index.ts)
// ve dağıtımın duman testi (sürüm kapısı). Orada 503 dönmek container'ı yeniden başlatır (beklenmedik çökme son
// yedekten sonraki ~2 dakikayı kaybettirir) ve dağıtımı bloke eder; "disk doluyor" gibi bir durumda yeniden başlatma
// döngüsü sorunu büyütür. Bu yüzden yeni alanlar ve eşikler yalnız dış izlemenin ucunda (`/health/worker`) alarm
// üretir; `/health`'in alanları ve anlamları DEĞİŞMEDİ (duman testi onlara bakıyor).

import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { readFile, statfs } from 'node:fs/promises';
import { getHeapStatistics } from 'node:v8';
import { z } from 'zod';

const healthResponse = z.object({
  ok: z.boolean(),
  db: z.enum(['up', 'down']),
  time: z.string(),
  uptimeSec: z.number(),
  /** Çalışan sürüm (dağıtımın commit'i, APP_VERSION); dağıtım iş akışı yeni sürüm gelene kadar bekler. */
  version: z.string().nullable(),
});

const workerHealthResponse = z.object({
  ok: z.boolean(),
  db: z.enum(['up', 'down']),
  /** Vadesi gelmiş en eski bekleyen işin gecikmesi (sn); kuyruk boşsa 0. */
  jobLagSec: z.number().int().nullable(),
  /** 10 dk'dan uzun süredir `running` kalan iş sayısı. */
  stuckJobs: z.number().int().nullable(),
  maxLagSec: z.number().int(),
  /**
   * Son başarılı yedeğin üzerinden geçen süre (sn); durum dosyasının `lastSuccessUnix` alanından. Dosya yoksa,
   * okunamazsa ya da hiç başarılı tur yoksa null — null alarm üretmez.
   */
  lastBackupAgeSec: z.number().int().nullable(),
  maxBackupAgeSec: z.number().int(),
  /** İzlenen yoldaki boş disk oranı (%) ve boş alan (MiB); yol okunamazsa null. */
  diskFreePct: z.number().int().nullable(),
  diskFreeMb: z.number().int().nullable(),
  minDiskFreePct: z.number().int(),
  /** Bu sürecin yığın kullanımının kendi tavanına oranı (%) ve yerleşik belleği (MiB). */
  memUsedPct: z.number().int().nullable(),
  memRssMb: z.number().int(),
  maxMemUsedPct: z.number().int(),
  time: z.string(),
});

/** scripts/worker-health.ts ile aynı eşik (WORKER_HEALTH_MAX_LAG_SEC varsayılanı). */
export const WORKER_MAX_LAG_SEC = 300;

/**
 * Yedek ve kaynak eşiklerinin varsayılanları (docs/15 §10). Her biri aynı adlı ortam değişkeniyle ezilir ve
 * **0 = o eşik kapalı** demektir: alan yine raporlanır, ama alarm (503) üretmez.
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
 * Yedek döngüsünün bıraktığı durum dosyası. Yolu yazan tarafla AYNI değişken belirler: `BACKUP_STATE_FILE`
 * (`deploy/cloudflare/entrypoint.sh` `backup_state_write`); `BACKUP_STATUS_FILE` yalnız geriye dönük addır.
 *
 * Sözleşme (yazan taraf: entrypoint.sh, aynı dosyayı yalnız o betik yazar) — tek satır JSON, atomik (mktemp + mv):
 * `{"lastSuccessUnix":1759600000,"lastAttemptUnix":…,"consecutiveFailures":0,"lastResult":"ok","note":"yuklendi",…}`
 *   - yaş **`lastSuccessUnix`**'ten hesaplanır: dosya her TURDA (hata turunda da) yazılır, ama `lastSuccessUnix`
 *     yalnız başarılı turda tazelenir — yani `pg_dump`/yükleme hatası yaşı büyütür ve eşiği aşınca alarm olur;
 *     "değişiklik yok, yüklemedim" turu başarılıdır ve yaşı sıfırlar (yoksa siparişsiz bir gece yanlış alarm);
 *   - hiç başarılı tur olmamışsa yazan taraf `lastSuccessUnix: 0` yazar (taze açılış, `lastResult:"bos"`): yaş
 *     `null` sayılır, alarm üretilmez;
 *   - container diski geçici olduğu için dosya her açılışta yoktur: o durumda da alan `null` döner ve 503 verilmez
 *     (dağıtım duman testi ilk yedek turundan önce kırmızıya düşmesin).
 */
export const BACKUP_STATE_FILE_DEFAULT = '/tmp/yedek-durum.json';

export interface HealthLimits {
  maxBackupAgeSec: number;
  minDiskFreePct: number;
  maxMemUsedPct: number;
}

/** Bilinmeyen (null) ya da eşiği kapalı (0) olan ölçümler alarm üretmez. */
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
 * yoksa `ts` (eski/VPS biçimi). Bozuk JSON, eksik ya da geçersiz alan → null (bilinmiyor; alarm üretmez). Hiç
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

/** Yedek yaşı ve kaynak ölçümleri eşiklerin içinde mi? Bilinmeyen (null) ve kapalı (0) eşik alarm üretmez. */
export function resourcesWithinLimits(r: HealthResources, limits: HealthLimits): boolean {
  if (limits.maxBackupAgeSec > 0 && r.lastBackupAgeSec !== null && r.lastBackupAgeSec > limits.maxBackupAgeSec) return false;
  if (limits.minDiskFreePct > 0 && r.diskFreePct !== null && r.diskFreePct < limits.minDiskFreePct) return false;
  if (limits.maxMemUsedPct > 0 && r.memUsedPct !== null && r.memUsedPct > limits.maxMemUsedPct) return false;
  return true;
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

  app.get('/health/worker', { schema: { response: { 200: workerHealthResponse, 503: workerHealthResponse } } }, async (_request, reply) => {
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
    const ok = db === 'up' && lag !== null && lag <= WORKER_MAX_LAG_SEC && stuck === 0 && resourcesWithinLimits(resources, limits);
    const body = {
      ok,
      db,
      jobLagSec: lag,
      stuckJobs: stuck,
      maxLagSec: WORKER_MAX_LAG_SEC,
      lastBackupAgeSec: resources.lastBackupAgeSec,
      maxBackupAgeSec: limits.maxBackupAgeSec,
      diskFreePct: resources.diskFreePct,
      diskFreeMb: resources.diskFreeMb,
      minDiskFreePct: limits.minDiskFreePct,
      memUsedPct: resources.memUsedPct,
      memRssMb: resources.memRssMb,
      maxMemUsedPct: limits.maxMemUsedPct,
      time: new Date().toISOString(),
    };
    return reply.status(ok ? 200 : 503).send(body);
  });
};

export default healthRoutes;
