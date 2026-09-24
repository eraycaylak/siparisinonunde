// Dilim 4 — müşteriler: liste (maskeli, arama, sayfalama), profil (tam telefon), not/kara liste, sipariş geçmişi,
// KVKK dışa aktarma ve silme/anonimleştirme (08 §2.10); yetki ve yalıtım.

import { localDateString } from '@siparis/core';
import { auditLog, conversations, customerAddresses, customers, messages, orders, tenants, waAccounts } from '@siparis/db';
import { and, eq, isNull } from 'drizzle-orm';
import { signCustomerCookie } from '../src/services/storefront/cookies';
import { findTenantCustomer } from '../src/services/storefront/session';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, expectError, type TestContext, type TestTenant } from './helpers';
import { createCustomer, insertOrder } from './settings-helpers';

let ctx: TestContext;
let a: TestTenant;
let b: TestTenant;
let manager: { cookie: string };
let cashier: { cookie: string };
let kitchen: { cookie: string };
let ayse: typeof customers.$inferSelect;
let foreign: typeof customers.$inferSelect;

const req = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie: string, body?: unknown) =>
  ctx.request({ method, url: `/api/v1/panel${url}`, cookie, body });

beforeAll(async () => {
  ctx = await createTestContext();
  a = await ctx.createTenantWithOwner();
  b = await ctx.createTenantWithOwner();
  manager = await ctx.createStaff(a.tenantId, 'manager');
  cashier = await ctx.createStaff(a.tenantId, 'cashier');
  kitchen = await ctx.createStaff(a.tenantId, 'kitchen');
  ayse = await createCustomer(ctx.db, a.tenantId, { name: 'Ayşe Yılmaz', phone: '+905321112233', bsuid: 'TR.bsuid.1', withAddress: true, notes: 'Acısız sever' });
  for (let i = 0; i < 25; i++) await createCustomer(ctx.db, a.tenantId, { name: `Müşteri ${i}`, phone: `+90533000${String(i).padStart(4, '0')}` });
  foreign = await createCustomer(ctx.db, b.tenantId, { name: 'Başka Tenant', phone: '+905321112233' });
  const now = Date.now();
  await insertOrder(ctx.db, { tenantId: a.tenantId, branchId: a.branchId, customerId: ayse.id, totalKurus: 30000, itemName: 'Lahmacun', quantity: 3, placedAt: new Date(now - 3 * 86400000) });
  await insertOrder(ctx.db, { tenantId: a.tenantId, branchId: a.branchId, customerId: ayse.id, totalKurus: 10000, itemName: 'Ayran', placedAt: new Date(now - 86400000) });
  await insertOrder(ctx.db, { tenantId: a.tenantId, branchId: a.branchId, customerId: ayse.id, totalKurus: 99900, testKind: 'onboarding_test' });
  await ctx.db.update(customers).set({ orderCount: 2, lastOrderAt: new Date(now - 86400000) }).where(eq(customers.id, ayse.id));
});

afterAll(async () => {
  await ctx.close();
});

describe('liste ve arama', () => {
  it('telefon maskeli; son siparişe göre sıralı; sayfalama', async () => {
    const res = await req('GET', '/customers?limit=10', cashier.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const first = res.json();
    expect(first.items).toHaveLength(10);
    expect(first.items[0]).toMatchObject({ id: ayse.id, name: 'Ayşe Yılmaz', phoneMasked: '0*** *** 22 33', totalSpentKurus: 40000, avgBasketKurus: 20000, hasNotes: true, hasWhatsapp: true });
    expect(JSON.stringify(first)).not.toContain('5321112233');
    expect(first.nextCursor).toBeTruthy();
    const seen = new Set<string>(first.items.map((i: { id: string }) => i.id));
    let cursor = first.nextCursor as string | undefined;
    while (cursor) {
      const page = await req('GET', `/customers?limit=10&cursor=${encodeURIComponent(cursor)}`, cashier.cookie);
      for (const i of page.json().items) seen.add(i.id);
      cursor = page.json().nextCursor;
    }
    expect(seen.size).toBe(26);
    expect(seen.has(foreign.id)).toBe(false);
  });

  it('ada ve telefonun son hanelerine göre arama', async () => {
    const byName = await req('GET', `/customers?q=${encodeURIComponent('ayşe')}`, cashier.cookie);
    expect(byName.json().items.map((i: { id: string }) => i.id)).toEqual([ayse.id]);
    const byPhone = await req('GET', '/customers?q=2233', cashier.cookie);
    expect(byPhone.json().items.map((i: { id: string }) => i.id)).toEqual([ayse.id]);
    const full = await req('GET', `/customers?q=${encodeURIComponent('0532 111 22 33')}`, cashier.cookie);
    expect(full.json().items.map((i: { id: string }) => i.id)).toEqual([ayse.id]);
  });

  it('yetki: mutfak 403, oturumsuz 401', async () => {
    expectError(await req('GET', '/customers', kitchen.cookie), 403, 'forbidden');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/panel/customers' }), 401, 'unauthorized');
  });
});

describe('profil, not, kara liste, siparişler', () => {
  it('detay: tam telefon, adres, istatistik (test siparişi hariç), en çok sipariş edilenler', async () => {
    const res = await req('GET', `/customers/${ayse.id}`, cashier.cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      phone: '+905321112233',
      notes: 'Acısız sever',
      orderCount: 2,
      totalSpentKurus: 40000,
      avgBasketKurus: 20000,
      openOrderCount: 0,
    });
    expect(res.json().addresses[0]).toMatchObject({ neighborhood: 'Aşağınohutlu', addressLine: 'Lise Cad. No: 12 D: 3' });
    expect(res.json().topProducts[0]).toEqual({ name: 'Lahmacun', quantity: 3 });
  });

  it('not ve kara liste (sebep zorunlu); audit', async () => {
    const note = await req('PATCH', `/customers/${ayse.id}`, cashier.cookie, { notes: 'Zili çalmayın' });
    expect(note.statusCode, note.body).toBe(200);
    expect(note.json().notes).toBe('Zili çalmayın');
    expectError(await req('PATCH', `/customers/${ayse.id}`, cashier.cookie, { isBlocked: true }), 400, 'validation_error');
    expectError(await req('PATCH', `/customers/${ayse.id}`, cashier.cookie, { notes: 'x'.repeat(141) }), 400, 'validation_error');
    const blocked = await req('PATCH', `/customers/${ayse.id}`, cashier.cookie, { isBlocked: true, blockReason: 'Sahte sipariş verdi' });
    expect(blocked.json().isBlocked).toBe(true);
    const unblocked = await req('PATCH', `/customers/${ayse.id}`, manager.cookie, { isBlocked: false });
    expect(unblocked.json().isBlocked).toBe(false);
    const logs = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, a.tenantId), eq(auditLog.action, 'customer.update')));
    expect(logs.length).toBe(3);
    expect(logs.some((l) => (l.data as { blockReason?: string }).blockReason === 'Sahte sipariş verdi')).toBe(true);
  });

  it('sipariş geçmişi (test siparişi hariç)', async () => {
    const res = await req('GET', `/customers/${ayse.id}/orders`, cashier.cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items).toHaveLength(2);
    expect(res.json().items[0]).toMatchObject({ totalKurus: 10000, items: [{ name: 'Ayran', quantity: 1 }] });
  });

  it('yalıtım: başka tenant\'ın müşterisi 404', async () => {
    expectError(await req('GET', `/customers/${foreign.id}`, a.ownerCookie), 404, 'not_found');
    expectError(await req('PATCH', `/customers/${foreign.id}`, a.ownerCookie, { notes: 'x' }), 404, 'not_found');
    expectError(await req('GET', `/customers/${foreign.id}/orders`, a.ownerCookie), 404, 'not_found');
    expectError(await req('POST', `/customers/${foreign.id}/export`, a.ownerCookie), 404, 'not_found');
    expectError(await req('POST', `/customers/${foreign.id}/erase`, a.ownerCookie), 404, 'not_found');
  });
});

describe('KVKK: dışa aktarma ve silme', () => {
  let convId: string;

  beforeAll(async () => {
    const [acc] = await ctx.db
      .insert(waAccounts)
      .values({ tenantId: a.tenantId, branchId: a.branchId, provider: 'mock', webhookToken: `wh-${a.tenantId}`, status: 'connected', displayPhone: '+905550000009' })
      .returning();
    const [conv] = await ctx.db.insert(conversations).values({ tenantId: a.tenantId, branchId: a.branchId, waAccountId: acc!.id, customerId: ayse.id }).returning();
    convId = conv!.id;
    await ctx.db.insert(messages).values({ tenantId: a.tenantId, conversationId: convId, direction: 'in', kind: 'text', body: 'Adresim Lise Cad. 12' });
  });

  it('dışa aktarma: yalnız sahip/yönetici; JSON içerik ve audit', async () => {
    expectError(await req('POST', `/customers/${ayse.id}/export`, cashier.cookie), 403, 'forbidden');
    const res = await req('POST', `/customers/${ayse.id}/export`, manager.cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const data = res.json();
    expect(data.customer).toMatchObject({ name: 'Ayşe Yılmaz', phone: '+905321112233' });
    expect(data.addresses).toHaveLength(1);
    expect(data.orders).toHaveLength(2);
    expect(data.orders[0].items[0]).toMatchObject({ name: 'Lahmacun', quantity: 3 });
    expect(data.messages[0]).toMatchObject({ direction: 'in', body: 'Adresim Lise Cad. 12' });
    const logs = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, a.tenantId), eq(auditLog.action, 'customer.export')));
    expect(logs).toHaveLength(1);
  });

  it('açık siparişi varken silinemez (409)', async () => {
    const open = await insertOrder(ctx.db, { tenantId: a.tenantId, branchId: a.branchId, customerId: ayse.id, status: 'accepted', totalKurus: 5000 });
    expectError(await req('POST', `/customers/${ayse.id}/erase`, a.ownerCookie), 409, 'open_orders');
    await ctx.db.update(orders).set({ status: 'delivered', deliveredAt: new Date() }).where(eq(orders.id, open.id));
  });

  it('silme: kimlik/adres/mesaj anonim, sipariş tutarları korunur, aramada çıkmaz; kasiyer yapamaz', async () => {
    expectError(await req('POST', `/customers/${ayse.id}/erase`, cashier.cookie), 403, 'forbidden');
    const before = await ctx.db.select({ total: orders.totalKurus }).from(orders).where(eq(orders.customerId, ayse.id));
    const res = await req('POST', `/customers/${ayse.id}/erase`, a.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, orderCount: 4, messageCount: 1 });

    const [c] = await ctx.db.select().from(customers).where(eq(customers.id, ayse.id));
    expect(c).toMatchObject({ name: 'Silinmiş müşteri', phoneE164: null, waBsuid: null, notes: null });
    expect(await ctx.db.select().from(customerAddresses).where(eq(customerAddresses.customerId, ayse.id))).toHaveLength(0);
    const ords = await ctx.db.select().from(orders).where(eq(orders.customerId, ayse.id));
    expect(ords.every((o) => o.customerName === 'Anonim müşteri' && o.customerPhone === null && o.addressLine === null)).toBe(true);
    expect(ords.map((o) => o.totalKurus).sort()).toEqual(before.map((x) => x.total).sort());
    const [m] = await ctx.db.select().from(messages).where(eq(messages.conversationId, convId));
    expect(m!.body).toBeNull();

    const search = await req('GET', '/customers?q=2233', a.ownerCookie);
    expect(search.json().items).toHaveLength(0);
    const all = await req('GET', '/customers?limit=100', a.ownerCookie);
    expect(all.json().items.map((i: { id: string }) => i.id)).not.toContain(ayse.id);
    expectError(await req('GET', `/customers/${ayse.id}`, a.ownerCookie), 404, 'not_found');
    const logs = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, a.tenantId), eq(auditLog.action, 'customer.erase')));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0]!.data)).not.toContain('5321112233');
    // Başka tenant'taki aynı telefonlu kayıt etkilenmez
    const [f] = await ctx.db.select().from(customers).where(eq(customers.id, foreign.id));
    expect(f!.phoneE164).toBe('+905321112233');
  });

  it('silinen müşteri: rapor ciro/sayıları korunur (mali kayıt); sipariş kartı/detayında ve storefront "hatırla" çerezinde müşteri yok', async () => {
    // Rapor: dünkü (anonimleşmiş) sipariş ciroda kalır
    const yesterday = localDateString(new Date(Date.now() - 86400000));
    const daily = await req('GET', `/reports/daily?date=${yesterday}`, a.ownerCookie);
    expect(daily.statusCode, daily.body).toBe(200);
    expect(daily.json()).toMatchObject({ deliveredCount: 1, revenueKurus: 10000 });
    // Müşteri sayımı: silinen müşteri listede yok (26 → 25)
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await req('GET', `/customers?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, a.ownerCookie);
      for (const i of page.json().items) seen.add(i.id);
      cursor = page.json().nextCursor;
    } while (cursor);
    expect(seen.size).toBe(25);
    expect(seen.has(ayse.id)).toBe(false);

    // Sipariş detayı: müşteri bölümü (sayaç, geçmiş) gösterilmez
    const [ord] = await ctx.db.select().from(orders).where(and(eq(orders.customerId, ayse.id), isNull(orders.testKind))).limit(1);
    const detail = await req('GET', `/orders/${ord!.id}`, a.ownerCookie);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().customer).toBeNull();
    expect(detail.json().customerName).toBe('Anonim müşteri');

    // Storefront: silinen müşterinin imzalı "Bu cihazda hatırla" çerezi tanınmaz
    const [t] = await ctx.db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, a.tenantId));
    const session = await ctx.request({
      method: 'POST',
      url: `/api/v1/store/${t!.slug}/session`,
      body: {},
      headers: { cookie: `sf_cust_${t!.slug}=${signCustomerCookie(ctx.config.SESSION_SECRET, ayse.id)}` },
    });
    expect(session.statusCode, session.body).toBe(200);
    expect(session.json()).toMatchObject({ customer: null, lastOrder: null });
    expect(await findTenantCustomer(ctx.db, a.tenantId, ayse.id)).toBeNull();
    const [other] = await ctx.db.select().from(customers).where(and(eq(customers.tenantId, a.tenantId), eq(customers.name, 'Müşteri 1')));
    expect((await findTenantCustomer(ctx.db, a.tenantId, other!.id))?.id).toBe(other!.id);
  });
});
