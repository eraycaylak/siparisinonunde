// Kurye API'si (14 §6.3, 04 §9): yalnız kendine atanmış siparişler; tam telefon yalnız burada; başkasının siparişi 404.

import { orders } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, expectError, type TestContext } from './helpers';
import { createHookedOrder, setupStore, stubExternalJobs, type StoreFixture } from './orders-helpers';

let ctx: TestContext;
let s: StoreFixture;
let other: StoreFixture;
let burak: { user: { id: string }; cookie: string };
let ali: { user: { id: string }; cookie: string };

beforeAll(async () => {
  ctx = await createTestContext();
  stubExternalJobs();
  s = await setupStore(ctx, { wa: 'connected' });
  other = await setupStore(ctx, { wa: 'connected' });
  burak = await ctx.createStaff(s.tenantId, 'courier');
  ali = await ctx.createStaff(s.tenantId, 'courier');
});
afterAll(async () => {
  await ctx.close();
});

async function assignedOrder(courierId: string, changeFor?: number) {
  const o = await createHookedOrder(ctx, s);
  await ctx.request({ method: 'POST', url: `/api/v1/panel/orders/${o.id}/accept`, cookie: s.ownerCookie, body: { etaMinutes: 20 } });
  if (changeFor) await ctx.db.update(orders).set({ changeForKurus: changeFor }).where(eq(orders.id, o.id));
  const r = await ctx.request({ method: 'POST', url: `/api/v1/panel/orders/${o.id}/assign-courier`, cookie: s.ownerCookie, body: { userId: courierId } });
  expect(r.statusCode, r.body).toBe(200);
  return o;
}

describe('kurye görünümü', () => {
  it('GET /courier/orders: yalnız bana atanmış açık siparişler; tam telefon, adres, tahsilat ve para üstü', async () => {
    const mine = await assignedOrder(burak.user.id, 20000);
    const theirs = await assignedOrder(ali.user.id);
    const res = await ctx.request({ method: 'GET', url: '/api/v1/courier/orders', cookie: burak.cookie });
    expect(res.statusCode, res.body).toBe(200);
    const ids = res.json().items.map((i: { id: string }) => i.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    const dto = res.json().items.find((i: { id: string }) => i.id === mine.id);
    expect(dto).toMatchObject({
      customerPhone: '+905321234567',
      addressLine: 'Test Sk. No 1',
      paymentMethod: 'cash_on_delivery',
      totalKurus: 16000,
      changeForKurus: 20000,
      changeKurus: 4000,
      status: 'accepted',
    });
    expect(dto.items[0]).toEqual({ name: 'Kıymalı Pide', quantity: 1, options: ['Acısız'], note: null });
  });

  it('başka kuryenin ya da başka işletmenin siparişi 404', async () => {
    const theirs = await assignedOrder(ali.user.id);
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${theirs.id}/on-the-way`, cookie: burak.cookie }), 404, 'not_found');
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${theirs.id}/delivered`, cookie: burak.cookie, body: {} }), 404, 'not_found');
    const foreign = await createHookedOrder(ctx, other);
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${foreign.id}/on-the-way`, cookie: burak.cookie }), 404, 'not_found');
    const [t] = await ctx.db.select().from(orders).where(eq(orders.id, theirs.id));
    expect(t!.status).toBe('accepted');
  });

  it('Yola çıktım → on_the_way; Teslim ettim → delivered + ödendi; teslimden sonra listede yok', async () => {
    const o = await assignedOrder(burak.user.id);
    const a = await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${o.id}/on-the-way`, cookie: burak.cookie });
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json().status).toBe('on_the_way');
    const d = await ctx.request({
      method: 'POST',
      url: `/api/v1/courier/orders/${o.id}/delivered`,
      cookie: burak.cookie,
      body: { paidWith: 'card_on_delivery' },
    });
    expect(d.statusCode, d.body).toBe(200);
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, o.id));
    expect(row).toMatchObject({ status: 'delivered', paymentStatus: 'paid', paymentMethod: 'card_on_delivery' });
    const list = await ctx.request({ method: 'GET', url: '/api/v1/courier/orders', cookie: burak.cookie });
    expect(list.json().items.map((i: { id: string }) => i.id)).not.toContain(o.id);
    expect(list.json().deliveredToday).toBeGreaterThanOrEqual(1);
  });

  it('iptal edilen sipariş için aksiyon reddedilir', async () => {
    const o = await assignedOrder(burak.user.id);
    await ctx.request({ method: 'POST', url: `/api/v1/panel/orders/${o.id}/cancel`, cookie: s.ownerCookie, body: { reason: 'courier_issue' } });
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${o.id}/on-the-way`, cookie: burak.cookie }), 409, 'order_cancelled');
  });

  it('oturumsuz ve mutfak rolü erişemez', async () => {
    expect((await ctx.request({ method: 'GET', url: '/api/v1/courier/orders' })).statusCode).toBe(401);
    const kitchen = await ctx.createStaff(s.tenantId, 'kitchen');
    expect((await ctx.request({ method: 'GET', url: '/api/v1/courier/orders', cookie: kitchen.cookie })).statusCode).toBe(403);
  });
});
