// GET /api/v1/health — süreç ve veritabanı durumu.

import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthResponse = z.object({
  ok: z.boolean(),
  db: z.enum(['up', 'down']),
  time: z.string(),
  uptimeSec: z.number(),
});

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
};

export default healthRoutes;
