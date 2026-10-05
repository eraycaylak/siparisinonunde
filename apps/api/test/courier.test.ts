// Kurye API'si (14 §6.3, 04 §9): yalnız kendine atanmış siparişler; tam telefon yalnız burada; başkasının siparişi 404.

import { branchEvents, branches, orderDeliveryAttempts, orderEvents, orders } from '@siparis/db';
import { and, desc, eq } from 'drizzle-orm';
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

/** Siparişi kuryeye atar ve yola çıkarır (teslim/teslim edilemedi testleri için). */
async function onTheWayOrder(courierId: string, cookie: string) {
  const o = await assignedOrder(courierId);
  const r = await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${o.id}/on-the-way`, cookie });
  expect(r.statusCode, r.body).toBe(200);
  return o;
}

async function eventsOf(orderId: string, type: string) {
  return ctx.db.select().from(orderEvents).where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.type, type)));
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

  it('mutfakta hazırlanan sipariş için "Yola çıktım" anlaşılır 409 (durum kodu içermez)', async () => {
    const o = await assignedOrder(burak.user.id);
    await ctx.db.update(orders).set({ status: 'preparing' }).where(eq(orders.id, o.id));
    const res = await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${o.id}/on-the-way`, cookie: burak.cookie });
    expectError(res, 409, 'order_not_ready');
    expect(res.json().error.message).not.toMatch(/preparing|on_the_way/);
    await ctx.db.update(orders).set({ status: 'cancelled', cancelledBy: 'tenant', cancelReason: 'other' }).where(eq(orders.id, o.id));
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

  // -------------------------------------------------------------------------
  // Kapıda ödeme yöntemi (denetim H10, H11)

  it('kurye tarafından seçilemeyen yöntemler reddedilir (online kart, kasada, markasız yemek kartı)', async () => {
    const o = await onTheWayOrder(burak.user.id, burak.cookie);
    const deliver = (body: Record<string, unknown>) =>
      ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${o.id}/delivered`, cookie: burak.cookie, body });
    expectError(await deliver({ paidWith: 'online_card' }), 400, 'validation_error');
    expectError(await deliver({ paidWith: 'pay_at_counter' }), 400, 'validation_error');
    expectError(await deliver({ paidWith: 'meal_card_on_delivery' }), 400, 'validation_error');
    expectError(await deliver({ paidWith: 'meal_card_on_delivery', mealCardBrand: 'setcard' }), 422, 'meal_card_brand_unavailable');
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, o.id));
    expect(row).toMatchObject({ status: 'on_the_way', paymentMethod: 'cash_on_delivery', paymentStatus: 'unpaid' });
  });

  it('şubede kapalı yöntem 422 döner ve listede hiç önerilmez', async () => {
    const o = await onTheWayOrder(burak.user.id, burak.cookie);
    await ctx.db.update(branches).set({ paymentMethods: ['cash_on_delivery'] }).where(eq(branches.id, s.branchId));
    try {
      const list = await ctx.request({ method: 'GET', url: '/api/v1/courier/orders', cookie: burak.cookie });
      const dto = list.json().items.find((i: { id: string }) => i.id === o.id);
      expect(dto.allowedPaymentMethods).toEqual(['cash_on_delivery']);
      expectError(
        await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${o.id}/delivered`, cookie: burak.cookie, body: { paidWith: 'card_on_delivery' } }),
        422,
        'payment_method_unavailable',
      );
    } finally {
      await ctx.db
        .update(branches)
        .set({ paymentMethods: ['cash_on_delivery', 'card_on_delivery', 'meal_card_on_delivery', 'pay_at_counter'] })
        .where(eq(branches.id, s.branchId));
    }
  });

  it('ödeme yöntemi değişikliği olay günlüğüne eski değeriyle yazılır', async () => {
    const o = await onTheWayOrder(burak.user.id, burak.cookie);
    const d = await ctx.request({
      method: 'POST',
      url: `/api/v1/courier/orders/${o.id}/delivered`,
      cookie: burak.cookie,
      body: { paidWith: 'meal_card_on_delivery', mealCardBrand: 'multinet' },
    });
    expect(d.statusCode, d.body).toBe(200);
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, o.id));
    expect(row).toMatchObject({ status: 'delivered', paymentStatus: 'paid', paymentMethod: 'meal_card_on_delivery', mealCardBrand: 'multinet' });
    const events = await eventsOf(o.id, 'payment_method_changed');
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ by: 'courier', from: 'cash_on_delivery', to: 'meal_card_on_delivery', toMealCardBrand: 'multinet' });
  });

  it('aynı yöntemle teslimde değişiklik olayı yazılmaz', async () => {
    const o = await onTheWayOrder(burak.user.id, burak.cookie);
    const d = await ctx.request({
      method: 'POST',
      url: `/api/v1/courier/orders/${o.id}/delivered`,
      cookie: burak.cookie,
      body: { paidWith: 'cash_on_delivery' },
    });
    expect(d.statusCode, d.body).toBe(200);
    expect(await eventsOf(o.id, 'payment_method_changed')).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Teslim edilemedi (denetim H13)

  it('teslim edilemedi: sipariş durumu değişmez, deneme ve olay yazılır, panele olay gider', async () => {
    const o = await onTheWayOrder(burak.user.id, burak.cookie);
    const res = await ctx.request({
      method: 'POST',
      url: `/api/v1/courier/orders/${o.id}/undeliverable`,
      cookie: burak.cookie,
      body: { reason: 'customer_absent' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().status).toBe('on_the_way');
    expect(res.json().order).toMatchObject({ deliveryAttempts: 1, lastDeliveryFailure: { reason: 'customer_absent', note: null } });
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, o.id));
    expect(row).toMatchObject({ status: 'on_the_way', paymentStatus: 'unpaid', deliveredAt: null });
    const attempts = await ctx.db.select().from(orderDeliveryAttempts).where(eq(orderDeliveryAttempts.orderId, o.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ tenantId: s.tenantId, reason: 'customer_absent', courierUserId: burak.user.id });
    const failedEvents = await eventsOf(o.id, 'delivery_failed');
    expect(failedEvents).toHaveLength(1);
    // Panel olayı sebep + deneme sayısı taşır; serbest metin açıklama YÜKE GİRMEZ (mutfak projeksiyonu yalnız
    // bilinen kişisel alan adlarını temizler, tanımadığı bir `note` fiyatsız mutfak ekranına düşerdi)
    const [sse] = await ctx.db
      .select()
      .from(branchEvents)
      .where(and(eq(branchEvents.branchId, s.branchId), eq(branchEvents.type, 'order.updated')))
      .orderBy(desc(branchEvents.seq))
      .limit(1);
    expect(sse!.payload).toMatchObject({ change: 'delivery_failed', reason: 'customer_absent', attempts: 1 });
    expect(sse!.payload).not.toHaveProperty('note');
    // Sipariş hâlâ kuryenin listesinde: işletme karar verene kadar düşmez
    const list = await ctx.request({ method: 'GET', url: '/api/v1/courier/orders', cookie: burak.cookie });
    expect(list.json().items.map((i: { id: string }) => i.id)).toContain(o.id);
  });

  it('teslim edilemedi: "Diğer" sebebinde açıklama zorunlu, yolda olmayan sipariş reddedilir', async () => {
    const ready = await assignedOrder(burak.user.id);
    expectError(
      await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${ready.id}/undeliverable`, cookie: burak.cookie, body: { reason: 'customer_absent' } }),
      409,
      'order_not_on_the_way',
    );
    const o = await onTheWayOrder(burak.user.id, burak.cookie);
    expectError(
      await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${o.id}/undeliverable`, cookie: burak.cookie, body: { reason: 'other' } }),
      400,
      'validation_error',
    );
    expectError(
      await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${o.id}/undeliverable`, cookie: burak.cookie, body: { reason: 'kapi_kapali' } }),
      400,
      'validation_error',
    );
    const ok = await ctx.request({
      method: 'POST',
      url: `/api/v1/courier/orders/${o.id}/undeliverable`,
      cookie: burak.cookie,
      body: { reason: 'other', note: 'Bina yıkılmış' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('teslim edilemedi: başka kuryenin siparişi 404, teslim edilmiş sipariş 409', async () => {
    const theirs = await assignedOrder(ali.user.id);
    expectError(
      await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${theirs.id}/undeliverable`, cookie: burak.cookie, body: { reason: 'customer_absent' } }),
      404,
      'not_found',
    );
    const mine = await onTheWayOrder(burak.user.id, burak.cookie);
    await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${mine.id}/delivered`, cookie: burak.cookie, body: {} });
    expectError(
      await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${mine.id}/undeliverable`, cookie: burak.cookie, body: { reason: 'customer_absent' } }),
      409,
      'already_delivered',
    );
  });

  // -------------------------------------------------------------------------
  // Veri minimizasyonu (00 §7, 04 §9.2 Gizlilik)

  it('gel-al siparişinde adres, telefon ve koordinat dönmez; ödeme yöntemi değiştirilemez', async () => {
    const o = await createHookedOrder(ctx, s, { fulfillmentType: 'pickup' });
    await ctx.request({ method: 'POST', url: `/api/v1/panel/orders/${o.id}/accept`, cookie: s.ownerCookie, body: { etaMinutes: 20 } });
    // Panel gel-al siparişine kurye ATAMAZ (409); kayıt yine de kuryeye bağlı kalabilir (atamadan sonra teslim
    // türü değişmişse) → o durumda da kişisel veri dönmemeli
    await ctx.db.update(orders).set({ courierUserId: burak.user.id }).where(eq(orders.id, o.id));
    const list = await ctx.request({ method: 'GET', url: '/api/v1/courier/orders', cookie: burak.cookie });
    const dto = list.json().items.find((i: { id: string }) => i.id === o.id);
    expect(dto).toMatchObject({ customerPhone: null, addressLine: null, neighborhood: null, lat: null, lng: null, zoneName: null, allowedPaymentMethods: [] });
    expectError(
      await ctx.request({ method: 'POST', url: `/api/v1/courier/orders/${o.id}/delivered`, cookie: burak.cookie, body: { paidWith: 'cash_on_delivery' } }),
      422,
      'payment_method_locked',
    );
  });
});
