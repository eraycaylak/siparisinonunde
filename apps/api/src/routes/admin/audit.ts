// Denetim kaydı (05 A-18): GET /admin/audit?tenantId=&actor=&action=&cursor=.
// PO/PA tümü; SA yalnız kendi kayıtları; F yalnız finans (abonelik) kayıtları; SR erişemez.

import { adminAuditQuerySchema, adminAuditResponseSchema, type AdminAuditEntry } from '@siparis/core/admin/contracts';
import { auditLog, tenants, users } from '@siparis/db';
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { adminActor, cursorOrder, cursorWhere, decodeCursor, iso, maskPayload, paginate, requireAdmin } from '../../services/admin/util';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/audit',
    { preHandler: requireAdmin('audit:read'), schema: { querystring: adminAuditQuerySchema, response: { 200: adminAuditResponseSchema } } },
    async (request) => {
      const viewer = adminActor(request);
      const { tenantId, actor, action, impersonation } = request.query;
      const limit = request.query.limit ?? 50;
      const cursor = decodeCursor(request.query.cursor);
      const actorUser = alias(users, 'actor_user');
      const impUser = alias(users, 'imp_user');

      const conds: SQL[] = [];
      if (viewer.role === 'support_agent') {
        conds.push(or(eq(auditLog.actorUserId, viewer.userId), eq(auditLog.impersonatorUserId, viewer.userId))!);
      } else if (viewer.role === 'finance') {
        conds.push(sql`(${auditLog.entityType} = 'subscription' or ${auditLog.action} like 'subscription.%' or ${auditLog.action} like 'admin.subscription%')`);
      }
      if (tenantId) conds.push(eq(auditLog.tenantId, tenantId));
      if (actor) {
        if (UUID_RE.test(actor)) {
          conds.push(or(eq(auditLog.actorUserId, actor), eq(auditLog.impersonatorUserId, actor))!);
        } else if (actor.includes('@')) {
          conds.push(sql`${actorUser.email} = ${actor.toLowerCase()}`);
        } else {
          conds.push(sql`${actorUser.name} ilike ${`%${actor.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`);
        }
      }
      if (action) conds.push(sql`${auditLog.action} like ${`${action.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`);
      if (impersonation) conds.push(sql`${auditLog.impersonatorUserId} is not null`);
      if (cursor) conds.push(cursorWhere(auditLog.createdAt, auditLog.id, cursor));

      const list = await app.db
        .select({
          a: auditLog,
          tenantName: tenants.name,
          actorName: actorUser.name,
          actorEmail: actorUser.email,
          impersonatorName: impUser.name,
        })
        .from(auditLog)
        .leftJoin(tenants, eq(tenants.id, auditLog.tenantId))
        .leftJoin(actorUser, eq(actorUser.id, auditLog.actorUserId))
        .leftJoin(impUser, eq(impUser.id, auditLog.impersonatorUserId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(...cursorOrder(auditLog.createdAt, auditLog.id))
        .limit(limit + 1);

      const items: AdminAuditEntry[] = list.map((r) => ({
        id: r.a.id,
        createdAt: iso(r.a.createdAt),
        action: r.a.action,
        entityType: r.a.entityType ?? null,
        entityId: r.a.entityId ?? null,
        tenantId: r.a.tenantId ?? null,
        tenantName: r.tenantName ?? null,
        actorUserId: r.a.actorUserId ?? null,
        actorName: r.actorName ?? null,
        actorEmail: r.actorEmail ?? null,
        impersonatorUserId: r.a.impersonatorUserId ?? null,
        impersonatorName: r.impersonatorName ?? null,
        data: r.a.data ? (maskPayload(r.a.data) as Record<string, unknown>) : null,
        ip: r.a.ip ?? null,
      }));
      return paginate(items, limit, (e) => ({ at: e.createdAt, id: e.id }));
    },
  );
};

export default routes;
