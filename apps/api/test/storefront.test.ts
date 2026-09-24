// GET /api/v1/store/:slug — vitrin (14 §6.2): menü kuralları, sipariş alma durumu (sahte saat), 404.

import type { StorefrontView } from '@siparis/core/menu/contracts';
import { branches, openingHours, specialDays, tenants, waAccounts } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestContext, expectError, type TestContext, type TestTenant } from './helpers';
import { seedMenu, type SeededMenu } from './menu-helpers';

let ctx: TestContext;
let a: TestTenant;
let menu: SeededMenu;
let timed: TestTenant;

beforeAll(async () => {
  ctx = await createTestContext();
  a = await ctx.createTenantWithOwner({ name: 'Vitrin Pide', slug: 'vitrin-pide' });
  menu = await seedMenu(ctx, a.tenantId, a.branchId);
  await ctx.db
    .update(tenants)
    .set({ brandColor: '#B45309', legalName: 'Vitrin Pide (şahıs)', taxNo: '1234567890', taxOffice: 'Yozgat', address: 'Lise Cd. 1', phone: '+903542120000', email: 'a@b.local' })
    .where(eq(tenants.id, a.tenantId));

  // Saatli şube: her gün 10:00–23:30 (Europe/Istanbul)
  timed = await ctx.createTenantWithOwner({ name: 'Saatli', slug: 'saatli-isletme' });
  await ctx.db.delete(openingHours).where(eq(openingHours.branchId, timed.branchId));
  await ctx.db
    .insert(openingHours)
    .values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ tenantId: timed.tenantId, branchId: timed.branchId, weekday, opensAt: '10:00', closesAt: '23:30' })));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await ctx.close();
});

async function getStore(slug: string) {
  const res = await ctx.request({ method: 'GET', url: `/api/v1/store/${slug}` });
  return { res, body: res.json() as StorefrontView };
}

describe('GET /store/:slug — menü', () => {
  it('çekirdek storefront şemasıyla döner, kısa önbellek başlığı taşır', async () => {
    const { res, body } = await getStore('vitrin-pide');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=15');
    expect(body.tenant).toMatchObject({ name: 'Vitrin Pide', slug: 'vitrin-pide', brandColor: '#B45309', phone: '+903542120000' });
    expect(body.branch).toMatchObject({ id: a.branchId, name: 'Merkez', orderingState: 'open', acceptsDelivery: true, acceptsPickup: true, prepMinutes: 20 });
    expect(body.orderingEnabled).toBe(true);
    expect(body.legal).toEqual({
      legalName: 'Vitrin Pide (şahıs)',
      taxNo: '1234567890',
      taxOffice: 'Yozgat',
      address: 'Lise Cd. 1',
      phone: '+903542120000',
      email: 'a@b.local',
    });
  });

  it('WhatsApp numarası yalnız bağlı (connected) hesapta döner', async () => {
    expect((await getStore('vitrin-pide')).body.tenant.whatsappPhone).toBeNull();
    const [acc] = await ctx.db
      .insert(waAccounts)
      .values({ tenantId: a.tenantId, branchId: a.branchId, provider: 'mock', displayPhone: '+905550000099', webhookToken: 'vitrin-test-token', status: 'disconnected' })
      .returning();
    expect((await getStore('vitrin-pide')).body.tenant.whatsappPhone).toBeNull();
    await ctx.db.update(waAccounts).set({ status: 'connected' }).where(eq(waAccounts.id, acc!.id));
    expect((await getStore('vitrin-pide')).body.tenant.whatsappPhone).toBe('+905550000099');
  });

  it('yalnız aktif bölgeler, sıralı', async () => {
    const { body } = await getStore('vitrin-pide');
    expect(body.zones.map((z) => z.id)).toEqual([menu.zoneA]);
    expect(body.zones[0]).toMatchObject({ name: 'Merkez', kind: 'neighborhoods', feeKurus: 2000, minOrderKurus: 15000, etaMinutes: 25 });
  });

  it('kategoriler ve ürünler: aktif, sıralı; boş/pasif kategori ve pasif/silinmiş ürün yok', async () => {
    const { body } = await getStore('vitrin-pide');
    expect(body.categories.map((c) => c.name)).toEqual(['Pideler', 'İçecekler']);
    const pideler = body.categories[0]!.products.map((p) => p.name);
    expect(pideler).toEqual(['Lahmacun', 'Kıymalı Pide', 'Künefe', 'Dürüm']);
    const all = body.categories.flatMap((c) => c.products.map((p) => p.id));
    expect(all).not.toContain(menu.inactiveProduct);
    expect(all).not.toContain(menu.deletedProduct);
  });

  it('wa_restricted ürün storefront\'ta listelenmez', async () => {
    const { body } = await getStore('vitrin-pide');
    const all = body.categories.flatMap((c) => c.products.map((p) => p.id));
    expect(all).not.toContain(menu.bira);
    expect(body.categories[1]!.products.map((p) => p.name)).toEqual(['Ayran']);
  });

  it('sold_out_until > now → soldOut; geçmiş tarih satışta; karşılanamayan zorunlu grup → soldOut', async () => {
    const { body } = await getStore('vitrin-pide');
    const byId = new Map(body.categories.flatMap((c) => c.products).map((p) => [p.id, p]));
    expect(byId.get(menu.kunefeSoldOut)!.soldOut).toBe(true);
    expect(byId.get(menu.lahmacun)!.soldOut).toBe(false);
    expect(byId.get(menu.pide)!.soldOut).toBe(false);
    expect(byId.get(menu.impossible)!.soldOut).toBe(true);
    expect(byId.get(menu.impossible)!.optionGroups).toEqual([]);
  });

  it('seçenek grupları bağ sırasıyla; yalnız aktif seçenekler', async () => {
    const { body } = await getStore('vitrin-pide');
    const pide = body.categories[0]!.products.find((p) => p.id === menu.pide)!;
    expect(pide.optionGroups.map((g) => g.name)).toEqual(['Acı', 'Ekstralar']);
    const ekstra = pide.optionGroups[1]!;
    expect(ekstra).toMatchObject({ minSelect: 0, maxSelect: 2 });
    expect(ekstra.options).toEqual([
      { id: menu.optKasar, name: 'Kaşar', priceDeltaKurus: 3000 },
      { id: menu.optYumurta, name: 'Yumurta', priceDeltaKurus: 2000 },
    ]);
  });

  it('bilinmeyen ya da geçersiz slug → 404 store_not_found', async () => {
    expectError((await getStore('yok-boyle-isletme')).res, 404, 'store_not_found');
    expectError((await getStore('X')).res, 404, 'store_not_found');
  });

  it('büyük harfli slug küçük harfe çevrilir', async () => {
    const { res } = await getStore('Vitrin-Pide');
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /store/:slug — sipariş alma durumu (sahte saat)', () => {
  const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  };

  it('açılıştan önce kapalı; nextOpenAt bugün 10.00', async () => {
    at('2026-09-24T05:00:00Z'); // 08.00 İstanbul
    const { body } = await getStore('saatli-isletme');
    expect(body.branch.orderingState).toBe('closed');
    expect(body.branch.nextOpenAt).toBe('2026-09-24T07:00:00.000Z');
    expect(body.branch.closesAt).toBeNull();
  });

  it('çalışma saatinde açık; closesAt 23.30', async () => {
    at('2026-09-24T09:00:00Z'); // 12.00
    const { body } = await getStore('saatli-isletme');
    expect(body.branch.orderingState).toBe('open');
    expect(body.branch.nextOpenAt).toBeNull();
    expect(body.branch.closesAt).toBe('2026-09-24T20:30:00.000Z');
  });

  it('kapanıştan sonra kapalı; nextOpenAt ertesi gün 10.00', async () => {
    at('2026-09-24T21:00:00Z'); // 00.00 (25 Eylül)
    const { body } = await getStore('saatli-isletme');
    expect(body.branch.orderingState).toBe('closed');
    expect(body.branch.nextOpenAt).toBe('2026-09-25T07:00:00.000Z');
  });

  it('yoğun mod: busy + ek süre', async () => {
    await ctx.db.update(branches).set({ busyExtraMinutes: 15 }).where(eq(branches.id, timed.branchId));
    at('2026-09-24T09:00:00Z');
    const { body } = await getStore('saatli-isletme');
    expect(body.branch.orderingState).toBe('busy');
    expect(body.branch.busyExtraMinutes).toBe(15);
    await ctx.db.update(branches).set({ busyExtraMinutes: 0 }).where(eq(branches.id, timed.branchId));
  });

  it('duraklatılmış: paused + pausedUntil', async () => {
    await ctx.db.update(branches).set({ pausedUntil: new Date('2026-09-24T10:00:00Z') }).where(eq(branches.id, timed.branchId));
    at('2026-09-24T09:00:00Z');
    const { body } = await getStore('saatli-isletme');
    expect(body.branch.orderingState).toBe('paused');
    expect(body.branch.pausedUntil).toBe('2026-09-24T10:00:00.000Z');
    expect(body.branch.nextOpenAt).toBe('2026-09-24T10:00:00.000Z');
    await ctx.db.update(branches).set({ pausedUntil: null }).where(eq(branches.id, timed.branchId));
  });

  it('özel gün kapalı → closed', async () => {
    await ctx.db.insert(specialDays).values({ tenantId: timed.tenantId, branchId: timed.branchId, date: '2026-10-29', isClosed: true, note: 'Bayram' });
    at('2026-10-29T09:00:00Z');
    const { body } = await getStore('saatli-isletme');
    expect(body.branch.orderingState).toBe('closed');
    expect(body.branch.nextOpenAt).toBe('2026-10-30T07:00:00.000Z');
  });

  it('ordering_enabled=false → paused + orderingEnabled false (açılış bilinmez)', async () => {
    await ctx.db.update(tenants).set({ orderingEnabled: false }).where(eq(tenants.id, timed.tenantId));
    at('2026-09-24T09:00:00Z');
    const { body } = await getStore('saatli-isletme');
    expect(body.branch.orderingState).toBe('paused');
    expect(body.orderingEnabled).toBe(false);
    expect(body.branch.nextOpenAt).toBeNull();
    await ctx.db.update(tenants).set({ orderingEnabled: true }).where(eq(tenants.id, timed.tenantId));
  });

  it('askıdaki işletme (suspended) → paused + orderingEnabled false', async () => {
    await ctx.db.update(tenants).set({ lifecycleStage: 'suspended', suspensionReason: 'payment' }).where(eq(tenants.id, timed.tenantId));
    at('2026-09-24T09:00:00Z');
    const { body } = await getStore('saatli-isletme');
    expect(body.branch.orderingState).toBe('paused');
    expect(body.orderingEnabled).toBe(false);
    await ctx.db.update(tenants).set({ lifecycleStage: 'trial', suspensionReason: null }).where(eq(tenants.id, timed.tenantId));
  });
});
