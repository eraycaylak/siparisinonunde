// Panel personel ve kuryeler (14 §6.3 Personel) — dilim 4. Yetki: owner/manager (manager owner'a dokunamaz);
// kurye listesi cashier dahil (04 §2.3 P-24 ◐ liste).

import type { TenantRole } from '@siparis/core';
import {
  courierDtoSchema,
  courierLoginLinkResponseSchema,
  staffCreateSchema,
  staffDtoSchema,
  staffPatchSchema,
} from '@siparis/core/settings/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit, auditActor } from '../../lib/audit';
import { requireTenantRole, tenantAuth } from '../../plugins/auth';
import { createCourierLoginLink, createStaff, listCouriers, listStaff, logoutCourier, patchStaff, removeStaff } from '../../services/staff/index';

const OM: readonly TenantRole[] = ['owner', 'manager'];
const OMC: readonly TenantRole[] = ['owner', 'manager', 'cashier'];
const userParams = z.object({ userId: z.uuid() });

const staffRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/staff', { preValidation: requireTenantRole(OM), schema: { response: { 200: z.object({ items: z.array(staffDtoSchema) }) } } }, async (request) => {
    const auth = tenantAuth(request);
    return { items: await listStaff(app.db, auth) };
  });

  app.post(
    '/staff',
    { preValidation: requireTenantRole(OM), schema: { body: staffCreateSchema, response: { 201: z.object({ staff: staffDtoSchema, existingUser: z.boolean() }) } } },
    async (request, reply) => {
      const auth = tenantAuth(request);
      const result = await app.db.transaction(async (tx) => {
        const r = await createStaff(tx, auth, request.body);
        await audit(tx, {
          ...auditActor(request),
          action: 'staff.create',
          entityType: 'user',
          entityId: r.staff.userId,
          data: { role: r.staff.role, existingUser: r.existingUser, name: r.staff.name },
        });
        return r;
      });
      reply.status(201);
      return result;
    },
  );

  app.patch(
    '/staff/:userId',
    { preValidation: requireTenantRole(OM), schema: { params: userParams, body: staffPatchSchema, response: { 200: staffDtoSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      return app.db.transaction(async (tx) => {
        const { staff, changes } = await patchStaff(tx, auth, request.params.userId, request.body);
        if (changes.length) {
          await audit(tx, {
            ...auditActor(request),
            action: 'staff.update',
            entityType: 'user',
            entityId: staff.userId,
            data: { changes, role: request.body.role ?? null, disabled: request.body.disabled ?? null },
          });
        }
        return staff;
      });
    },
  );

  app.delete(
    '/staff/:userId',
    { preValidation: requireTenantRole(OM), schema: { params: userParams, response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (request) => {
      const auth = tenantAuth(request);
      await app.db.transaction(async (tx) => {
        const removed = await removeStaff(tx, auth, request.params.userId);
        await audit(tx, { ...auditActor(request), action: 'staff.remove', entityType: 'user', entityId: request.params.userId, data: removed });
      });
      return { ok: true as const };
    },
  );

  // ------------------------------------------------------------------ Kuryeler
  app.get('/couriers', { preValidation: requireTenantRole(OMC), schema: { response: { 200: z.object({ items: z.array(courierDtoSchema) }) } } }, async (request) => {
    const auth = tenantAuth(request);
    return { items: await listCouriers(app.db, auth.tenantId) };
  });

  app.post(
    '/couriers/:userId/login-link',
    { preValidation: requireTenantRole(OM), schema: { params: userParams, response: { 201: courierLoginLinkResponseSchema } } },
    async (request, reply) => {
      const auth = tenantAuth(request);
      const link = await app.db.transaction(async (tx) => {
        const link = await createCourierLoginLink(tx, auth, request.params.userId, app.config.APP_BASE_URL);
        await audit(tx, {
          ...auditActor(request),
          action: 'courier.login_link',
          entityType: 'user',
          entityId: request.params.userId,
          data: { linkId: link.linkId, expiresAt: link.expiresAt.toISOString() },
        });
        return link;
      });
      reply.status(201);
      return { url: link.url, expiresAt: link.expiresAt.toISOString() };
    },
  );

  app.post(
    '/couriers/:userId/logout',
    { preValidation: requireTenantRole(OM), schema: { params: userParams, response: { 200: z.object({ ok: z.literal(true), closedSessions: z.number().int() }) } } },
    async (request) => {
      const auth = tenantAuth(request);
      const closed = await app.db.transaction(async (tx) => {
        const n = await logoutCourier(tx, auth, request.params.userId);
        await audit(tx, { ...auditActor(request), action: 'courier.logout', entityType: 'user', entityId: request.params.userId, data: { closedSessions: n } });
        return n;
      });
      return { ok: true as const, closedSessions: closed };
    },
  );
};

export default staffRoutes;
