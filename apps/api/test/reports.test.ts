// Dilim 4 — raporlar: gün sonu (İstanbul gün sınırı, test siparişi hariç, ödeme yöntemi kırılımı, en çok satanlar,
// onay süresi), dönem özeti (seri, kanal, ısı haritası), tasarruf (04 §11.3); yetki ve yalıtım.

import { tenants } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, expectError, type TestContext, type TestTenant } from './helpers';
import { insertOrder } from './settings-helpers';

let ctx: TestContext;
let a: TestTenant;
let b: TestTenant;
let cashier: { cookie: string };

const req = (url: string, cookie: string) => ctx.request({ method: 'GET', url: `/api/v1/panel${url}`, cookie });
/** İstanbul yerel saati (UTC+3) → Date */
const ist = (s: string) => new Date(`${s}+03:00`);

beforeAll(async () => {
  ctx = await createTestContext();
  a = await ctx.createTenantWithOwner();
  b = await ctx.createTenantWithOwner();
  cashier = await ctx.createStaff(a.tenantId, 'cashier');
  const base = { tenantId: a.tenantId, branchId: a.branchId };
  // 20 Eylül 2026 (Pazar) — İstanbul günü
  const o1 = await insertOrder(ctx.db, { ...base, placedAt: ist('2026-09-20T00:10:00'), totalKurus: 20000, paymentMethod: 'cash_on_delivery', itemName: 'Lahmacun', quantity: 4, channel: 'web' });
  await insertOrder(ctx.db, {
    ...base,
    placedAt: ist('2026-09-20T23:30:00'),
    totalKurus: 31500,
    deliveryFeeKurus: 1500,
    paymentMethod: 'meal_card_on_delivery',
    itemName: 'Kıymalı Pide',
    channel: 'wa_link',
    extra: { mealCardBrand: 'multinet', firstAckedAt: ist('2026-09-20T23:33:00') },
  });
  await insertOrder(ctx.db, { ...base, placedAt: ist('2026-09-20T12:00:00'), totalKurus: 15000, paymentMethod: 'card_on_delivery', itemName: 'Lahmacun', quantity: 2, channel: 'manual', extra: { firstAckedAt: ist('2026-09-20T12:01:00') } });
  await insertOrder(ctx.db, { ...base, placedAt: ist('2026-09-20T13:00:00'), status: 'rejected', totalKurus: 9000 });
  await insertOrder(ctx.db, { ...base, placedAt: ist('2026-09-20T14:00:00'), status: 'cancelled', totalKurus: 7000 });
  await insertOrder(ctx.db, { ...base, placedAt: ist('2026-09-20T15:00:00'), status: 'awaiting_customer', totalKurus: 5000 });
  // Test siparişi (hariç) ve gün sınırı dışı (21 Eylül 00:30 İstanbul = 20 Eylül 21:30 UTC)
  await insertOrder(ctx.db, { ...base, placedAt: ist('2026-09-20T18:00:00'), totalKurus: 99900, testKind: 'onboarding_test', itemName: 'Test Ürünü' });
  await insertOrder(ctx.db, { ...base, placedAt: ist('2026-09-21T00:30:00'), totalKurus: 50000, itemName: 'Ertesi Gün' });
  await insertOrder(ctx.db, { ...base, placedAt: ist('2026-09-19T23:50:00'), totalKurus: 40000, itemName: 'Önceki Gün' });
  // Başka tenant (yalıtım)
  await insertOrder(ctx.db, { tenantId: b.tenantId, branchId: b.branchId, placedAt: ist('2026-09-20T12:00:00'), totalKurus: 77700 });
  expect(o1.status).toBe('delivered');
});

afterAll(async () => {
  await ctx.close();
});

describe('GET /panel/reports/daily', () => {
  it('İstanbul günü; test siparişi ve başka tenant hariç; kasa özeti', async () => {
    const res = await req('/reports/daily?date=2026-09-20', a.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json();
    expect(r.from).toBe('2026-09-19T21:00:00.000Z');
    expect(r.to).toBe('2026-09-20T21:00:00.000Z');
    expect(r.byStatus).toEqual({ delivered: 3, rejected: 1, cancelled: 1, awaiting_customer: 1 });
    expect(r.deliveredCount).toBe(3);
    expect(r.receivedCount).toBe(5);
    expect(r.revenueKurus).toBe(20000 + 31500 + 15000);
    expect(r.deliveryFeeKurus).toBe(1500);
    expect(r.avgBasketKurus).toBe(Math.round(66500 / 3));
    expect(r).toMatchObject({ rejectedCount: 1, rejectedKurus: 9000, cancelledCount: 1, cancelledKurus: 7000, missedCount: 1 });
    expect(r.byPaymentMethod).toEqual(
      expect.arrayContaining([
        { paymentMethod: 'cash_on_delivery', mealCardBrand: null, count: 1, totalKurus: 20000 },
        { paymentMethod: 'meal_card_on_delivery', mealCardBrand: 'multinet', count: 1, totalKurus: 31500 },
        { paymentMethod: 'card_on_delivery', mealCardBrand: null, count: 1, totalKurus: 15000 },
      ]),
    );
    expect(r.topProducts[0]).toEqual({ name: 'Lahmacun', quantity: 6, revenueKurus: 35000 });
    expect(r.topProducts.map((p: { name: string }) => p.name)).not.toContain('Test Ürünü');
    expect(r.topProducts.map((p: { name: string }) => p.name)).not.toContain('Ertesi Gün');
    expect(r.avgAckSeconds).toBe(120); // (180 + 60) / 2
    expect(r.slowAckCount).toBe(1);
    const channels = Object.fromEntries(r.byChannel.map((c: { channel: string; count: number }) => [c.channel, c.count]));
    expect(channels).toMatchObject({ web: 3, wa_link: 1, manual: 1 });
  });

  it('ertesi gün sınırı doğru ayrılır', async () => {
    const r = (await req('/reports/daily?date=2026-09-21', a.ownerCookie)).json();
    expect(r.deliveredCount).toBe(1);
    expect(r.revenueKurus).toBe(50000);
    const prev = (await req('/reports/daily?date=2026-09-19', a.ownerCookie)).json();
    expect(prev.revenueKurus).toBe(40000);
  });

  it('kasiyer yalnız bugünü görür; geçersiz tarih 400; mutfak 403', async () => {
    expectError(await req('/reports/daily?date=2026-09-20', cashier.cookie), 403, 'forbidden');
    const today = await req('/reports/daily', cashier.cookie);
    expect(today.statusCode, today.body).toBe(200);
    expectError(await req('/reports/daily?date=2026-02-30', a.ownerCookie), 400, 'validation_error');
    const kitchen = await ctx.createStaff(a.tenantId, 'kitchen');
    expectError(await req('/reports/daily', kitchen.cookie), 403, 'forbidden');
    expectError(await req(`/reports/daily?branchId=${b.branchId}`, a.ownerCookie), 404, 'not_found');
  });
});

describe('GET /panel/reports/summary', () => {
  it('günlük seri, önceki dönem, kanal kırılımı ve saat×gün ısı haritası', async () => {
    const res = await req('/reports/summary?from=2026-09-14&to=2026-09-20', a.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json();
    expect(r.series).toHaveLength(7);
    expect(r.series[6]).toEqual({ date: '2026-09-20', receivedCount: 5, deliveredCount: 3, revenueKurus: 66500 });
    expect(r.series[5]).toEqual({ date: '2026-09-19', receivedCount: 1, deliveredCount: 1, revenueKurus: 40000 });
    expect(r.totals).toMatchObject({ deliveredCount: 4, revenueKurus: 106500 });
    expect(r.previous).toEqual({ receivedCount: 0, deliveredCount: 0, revenueKurus: 0 });
    expect(r.heatmap).toHaveLength(7);
    expect(r.heatmap[0]).toHaveLength(24);
    // 20 Eylül 2026 Pazar (0): 00.10, 12.00, 13.00, 14.00 (iptal tenant_no_response sayılır), 23.30
    expect(r.heatmap[0][0]).toBe(1);
    expect(r.heatmap[0][23]).toBe(1);
    expect(r.heatmap[0][18]).toBe(0); // test siparişi
    expect(r.heatmap[6][23]).toBe(1); // 19 Eylül Cumartesi 23.50
    expect(r.byChannel.find((c: { channel: string }) => c.channel === 'wa_link')).toMatchObject({ count: 1, revenueKurus: 31500 });
  });

  it('doğrulama ve yetki', async () => {
    expectError(await req('/reports/summary?from=2026-01-01&to=2026-06-30', a.ownerCookie), 400, 'validation_error');
    expectError(await req('/reports/summary?from=2026-09-20&to=2026-09-10', a.ownerCookie), 400, 'validation_error');
    expectError(await req('/reports/summary', cashier.cookie), 403, 'forbidden');
  });
});

describe('GET /panel/reports/savings', () => {
  it('kendi kanal teslim sepeti × pazaryeri oranı; telefon siparişi isteğe bağlı', async () => {
    await ctx.db.update(tenants).set({ marketplaceCommissionBp: 2500 }).where(eq(tenants.id, a.tenantId));
    const res = await req('/reports/savings?month=2026-09', a.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json();
    // web: 20000 + 50000 + 40000 ; wa_link: 30000 (teslimat ücreti hariç) ; manual hariç ; test hariç
    expect(r.orderCount).toBe(4);
    expect(r.basketTotalKurus).toBe(140000);
    expect(r.commissionBp).toBe(2500);
    expect(r.avoidedCommissionKurus).toBe(35000);
    expect(r.avoidedCommissionWithVatKurus).toBe(42000);
    expect(r.headline).toContain('4 sipariş');
    expect(r.headline).toContain('350,00 TL');
    expect(r.note).toContain('Tahmindir');

    const withPhone = (await req('/reports/savings?month=2026-09&includePhone=1', a.ownerCookie)).json();
    expect(withPhone.orderCount).toBe(5);
    expect(withPhone.basketTotalKurus).toBe(155000);

    const other = (await req('/reports/savings?month=2026-09', b.ownerCookie)).json();
    expect(other.orderCount).toBe(1);
    expectError(await req('/reports/savings?month=2026-13', a.ownerCookie), 400, 'validation_error');
    expectError(await req('/reports/savings', cashier.cookie), 403, 'forbidden');
  });
});
