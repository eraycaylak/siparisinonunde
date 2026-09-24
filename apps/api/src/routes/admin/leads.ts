// Lead yönetimi (05 A-20): GET /admin/leads, PATCH /admin/leads/:id {status, notes}.

import { adminLeadPatchSchema, adminLeadSchema, adminLeadsQuerySchema, adminLeadsResponseSchema, type AdminLead } from '@siparis/core/admin/contracts';
import { LEAD_STATUSES, normalizePhone, type LeadStatus } from '@siparis/core';
import { leads, tenants, type Database } from '@siparis/db';
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, notFound } from '../../lib/errors';
import { adminActor, adminAudit, cursorOrder, cursorWhere, decodeCursor, iso, paginate, requireAdmin, rows } from '../../services/admin/util';

type LeadRow = typeof leads.$inferSelect;

function toAdminLead(l: LeadRow, tenantName: string | null): AdminLead {
  return {
    id: l.id,
    name: l.name ?? null,
    businessName: l.businessName ?? null,
    phone: l.phone ?? null,
    email: l.email ?? null,
    city: l.city ?? null,
    source: l.source,
    status: l.status,
    notes: l.notes ?? null,
    calculatorInput: (l.calculatorInput as Record<string, unknown> | null) ?? null,
    tenantId: l.tenantId ?? null,
    tenantName,
    createdAt: iso(l.createdAt),
    updatedAt: iso(l.updatedAt),
  };
}

async function loadLead(db: Database, id: string): Promise<AdminLead | null> {
  const [r] = await db
    .select({ l: leads, tenantName: tenants.name })
    .from(leads)
    .leftJoin(tenants, eq(tenants.id, leads.tenantId))
    .where(eq(leads.id, id));
  return r ? toAdminLead(r.l, r.tenantName ?? null) : null;
}

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/leads',
    { preHandler: requireAdmin('leads:read'), schema: { querystring: adminLeadsQuerySchema, response: { 200: adminLeadsResponseSchema } } },
    async (request) => {
      const { status, source, q } = request.query;
      const limit = request.query.limit ?? 50;
      const cursor = decodeCursor(request.query.cursor);
      const conds: SQL[] = [];
      if (status) conds.push(eq(leads.status, status));
      if (source) conds.push(eq(leads.source, source));
      if (q) {
        const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
        const phone = normalizePhone(q);
        const parts: SQL[] = [
          sql`${leads.name} ilike ${like}`,
          sql`${leads.businessName} ilike ${like}`,
          sql`${leads.city} ilike ${like}`,
        ];
        if (phone) parts.push(eq(leads.phone, phone));
        conds.push(or(...parts)!);
      }
      if (cursor) conds.push(cursorWhere(leads.createdAt, leads.id, cursor));
      const list = await app.db
        .select({ l: leads, tenantName: tenants.name })
        .from(leads)
        .leftJoin(tenants, eq(tenants.id, leads.tenantId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(...cursorOrder(leads.createdAt, leads.id))
        .limit(limit + 1);
      const countRows = await rows<{ status: LeadStatus; n: number }>(
        app.db,
        sql`select status, count(*)::int as n from leads group by status`,
      );
      const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
      for (const c of countRows) counts[c.status] = Number(c.n);
      const page = paginate(
        list.map((r) => toAdminLead(r.l, r.tenantName ?? null)),
        limit,
        (l) => ({ at: l.createdAt, id: l.id }),
      );
      return { ...page, counts };
    },
  );

  app.patch(
    '/leads/:id',
    {
      preHandler: requireAdmin('leads:write'),
      schema: { params: z.object({ id: z.uuid() }), body: adminLeadPatchSchema, response: { 200: adminLeadSchema } },
    },
    async (request) => {
      const actor = adminActor(request);
      const id = request.params.id;
      const body = request.body;
      await app.db.transaction(async (tx) => {
        const [before] = await tx.select().from(leads).where(eq(leads.id, id)).for('update');
        if (!before) throw notFound('Lead bulunamadı.');
        const patch: Partial<typeof leads.$inferInsert> = {};
        const changes: Record<string, { from: unknown; to: unknown }> = {};

        let tenantId = before.tenantId ?? null;
        if (body.tenantSlug) {
          const [t] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, body.tenantSlug.toLowerCase()));
          if (!t) {
            throw new AppError(404, 'tenant_not_found', 'Bu adla bir işletme bulunamadı.', {
              issues: [{ path: '/tenantSlug', message: 'Bu adla bir işletme bulunamadı.' }],
            });
          }
          tenantId = t.id;
        } else if (body.tenantId !== undefined) {
          if (body.tenantId) {
            const [t] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, body.tenantId));
            if (!t) throw new AppError(404, 'tenant_not_found', 'İşletme bulunamadı.');
          }
          tenantId = body.tenantId;
        }
        if (tenantId !== (before.tenantId ?? null)) {
          patch.tenantId = tenantId;
          changes.tenantId = { from: before.tenantId ?? null, to: tenantId };
        }
        if (body.status !== undefined && body.status !== before.status) {
          patch.status = body.status;
          changes.status = { from: before.status, to: body.status };
        }
        const finalStatus = body.status ?? before.status;
        if (finalStatus === 'won' && !tenantId) {
          throw new AppError(400, 'tenant_required', '"Kazanıldı" için lead bir işletmeye bağlanmalı.', {
            issues: [{ path: '/tenantSlug', message: 'İşletmenin adresini (slug) yazın.' }],
          });
        }
        if (body.notes !== undefined && (body.notes || null) !== (before.notes ?? null)) {
          patch.notes = body.notes || null;
          changes.notes = { from: before.notes ? '[önceki not]' : null, to: body.notes ? '[yeni not]' : null };
        }
        if (!Object.keys(patch).length) return;
        await tx.update(leads).set(patch).where(eq(leads.id, id));
        await adminAudit(tx, actor, {
          tenantId: tenantId,
          action: 'admin.lead_update',
          entityType: 'lead',
          entityId: id,
          data: { changes },
        });
      });
      const lead = await loadLead(app.db, id);
      if (!lead) throw notFound('Lead bulunamadı.');
      return lead;
    },
  );
};

export default routes;
