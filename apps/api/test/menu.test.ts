// Panel menü API'si (14 §6.3 Menü): ağaç, CRUD, bağlar, tükendi, sıralama; roller (04 §2.4), salt-okunur oturum,
// abonelik kilidi ve tenant yalıtımı (başka tenant'ın kaydı 404).

import type { PanelMenuResponse, PanelOptionGroup, PanelProduct, StorefrontView } from '@siparis/core/menu/contracts';
import { auditLog, categories, openingHours, optionGroups, options, productOptionGroups, products, tenants } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, expectError, expectIsolated, type TestContext, type TestTenant } from './helpers';
import { seedMenu, type SeededMenu } from './menu-helpers';

let ctx: TestContext;
let a: TestTenant;
let b: TestTenant;
let menuA: SeededMenu;
let menuB: SeededMenu;
let cashier: string;
let kitchen: string;
let manager: string;
let courier: string;

const P = '/api/v1/panel';

beforeAll(async () => {
  ctx = await createTestContext();
  a = await ctx.createTenantWithOwner({ name: 'Menü A', slug: 'menu-a' });
  b = await ctx.createTenantWithOwner({ name: 'Menü B', slug: 'menu-b' });
  menuA = await seedMenu(ctx, a.tenantId, a.branchId);
  menuB = await seedMenu(ctx, b.tenantId, b.branchId);
  cashier = (await ctx.createStaff(a.tenantId, 'cashier')).cookie;
  kitchen = (await ctx.createStaff(a.tenantId, 'kitchen')).cookie;
  manager = (await ctx.createStaff(a.tenantId, 'manager')).cookie;
  courier = (await ctx.createStaff(a.tenantId, 'courier')).cookie;
});

afterAll(async () => {
  await ctx.close();
});

const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie?: string, body?: unknown) =>
  ctx.request({ method, url: `${P}${url}`, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { body } : {}) });

async function lastAudit(action: string) {
  const rows = await ctx.db.select().from(auditLog).where(eq(auditLog.action, action));
  return rows[rows.length - 1];
}

describe('GET /panel/menu', () => {
  it('owner: tam ağaç (silinmişler hariç), bağlar sıralı, fiyatlar var', async () => {
    const res = await req('GET', '/menu', a.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as PanelMenuResponse;
    expect(body.canEdit).toBe(true);
    expect(body.showPrices).toBe(true);
    expect(body.categories.map((c) => c.name)).toEqual(['Pideler', 'İçecekler', 'Boş Kategori', 'Kapalı Kategori']);
    expect(body.categories.find((c) => c.id === menuA.catPide)!.productCount).toBe(5);
    const ids = body.products.map((p) => p.id);
    expect(ids).not.toContain(menuA.deletedProduct);
    expect(ids).toContain(menuA.bira);
    const pide = body.products.find((p) => p.id === menuA.pide)!;
    expect(pide.priceKurus).toBe(20000);
    expect(pide.optionGroupIds).toEqual([menuA.gAci, menuA.gEkstra]);
    expect(body.products.find((p) => p.id === menuA.kunefeSoldOut)!.soldOut).toBe(true);
    const ekstra = body.optionGroups.find((g) => g.id === menuA.gEkstra)!;
    expect(ekstra.options.map((o) => o.name)).toEqual(['Kaşar', 'Yumurta', 'Sucuk (kapalı)']);
    expect(ekstra.productCount).toBe(1);
    // Yalnız kendi tenant'ı
    expect(ids).not.toContain(menuB.pide);
  });

  it('mutfak: fiyat alanı yok, düzenleyemez; kasiyer: fiyat var, düzenleyemez', async () => {
    const k = (await req('GET', '/menu', kitchen)).json() as PanelMenuResponse;
    expect(k.canEdit).toBe(false);
    expect(k.showPrices).toBe(false);
    expect(k.products.every((p) => p.priceKurus === undefined)).toBe(true);
    expect(k.optionGroups.flatMap((g) => g.options).every((o) => o.priceDeltaKurus === undefined)).toBe(true);
    const c = (await req('GET', '/menu', cashier)).json() as PanelMenuResponse;
    expect(c.canEdit).toBe(false);
    expect(c.products[0]!.priceKurus).toBeTypeOf('number');
  });

  it('oturumsuz 401, kurye 403', async () => {
    expectError(await req('GET', '/menu'), 401, 'unauthorized');
    expectError(await req('GET', '/menu', courier), 403, 'forbidden');
  });
});

describe('kategoriler', () => {
  it('oluştur, güncelle, sil (boş), audit', async () => {
    const created = await req('POST', '/categories', manager, { name: '  Tatlılar  ' });
    expect(created.statusCode, created.body).toBe(201);
    const cat = created.json() as { id: string; name: string; sort: number; productCount: number };
    expect(cat).toMatchObject({ name: 'Tatlılar', productCount: 0, isActive: true });
    expect(cat.sort).toBeGreaterThan(4);
    expect(await lastAudit('menu.category_create')).toMatchObject({ tenantId: a.tenantId, entityId: cat.id });

    const upd = await req('PATCH', `/categories/${cat.id}`, a.ownerCookie, { name: 'Tatlı', isActive: false });
    expect(upd.statusCode, upd.body).toBe(200);
    expect(upd.json()).toMatchObject({ name: 'Tatlı', isActive: false });

    const del = await req('DELETE', `/categories/${cat.id}`, a.ownerCookie);
    expect(del.statusCode, del.body).toBe(200);
    const [row] = await ctx.db.select().from(categories).where(eq(categories.id, cat.id));
    expect(row!.deletedAt).not.toBeNull();
    expectError(await req('PATCH', `/categories/${cat.id}`, a.ownerCookie, { name: 'X' }), 404, 'not_found');
  });

  it('ürünü olan kategori silinemez (409)', async () => {
    expectError(await req('DELETE', `/categories/${menuA.catIcecek}`, a.ownerCookie), 409, 'category_not_empty');
  });

  it('doğrulama: boş ad → 400', async () => {
    expectError(await req('POST', '/categories', a.ownerCookie, { name: '   ' }), 400, 'validation_error');
  });

  it('kasiyer ve mutfak kategori yazamaz (403)', async () => {
    expectError(await req('POST', '/categories', cashier, { name: 'X' }), 403, 'forbidden');
    expectError(await req('PATCH', `/categories/${menuA.catPide}`, kitchen, { name: 'X' }), 403, 'forbidden');
  });

  it('yalıtım: başka tenant\'ın kategorisi 404', async () => {
    expectIsolated(await req('PATCH', `/categories/${menuB.catPide}`, a.ownerCookie, { name: 'Ele geçir' }));
    expectError(await req('DELETE', `/categories/${menuB.catEmpty}`, a.ownerCookie), 404, 'not_found');
    const [row] = await ctx.db.select().from(categories).where(eq(categories.id, menuB.catEmpty));
    expect(row!.deletedAt).toBeNull();
  });
});

describe('ürünler', () => {
  let created: PanelProduct;

  it('oluştur: seçenek grupları sıralı bağlanır, audit yazılır', async () => {
    const res = await req('POST', '/products', a.ownerCookie, {
      categoryId: menuA.catPide,
      name: 'Kaşarlı Pide',
      description: 'Bol kaşarlı',
      priceKurus: 22000,
      optionGroupIds: [menuA.gEkstra, menuA.gAci],
    });
    expect(res.statusCode, res.body).toBe(201);
    created = res.json() as PanelProduct;
    expect(created).toMatchObject({ name: 'Kaşarlı Pide', priceKurus: 22000, isActive: true, waRestricted: false, soldOut: false });
    expect(created.optionGroupIds).toEqual([menuA.gEkstra, menuA.gAci]);
    const links = await ctx.db.select().from(productOptionGroups).where(eq(productOptionGroups.productId, created.id));
    expect(links.sort((x, y) => x.sort - y.sort).map((l) => l.groupId)).toEqual([menuA.gEkstra, menuA.gAci]);
    expect(await lastAudit('menu.product_create')).toMatchObject({ entityId: created.id, tenantId: a.tenantId });
  });

  it('güncelle: fiyat, kategori, bağlar; kısıt bayrağı değişimi ayrıca audit', async () => {
    const res = await req('PATCH', `/products/${created.id}`, manager, {
      priceKurus: 23500,
      categoryId: menuA.catIcecek,
      optionGroupIds: [menuA.gAci],
      waRestricted: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    const p = res.json() as PanelProduct;
    expect(p).toMatchObject({ priceKurus: 23500, categoryId: menuA.catIcecek, waRestricted: true, version: 2 });
    expect(p.optionGroupIds).toEqual([menuA.gAci]);
    const upd = await lastAudit('menu.product_update');
    expect((upd!.data as { changes: Record<string, unknown> }).changes.priceKurus).toEqual({ from: 22000, to: 23500 });
    expect(await lastAudit('menu.product_restriction_change')).toMatchObject({ entityId: created.id });

    const off = await req('PATCH', `/products/${created.id}`, a.ownerCookie, { waRestricted: false, waRestrictedReason: 'Yanlış işaretlenmiş' });
    expect(off.statusCode).toBe(200);
    expect((await lastAudit('menu.product_restriction_change'))!.data).toMatchObject({ from: true, to: false, reason: 'Yanlış işaretlenmiş' });
  });

  it('PUT option-groups: bağları değiştirir; başka tenant\'ın grubu 404', async () => {
    const ok = await req('PUT', `/products/${created.id}/option-groups`, a.ownerCookie, { groupIds: [menuA.gEkstra] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as PanelProduct).optionGroupIds).toEqual([menuA.gEkstra]);
    expectError(await req('PUT', `/products/${created.id}/option-groups`, a.ownerCookie, { groupIds: [menuB.gEkstra] }), 404, 'not_found');
    expectError(await req('POST', '/products', a.ownerCookie, { categoryId: menuA.catPide, name: 'X', priceKurus: 100, optionGroupIds: [menuB.gAci] }), 404, 'not_found');
  });

  it('doğrulama: negatif fiyat, geçersiz görsel adresi → 400', async () => {
    expectError(await req('POST', '/products', a.ownerCookie, { categoryId: menuA.catPide, name: 'X', priceKurus: -5 }), 400, 'validation_error');
    expectError(
      await req('POST', '/products', a.ownerCookie, { categoryId: menuA.catPide, name: 'X', priceKurus: 100, imageUrl: 'javascript:alert(1)' }),
      400,
      'validation_error',
    );
  });

  it('başka tenant\'ın kategorisine ürün eklenemez (404)', async () => {
    expectError(await req('POST', '/products', a.ownerCookie, { categoryId: menuB.catPide, name: 'Sızma', priceKurus: 100 }), 404, 'not_found');
  });

  it('kasiyer ürün silemez, düzenleyemez (403)', async () => {
    expectError(await req('DELETE', `/products/${created.id}`, cashier), 403, 'forbidden');
    expectError(await req('PATCH', `/products/${created.id}`, cashier, { priceKurus: 1 }), 403, 'forbidden');
    expectError(await req('POST', '/products', kitchen, { categoryId: menuA.catPide, name: 'X', priceKurus: 100 }), 403, 'forbidden');
  });

  it('yalıtım: başka tenant\'ın ürünü PATCH/DELETE/sold-out → 404 ve değişmez', async () => {
    expectError(await req('PATCH', `/products/${menuB.pide}`, a.ownerCookie, { priceKurus: 1 }), 404, 'not_found');
    expectError(await req('DELETE', `/products/${menuB.pide}`, a.ownerCookie), 404, 'not_found');
    expectError(await req('POST', `/products/${menuB.pide}/sold-out`, a.ownerCookie, { until: 'end_of_day' }), 404, 'not_found');
    expectError(await req('PUT', `/products/${menuB.pide}/option-groups`, a.ownerCookie, { groupIds: [] }), 404, 'not_found');
    const [row] = await ctx.db.select().from(products).where(eq(products.id, menuB.pide));
    expect(row).toMatchObject({ priceKurus: 20000, deletedAt: null, soldOutUntil: null });
  });

  it('sil: yumuşak silme; storefront ve menüde görünmez', async () => {
    const res = await req('DELETE', `/products/${created.id}`, a.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    const [row] = await ctx.db.select().from(products).where(eq(products.id, created.id));
    expect(row!.deletedAt).not.toBeNull();
    const menu = (await req('GET', '/menu', a.ownerCookie)).json() as PanelMenuResponse;
    expect(menu.products.map((p) => p.id)).not.toContain(created.id);
    expectError(await req('DELETE', `/products/${created.id}`, a.ownerCookie), 404, 'not_found');
  });
});

describe('POST /products/:id/sold-out', () => {
  it('kasiyer "bugün tükendi" yapar; gün sonuna kadar; storefront\'a yansır', async () => {
    const res = await req('POST', `/products/${menuA.ayran}/sold-out`, cashier, { until: 'end_of_day' });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { soldOut: boolean; soldOutUntil: string };
    expect(body.soldOut).toBe(true);
    // Europe/Istanbul gece yarısı = 21:00Z
    expect(body.soldOutUntil).toMatch(/T21:00:00\.000Z$/);
    expect(await lastAudit('menu.product_sold_out')).toMatchObject({ entityId: menuA.ayran });

    const store = (await ctx.request({ method: 'GET', url: '/api/v1/store/menu-a' })).json() as StorefrontView;
    expect(store.categories.flatMap((c) => c.products).find((p) => p.id === menuA.ayran)!.soldOut).toBe(true);
  });

  it('şube saatine göre: gece yarısını aşan saatte bir sonraki iş gününün ilk açılışına kadar (gece yarısında sıfırlanmaz)', async () => {
    const setHours = async (opensAt: string, closesAt: string) => {
      await ctx.db.delete(openingHours).where(eq(openingHours.branchId, a.branchId));
      await ctx.db
        .insert(openingHours)
        .values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ tenantId: a.tenantId, branchId: a.branchId, weekday, opensAt, closesAt })));
    };
    await setHours('10:00', '02:00');
    try {
      const before = Date.now();
      const res = await req('POST', `/products/${menuA.lahmacun}/sold-out`, cashier, { until: 'end_of_day' });
      expect(res.statusCode, res.body).toBe(200);
      const until = res.json().soldOutUntil as string;
      // İstanbul 10.00 = 07:00Z (gece yarısı 21:00Z değil)
      expect(until).toMatch(/T07:00:00\.000Z$/);
      expect(Date.parse(until)).toBeGreaterThan(before);
      expect(Date.parse(until) - before).toBeLessThan(2 * 86400_000);
    } finally {
      await setHours('00:00', '00:00');
      await req('POST', `/products/${menuA.lahmacun}/sold-out`, a.ownerCookie, { until: null });
    }
  });

  it('mutfak geri açar (until null)', async () => {
    const res = await req('POST', `/products/${menuA.ayran}/sold-out`, kitchen, { until: null });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ soldOut: false, soldOutUntil: null });
  });

  it('kurye 403, geçersiz gövde 400', async () => {
    expectError(await req('POST', `/products/${menuA.ayran}/sold-out`, courier, { until: 'end_of_day' }), 403, 'forbidden');
    expectError(await req('POST', `/products/${menuA.ayran}/sold-out`, a.ownerCookie, { until: 'tomorrow' }), 400, 'validation_error');
  });
});

describe('seçenek grupları ve seçenekler', () => {
  let group: PanelOptionGroup;

  it('grup + seçeneklerle oluştur', async () => {
    const res = await req('POST', '/option-groups', a.ownerCookie, {
      name: 'Porsiyon',
      internalName: 'Porsiyon — kebap',
      minSelect: 1,
      maxSelect: 1,
      options: [
        { name: 'Tam', priceDeltaKurus: 0 },
        { name: '1,5 porsiyon', priceDeltaKurus: 13000 },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    group = res.json() as PanelOptionGroup;
    expect(group).toMatchObject({ name: 'Porsiyon', minSelect: 1, maxSelect: 1, productCount: 0 });
    expect(group.options.map((o) => [o.name, o.priceDeltaKurus, o.sort])).toEqual([
      ['Tam', 0, 0],
      ['1,5 porsiyon', 13000, 1],
    ]);
  });

  it('min > max ya da zorunlu grupta yetersiz seçenek → 400', async () => {
    expectError(await req('POST', '/option-groups', a.ownerCookie, { name: 'X', minSelect: 3, maxSelect: 1 }), 400, 'validation_error');
    expectError(
      await req('POST', '/option-groups', a.ownerCookie, { name: 'X', minSelect: 2, maxSelect: 3, options: [{ name: 'Tek' }] }),
      400,
      'option_group_invalid',
    );
  });

  it('PATCH: seçenek listesi — güncelle, ekle, listede olmayanı sil', async () => {
    const [tam, bucuk] = group.options;
    const res = await req('PATCH', `/option-groups/${group.id}`, manager, {
      name: 'Porsiyon seçimi',
      maxSelect: 1,
      options: [
        { id: bucuk!.id, name: '1,5 porsiyon', priceDeltaKurus: 14000 },
        { name: 'Yarım', priceDeltaKurus: -4000 },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const g = res.json() as PanelOptionGroup;
    expect(g.name).toBe('Porsiyon seçimi');
    expect(g.options.map((o) => [o.name, o.priceDeltaKurus])).toEqual([
      ['1,5 porsiyon', 14000],
      ['Yarım', -4000],
    ]);
    const [deleted] = await ctx.db.select().from(options).where(eq(options.id, tam!.id));
    expect(deleted!.deletedAt).not.toBeNull();
    group = g;
  });

  it('tekil seçenek CRUD', async () => {
    const add = await req('POST', `/option-groups/${group.id}/options`, a.ownerCookie, { name: 'Çift', priceDeltaKurus: 25000 });
    expect(add.statusCode, add.body).toBe(201);
    const opt = add.json() as { id: string; sort: number };
    expect(opt.sort).toBe(2);
    const upd = await req('PATCH', `/options/${opt.id}`, a.ownerCookie, { isActive: false });
    expect(upd.statusCode, upd.body).toBe(200);
    expect(upd.json()).toMatchObject({ isActive: false, name: 'Çift' });
    expect((await req('DELETE', `/options/${opt.id}`, a.ownerCookie)).statusCode).toBe(200);
    expectError(await req('PATCH', `/options/${opt.id}`, a.ownerCookie, { name: 'X' }), 404, 'not_found');
  });

  it('grubu silmek ürün bağlarını kaldırır', async () => {
    await req('PUT', `/products/${menuA.lahmacun}/option-groups`, a.ownerCookie, { groupIds: [group.id, menuA.gAci] });
    const del = await req('DELETE', `/option-groups/${group.id}`, a.ownerCookie);
    expect(del.statusCode, del.body).toBe(200);
    const links = await ctx.db.select().from(productOptionGroups).where(eq(productOptionGroups.groupId, group.id));
    expect(links).toHaveLength(0);
    const [row] = await ctx.db.select().from(optionGroups).where(eq(optionGroups.id, group.id));
    expect(row!.deletedAt).not.toBeNull();
  });

  it('yalıtım ve yetki: başka tenant\'ın grubu/seçeneği 404; kasiyer 403', async () => {
    expectError(await req('PATCH', `/option-groups/${menuB.gEkstra}`, a.ownerCookie, { name: 'X' }), 404, 'not_found');
    expectError(await req('DELETE', `/option-groups/${menuB.gEkstra}`, a.ownerCookie), 404, 'not_found');
    expectError(await req('POST', `/option-groups/${menuB.gEkstra}/options`, a.ownerCookie, { name: 'X' }), 404, 'not_found');
    expectError(await req('PATCH', `/options/${menuB.optKasar}`, a.ownerCookie, { priceDeltaKurus: 1 }), 404, 'not_found');
    expectError(await req('DELETE', `/options/${menuB.optKasar}`, a.ownerCookie), 404, 'not_found');
    // Seçenek listesinde başka tenant'ın seçenek kimliği
    expectError(
      await req('PATCH', `/option-groups/${menuA.gEkstra}`, a.ownerCookie, { options: [{ id: menuB.optKasar, name: 'Kaşar' }] }),
      404,
      'not_found',
    );
    expectError(await req('POST', '/option-groups', cashier, { name: 'X', minSelect: 0, maxSelect: 1 }), 403, 'forbidden');
    const [row] = await ctx.db.select().from(options).where(eq(options.id, menuB.optKasar));
    expect(row!.priceDeltaKurus).toBe(3000);
  });
});

describe('POST /panel/menu/reorder', () => {
  it('kategori ve ürün sırasını yazar', async () => {
    const res = await req('POST', '/menu/reorder', a.ownerCookie, {
      categories: [menuA.catIcecek, menuA.catPide],
      products: { categoryId: menuA.catPide, ids: [menuA.pide, menuA.lahmacun] },
    });
    expect(res.statusCode, res.body).toBe(200);
    const menu = (await req('GET', '/menu', a.ownerCookie)).json() as PanelMenuResponse;
    expect(menu.categories.slice(0, 2).map((c) => c.id)).toEqual([menuA.catIcecek, menuA.catPide]);
    const pideler = menu.products.filter((p) => p.categoryId === menuA.catPide);
    expect(pideler.slice(0, 2).map((p) => p.id)).toEqual([menuA.pide, menuA.lahmacun]);
  });

  it('başka tenant\'ın kimliği → 404; boş istek 400', async () => {
    expectError(await req('POST', '/menu/reorder', a.ownerCookie, { categories: [menuA.catPide, menuB.catPide] }), 404, 'not_found');
    expectError(await req('POST', '/menu/reorder', a.ownerCookie, { products: { categoryId: menuA.catPide, ids: [menuB.pide] } }), 404, 'not_found');
    expectError(await req('POST', '/menu/reorder', a.ownerCookie, {}), 400, 'validation_error');
  });
});

describe('salt-okunur oturum ve abonelik kilidi', () => {
  it('impersonation (salt-okunur) oturumunda yazma 403 read_only_session, okuma serbest', async () => {
    const ro = await ctx.sessionCookie(a.owner.id, { tenantId: a.tenantId, readOnly: true });
    expect((await req('GET', '/menu', ro)).statusCode).toBe(200);
    expectError(await req('POST', '/categories', ro, { name: 'X' }), 403, 'read_only_session');
    expectError(await req('POST', `/products/${menuA.ayran}/sold-out`, ro, { until: 'end_of_day' }), 403, 'read_only_session');
    const menu = (await req('GET', '/menu', ro)).json() as PanelMenuResponse;
    expect(menu.canEdit).toBe(false);
  });

  it('abonelik salt-okunur (read_only) → menü düzenleme 403 tenant_read_only; tükendi serbest', async () => {
    await ctx.db.update(tenants).set({ lifecycleStage: 'read_only' }).where(eq(tenants.id, a.tenantId));
    expectError(await req('POST', '/categories', a.ownerCookie, { name: 'X' }), 403, 'tenant_read_only');
    expectError(await req('PATCH', `/products/${menuA.pide}`, a.ownerCookie, { priceKurus: 1 }), 403, 'tenant_read_only');
    expect((await req('POST', `/products/${menuA.ayran}/sold-out`, a.ownerCookie, { until: null })).statusCode).toBe(200);
    await ctx.db.update(tenants).set({ lifecycleStage: 'trial' }).where(eq(tenants.id, a.tenantId));
  });
});

describe('tutarlılık', () => {
  it('B tenant\'ının menüsü A\'nın işlemlerinden etkilenmedi', async () => {
    const rows = await ctx.db.select().from(products).where(and(eq(products.tenantId, b.tenantId)));
    expect(rows.find((p) => p.id === menuB.pide)!.priceKurus).toBe(20000);
    expect(rows.every((p) => p.version === 1)).toBe(true);
  });
});
