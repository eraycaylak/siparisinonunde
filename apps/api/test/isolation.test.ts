// Tenant yalıtımı (14 §5, §10). Diğer dilimler için desen: iki tenant kur, A'nın oturumuyla B'nin
// kaydına eriş → 404 (varlığı sızdırmadan). Rol dışı erişim → 403. Oturumsuz → 401.

import { branches, orders } from '@siparis/db';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { notFound } from '../src/lib/errors';
import { requireTenantRole, tenantAuth } from '../src/plugins/auth';
import { findOrder, loadOrderSummary } from '../src/services/orders/summary';
import { createTestContext, expectError, expectIsolated, type TestContext, type TestTenant } from './helpers';

let ctx: TestContext;
let a: TestTenant;
let b: TestTenant;

// Örnek panel rotası: tenant kapsamlı okuma deseni (her sorgu request.auth.tenantId ile filtrelenir)
const sampleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireTenantRole(['owner', 'manager', 'cashier']));
  app.get('/__iso/orders/:id', { schema: { params: z.object({ id: z.uuid() }) } }, async (request) => {
    const auth = tenantAuth(request);
    const order = await findOrder(app.db, auth.tenantId, request.params.id);
    if (!order) throw notFound('Sipariş bulunamadı.');
    return loadOrderSummary(app.db, order);
  });
};

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.app.register(sampleRoutes, { prefix: '/api/v1/panel' });
  a = await ctx.createTenantWithOwner({ name: 'A İşletmesi' });
  b = await ctx.createTenantWithOwner({ name: 'B İşletmesi' });
});

afterAll(async () => {
  await ctx.close();
});

describe('tenant yalıtımı', () => {
  it('SSE akışı: başka tenant\'ın şubesi → 404', async () => {
    const res = await ctx.request({ method: 'GET', url: `/api/v1/panel/stream?branchId=${b.branchId}`, cookie: a.ownerCookie });
    expectIsolated(res);
    expectError(res, 404, 'not_found');
  });

  it('SSE akışı: oturumsuz 401, kurye 403, geçersiz şube kimliği 400', async () => {
    expectError(await ctx.request({ method: 'GET', url: `/api/v1/panel/stream?branchId=${a.branchId}` }), 401, 'unauthorized');
    const courier = await ctx.createStaff(a.tenantId, 'courier');
    expectError(await ctx.request({ method: 'GET', url: `/api/v1/panel/stream?branchId=${a.branchId}`, cookie: courier.cookie }), 403, 'forbidden');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/panel/stream?branchId=abc', cookie: a.ownerCookie }), 400, 'validation_error');
  });

  it('şube kısıtlı üyelik: aynı tenant\'ın diğer şubesi → 404', async () => {
    const [second] = await ctx.db.insert(branches).values({ tenantId: a.tenantId, name: 'İkinci Şube', isDefault: false }).returning();
    const cashier = await ctx.createStaff(a.tenantId, 'cashier', { branchId: a.branchId });
    expectError(
      await ctx.request({ method: 'GET', url: `/api/v1/panel/stream?branchId=${second!.id}`, cookie: cashier.cookie }),
      404,
      'not_found',
    );
  });

  it('desen: tenant kapsamlı kayıt okuma — kendi siparişi 200, diğerinin 404', async () => {
    const own = await ctx.createOrder({ tenantId: a.tenantId, branchId: a.branchId });
    const foreign = await ctx.createOrder({ tenantId: b.tenantId, branchId: b.branchId });
    const ok = await ctx.request({ method: 'GET', url: `/api/v1/panel/__iso/orders/${own.id}`, cookie: a.ownerCookie });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: own.id, tenantId: a.tenantId });
    expectError(await ctx.request({ method: 'GET', url: `/api/v1/panel/__iso/orders/${foreign.id}`, cookie: a.ownerCookie }), 404, 'not_found');
    // Kayıt gerçekten var (404 sızıntı değil yalıtım)
    const [exists] = await ctx.db.select({ id: orders.id }).from(orders).where(eq(orders.id, foreign.id));
    expect(exists).toBeDefined();
    // Rol dışı (mutfak) → 403
    const kitchen = await ctx.createStaff(a.tenantId, 'kitchen');
    expectError(await ctx.request({ method: 'GET', url: `/api/v1/panel/__iso/orders/${own.id}`, cookie: kitchen.cookie }), 403, 'forbidden');
  });

  it('başka tenant\'ın üyeliği olmayan tenant seçimi reddedilir', async () => {
    expectError(
      await ctx.request({ method: 'POST', url: '/api/v1/auth/switch-tenant', cookie: a.ownerCookie, body: { tenantId: b.tenantId } }),
      404,
      'not_found',
    );
  });
});
