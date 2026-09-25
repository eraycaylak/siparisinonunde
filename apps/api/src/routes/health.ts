// GET /api/v1/health — süreç ve veritabanı durumu (Docker sağlık denetimi).
// GET /api/v1/health/worker — arka plan işlerinin gecikmesi; dış izleme (Uptime Kuma vb.) bunu da izler: worker
// takılırsa (süreç ayakta olsa bile) 503 döner ve nöbetçiye bildirim gider (sipariş kaçmaz: alarm zinciri işlerde).

import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthResponse = z.object({
  ok: z.boolean(),
  db: z.enum(['up', 'down']),
  time: z.string(),
  uptimeSec: z.number(),
});

const workerHealthResponse = z.object({
  ok: z.boolean(),
  db: z.enum(['up', 'down']),
  /** Vadesi gelmiş en eski bekleyen işin gecikmesi (sn); kuyruk boşsa 0. */
  jobLagSec: z.number().int().nullable(),
  /** 10 dk'dan uzun süredir `running` kalan iş sayısı. */
  stuckJobs: z.number().int().nullable(),
  maxLagSec: z.number().int(),
  time: z.string(),
});

/** scripts/worker-health.ts ile aynı eşik (WORKER_HEALTH_MAX_LAG_SEC varsayılanı). */
export const WORKER_MAX_LAG_SEC = 300;

const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/health', { schema: { response: { 200: healthResponse, 503: healthResponse } } }, async (_request, reply) => {
    let db: 'up' | 'down' = 'up';
    try {
      await app.db.execute(sql`select 1`);
    } catch {
      db = 'down';
    }
    const body = { ok: db === 'up', db, time: new Date().toISOString(), uptimeSec: Math.round(process.uptime()) };
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
    const ok = db === 'up' && lag !== null && lag <= WORKER_MAX_LAG_SEC && stuck === 0;
    const body = { ok, db, jobLagSec: lag, stuckJobs: stuck, maxLagSec: WORKER_MAX_LAG_SEC, time: new Date().toISOString() };
    return reply.status(ok ? 200 : 503).send(body);
  });
};

export default healthRoutes;
