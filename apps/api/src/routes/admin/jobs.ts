// İşler ve DLQ (05 A-11): GET /admin/jobs?status=failed|pending&queue=, POST /admin/jobs/:id/retry.

import { adminJobSchema, adminJobsQuerySchema, adminJobsResponseSchema, type AdminJob } from '@siparis/core/admin/contracts';
import type { JobStatus } from '@siparis/core';
import { jobs, tenants } from '@siparis/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { conflict, notFound } from '../../lib/errors';
import { adminActor, adminAudit, cursorOrder, cursorWhere, decodeCursor, iso, isoOrNull, maskPayload, paginate, requireAdmin, rows } from '../../services/admin/util';

type JobRow = typeof jobs.$inferSelect;

function toAdminJob(j: JobRow, tenantName: string | null): AdminJob {
  return {
    id: j.id,
    queue: j.queue,
    type: j.type,
    status: j.status,
    attempts: j.attempts,
    maxAttempts: j.maxAttempts,
    runAt: iso(j.runAt),
    lastError: j.lastError ? j.lastError.slice(0, 2000) : null,
    tenantId: j.tenantId ?? null,
    tenantName,
    dedupeKey: j.dedupeKey ?? null,
    payload: (maskPayload(j.payload ?? {}) ?? {}) as Record<string, unknown>,
    createdAt: iso(j.createdAt),
    updatedAt: iso(j.updatedAt),
    finishedAt: isoOrNull(j.finishedAt),
  };
}

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/jobs',
    { preHandler: requireAdmin('jobs:read'), schema: { querystring: adminJobsQuerySchema, response: { 200: adminJobsResponseSchema } } },
    async (request) => {
      const { status, queue, type } = request.query;
      const limit = request.query.limit ?? 50;
      const cursor = decodeCursor(request.query.cursor);
      const conds = [eq(jobs.status, status as JobStatus)];
      if (queue) conds.push(eq(jobs.queue, queue));
      if (type) conds.push(eq(jobs.type, type));
      if (cursor) conds.push(cursorWhere(jobs.updatedAt, jobs.id, cursor));
      const list = await app.db
        .select({ j: jobs, tenantName: tenants.name })
        .from(jobs)
        .leftJoin(tenants, eq(tenants.id, jobs.tenantId))
        .where(and(...conds))
        .orderBy(...cursorOrder(jobs.updatedAt, jobs.id))
        .limit(limit + 1);
      const [counts] = await rows<{ pending: number; running: number; failed: number }>(
        app.db,
        sql`select count(*) filter (where status = 'pending')::int as pending,
                   count(*) filter (where status = 'running')::int as running,
                   count(*) filter (where status = 'failed')::int as failed
              from jobs where status in ('pending', 'running', 'failed')`,
      );
      const page = paginate(
        list.map((r) => toAdminJob(r.j, r.tenantName ?? null)),
        limit,
        (j) => ({ at: j.updatedAt, id: j.id }),
      );
      return {
        ...page,
        counts: { pending: Number(counts?.pending ?? 0), running: Number(counts?.running ?? 0), failed: Number(counts?.failed ?? 0) },
      };
    },
  );

  // Başarısız işi yeniden kuyruğa al: failed → pending, deneme sayısı sıfır. İkinci çağrı 409 (yan etki tekrarlanmaz).
  app.post(
    '/jobs/:id/retry',
    {
      preHandler: requireAdmin('jobs:retry'),
      schema: { params: z.object({ id: z.uuid() }), response: { 200: adminJobSchema } },
    },
    async (request) => {
      const actor = adminActor(request);
      const id = request.params.id;
      const job = await app.db.transaction(async (tx) => {
        const [before] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
        if (!before) throw notFound('İş bulunamadı.');
        if (before.status !== 'failed') {
          throw conflict('job_not_failed', 'Yalnız başarısız işler yeniden denenebilir.', { status: before.status });
        }
        const [after] = await tx
          .update(jobs)
          .set({
            status: 'pending',
            attempts: 0,
            runAt: sql`now()`,
            lockedAt: null,
            lockedBy: null,
            finishedAt: null,
          })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'failed')))
          .returning();
        await adminAudit(tx, actor, {
          tenantId: before.tenantId ?? null,
          action: 'admin.job_retry',
          entityType: 'job',
          entityId: id,
          data: {
            queue: before.queue,
            type: before.type,
            previousAttempts: before.attempts,
            lastError: before.lastError ? before.lastError.slice(0, 500) : null,
          },
        });
        return after!;
      });
      let tenantName: string | null = null;
      if (job.tenantId) {
        const [t] = await app.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, job.tenantId));
        tenantName = t?.name ?? null;
      }
      return toAdminJob(job, tenantName);
    },
  );
};

export default routes;
