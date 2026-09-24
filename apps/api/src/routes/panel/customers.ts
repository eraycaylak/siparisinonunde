// Panel müşteriler (14 §6.3 Müşteri) — dilim 4. Liste/profil/not/kara liste: owner, manager, cashier;
// KVKK dışa aktarma ve silme: yalnız owner/manager (00 §4, 08 §2.10).

import type { TenantRole } from '@siparis/core';
import {
  customerDetailSchema,
  customerListItemSchema,
  customerListQuerySchema,
  customerOrderItemSchema,
  customerPatchSchema,
} from '@siparis/core/settings/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit, auditActor } from '../../lib/audit';
import { requireTenantRole, tenantAuth } from '../../plugins/auth';
import {
  customerDetail,
  customerOrders,
  eraseCustomer,
  exportCustomer,
  findCustomer,
  listCustomers,
  patchCustomer,
} from '../../services/customers/index';

const OM: readonly TenantRole[] = ['owner', 'manager'];
const OMC: readonly TenantRole[] = ['owner', 'manager', 'cashier'];
const idParams = z.object({ id: z.uuid() });

const customerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/customers',
    {
      preValidation: requireTenantRole(OMC),
      schema: { querystring: customerListQuerySchema, response: { 200: z.object({ items: z.array(customerListItemSchema), nextCursor: z.string().optional() }) } },
    },
    async (request) => {
      const auth = tenantAuth(request);
      return listCustomers(app.db, auth.tenantId, request.query);
    },
  );

  app.get(
    '/customers/:id',
    { preValidation: requireTenantRole(OMC), schema: { params: idParams, response: { 200: customerDetailSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      return customerDetail(app.db, await findCustomer(app.db, auth.tenantId, request.params.id));
    },
  );

  app.patch(
    '/customers/:id',
    { preValidation: requireTenantRole(OMC), schema: { params: idParams, body: customerPatchSchema, response: { 200: customerDetailSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const row = await app.db.transaction(async (tx) => {
        const c = await findCustomer(tx, auth.tenantId, request.params.id);
        const { row, changes } = await patchCustomer(tx, c, request.body);
        if (Object.keys(changes).length) {
          await audit(tx, { ...auditActor(request), action: 'customer.update', entityType: 'customer', entityId: c.id, data: changes });
        }
        return row;
      });
      return customerDetail(app.db, row);
    },
  );

  app.get(
    '/customers/:id/orders',
    {
      preValidation: requireTenantRole(OMC),
      schema: {
        params: idParams,
        querystring: z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }),
        response: { 200: z.object({ items: z.array(customerOrderItemSchema), nextCursor: z.string().optional() }) },
      },
    },
    async (request) => {
      const auth = tenantAuth(request);
      const c = await findCustomer(app.db, auth.tenantId, request.params.id);
      return customerOrders(app.db, c, request.query);
    },
  );

  app.post('/customers/:id/export', { preValidation: requireTenantRole(OM), schema: { params: idParams } }, async (request, reply) => {
    const auth = tenantAuth(request);
    const c = await findCustomer(app.db, auth.tenantId, request.params.id);
    const data = await exportCustomer(app.db, c);
    await audit(app.db, {
      ...auditActor(request),
      action: 'customer.export',
      entityType: 'customer',
      entityId: c.id,
      data: { orders: data.orders.length, messages: data.messages.length },
    });
    reply.header('content-disposition', `attachment; filename="musteri-${c.id.slice(0, 8)}-kvkk.json"`);
    return data;
  });

  app.post(
    '/customers/:id/erase',
    { preValidation: requireTenantRole(OM), schema: { params: idParams, response: { 200: z.object({ ok: z.literal(true), orderCount: z.number().int(), messageCount: z.number().int() }) } } },
    async (request) => {
      const auth = tenantAuth(request);
      const result = await app.db.transaction(async (tx) => {
        const c = await findCustomer(tx, auth.tenantId, request.params.id);
        const r = await eraseCustomer(tx, c, auth.userId);
        await audit(tx, { ...auditActor(request), action: 'customer.erase', entityType: 'customer', entityId: c.id, data: r });
        return r;
      });
      return { ok: true as const, ...result };
    },
  );
};

export default customerRoutes;
