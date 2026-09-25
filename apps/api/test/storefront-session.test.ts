// POST/DELETE /api/v1/store/:slug/session — Akış A link token'ı → sf_link_<slug> çerezi, "Son siparişin" (03 §3.4).

import type { StoreSessionView } from '@siparis/core/menu/contracts';
import { customerAddresses, customers, orderItemOptions, orderItems, products, storefrontLinkTokens } from '@siparis/db';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomToken, sha256Hex } from '../src/lib/tokens';
import { signCustomerCookie, verifyCustomerCookie } from '../src/services/storefront/cookies';
import { createTestContext, expectError, type TestContext, type TestTenant } from './helpers';
import { seedMenu, type SeededMenu } from './menu-helpers';

let ctx: TestContext;
let a: TestTenant;
let b: TestTenant;
let menu: SeededMenu;
let customerId: string;
let otherCustomerId: string;

const SLUG = 'oturum-pide';

async function createLinkToken(tenantId: string, custId: string | null, expiresInMs = 2 * 3600_000) {
  const token = randomToken(32);
  const [row] = await ctx.db
    .insert(storefrontLinkTokens)
    .values({ tenantId, tokenHash: sha256Hex(token), customerId: custId, expiresAt: new Date(Date.now() + expiresInMs) })
    .returning();
  return { token, row: row! };
}

function cookieOf(res: LightMyRequestResponse, name: string) {
  return res.cookies.find((c) => c.name === name);
}

async function postSession(body: unknown, cookie?: string) {
  const res = await ctx.request({ method: 'POST', url: `/api/v1/store/${SLUG}/session`, body, ...(cookie ? { cookie } : {}) });
  return { res, body: res.json() as StoreSessionView };
}

beforeAll(async () => {
  ctx = await createTestContext();
  a = await ctx.createTenantWithOwner({ name: 'Oturum Pide', slug: SLUG });
  b = await ctx.createTenantWithOwner({ name: 'Başka', slug: 'baska-isletme' });
  menu = await seedMenu(ctx, a.tenantId, a.branchId);
  const [c] = await ctx.db
    .insert(customers)
    .values({ tenantId: a.tenantId, name: 'Ayşe', phoneE164: '+905321234512', waBsuid: 'bsuid-ayse' })
    .returning();
  customerId = c!.id;
  const [c2] = await ctx.db.insert(customers).values({ tenantId: b.tenantId, name: 'Başkası', phoneE164: '+905329998877' }).returning();
  otherCustomerId = c2!.id;

  // Son teslim edilen sipariş: Kıymalı Pide (Acılı + Kaşar) ×2, Pasif Ürün ×1 (artık satışta değil), Ayran ×1
  const order = await ctx.createOrder({ tenantId: a.tenantId, branchId: a.branchId, status: 'delivered', totalKurus: 50000, extra: { customerId } });
  await ctx.db.delete(orderItems).where(eq(orderItems.orderId, order.id));
  const [pideItem] = await ctx.db
    .insert(orderItems)
    .values([
      { tenantId: a.tenantId, orderId: order.id, productId: menu.pide, name: 'Kıymalı Pide', unitPriceKurus: 18000, optionsUnitKurus: 3000, quantity: 2, lineTotalKurus: 42000, sort: 0 },
    ])
    .returning();
  await ctx.db.insert(orderItems).values([
    { tenantId: a.tenantId, orderId: order.id, productId: menu.inactiveProduct, name: 'Pasif Ürün', unitPriceKurus: 1000, quantity: 1, lineTotalKurus: 1000, sort: 1 },
    { tenantId: a.tenantId, orderId: order.id, productId: menu.ayran, name: 'Ayran', unitPriceKurus: 3000, quantity: 1, lineTotalKurus: 3000, sort: 2 },
  ]);
  await ctx.db.insert(orderItemOptions).values([
    { tenantId: a.tenantId, orderItemId: pideItem!.id, optionId: menu.optAcili, groupName: 'Acı', optionName: 'Acılı', priceDeltaKurus: 0 },
    { tenantId: a.tenantId, orderItemId: pideItem!.id, optionId: menu.optKasar, groupName: 'Ekstralar', optionName: 'Kaşar', priceDeltaKurus: 3000 },
    { tenantId: a.tenantId, orderItemId: pideItem!.id, optionId: menu.optInactive, groupName: 'Ekstralar', optionName: 'Sucuk', priceDeltaKurus: 4000 },
  ]);
  // Daha eski ve iptal edilmiş siparişler "son sipariş" sayılmaz
  await ctx.createOrder({ tenantId: a.tenantId, branchId: a.branchId, status: 'cancelled', extra: { customerId, cancelledBy: 'customer', cancelReason: 'customer_request' } });
});

afterAll(async () => {
  await ctx.close();
});

describe('POST /store/:slug/session', () => {
  it('geçerli token: müşteri (maskeli telefon), sf_link çerezi, exchanged_at ve first_opened_at dolar', async () => {
    const { token, row } = await createLinkToken(a.tenantId, customerId);
    const { res, body } = await postSession({ linkToken: token });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(body.linkStatus).toBe('active');
    expect(body.customer).toEqual({ name: 'Ayşe', phoneMasked: '0*** *** 45 12' });

    const c = cookieOf(res, `sf_link_${SLUG}`);
    expect(c?.value).toBe(token);
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe('Lax');
    expect(c?.path).toBe('/');
    const ttl = new Date(c!.expires!).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(2 * 3600_000 - 60_000);
    expect(ttl).toBeLessThanOrEqual(2 * 3600_000 + 1000);

    const [after] = await ctx.db.select().from(storefrontLinkTokens).where(eq(storefrontLinkTokens.id, row.id));
    expect(after!.exchangedAt).not.toBeNull();
    expect(after!.firstOpenedAt).not.toBeNull();

    // İkinci takas first_opened_at'i değiştirmez (önizleme/prefetch token'ı yakmaz)
    const again = await postSession({ linkToken: token });
    expect(again.body.linkStatus).toBe('active');
    const [after2] = await ctx.db.select().from(storefrontLinkTokens).where(eq(storefrontLinkTokens.id, row.id));
    expect(after2!.firstOpenedAt!.getTime()).toBe(after!.firstOpenedAt!.getTime());
  });

  it('son teslim edilen sipariş: yalnız hâlâ aktif ürün ve seçenekler, güncel toplam', async () => {
    const { token } = await createLinkToken(a.tenantId, customerId);
    const { body } = await postSession({ linkToken: token });
    expect(body.lastOrderSource).toBe('link');
    expect(body.lastOrder).not.toBeNull();
    expect(body.lastOrder!.items).toEqual([
      { productId: menu.pide, name: 'Kıymalı Pide', quantity: 2, optionIds: [menu.optAcili, menu.optKasar] },
      { productId: menu.ayran, name: 'Ayran', quantity: 1, optionIds: [] },
    ]);
    // Güncel fiyat: (20000 + 0 + 3000) × 2 + 3000
    expect(body.lastOrder!.totalKurus).toBe(49000);
    expect(typeof body.lastOrder!.createdAt).toBe('string');
  });

  it('çerezle yeniden açılış: gövdede token yokken çerezdeki bağlantı kullanılır', async () => {
    const { token } = await createLinkToken(a.tenantId, customerId);
    const { body } = await postSession({}, `sf_link_${SLUG}=${token}`);
    expect(body.linkStatus).toBe('active');
    expect(body.customer?.name).toBe('Ayşe');
  });

  it('süresi dolmuş token → 200, müşteri yok, linkStatus expired, çerez yazılmaz', async () => {
    const { token } = await createLinkToken(a.tenantId, customerId, -60_000);
    const { res, body } = await postSession({ linkToken: token });
    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ customer: null, lastOrder: null, linkStatus: 'expired' });
    expect(cookieOf(res, `sf_link_${SLUG}`)).toBeUndefined();
  });

  it('bilinmeyen token ve başka işletmenin token\'ı → müşteri yok (sessizce)', async () => {
    const unknown = await postSession({ linkToken: randomToken(32) });
    expect(unknown.res.statusCode).toBe(200);
    expect(unknown.body.customer).toBeNull();
    const foreign = await createLinkToken(b.tenantId, otherCustomerId);
    const res = await postSession({ linkToken: foreign.token });
    expect(res.body).toMatchObject({ customer: null, linkStatus: 'expired' });
  });

  it('süresi dolmuş çerez temizlenir', async () => {
    const { token } = await createLinkToken(a.tenantId, customerId, -60_000);
    const { res, body } = await postSession({}, `sf_link_${SLUG}=${token}`);
    expect(body.linkStatus).toBe('expired');
    const c = cookieOf(res, `sf_link_${SLUG}`);
    expect(c?.value).toBe('');
  });

  it('gövdesiz istek → bağlam yok', async () => {
    const res = await ctx.request({ method: 'POST', url: `/api/v1/store/${SLUG}/session` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ customer: null, lastOrder: null, linkStatus: 'none' });
  });

  it('sf_cust imzalı çerezi ("bu cihazda hatırla") → son sipariş; imza bozuksa yok sayılır', async () => {
    const signed = signCustomerCookie(ctx.config.SESSION_SECRET, customerId);
    const ok = await postSession({}, `sf_cust_${SLUG}=${signed}`);
    expect(ok.body.customer).toBeNull();
    expect(ok.body.lastOrderSource).toBe('device');
    expect(ok.body.lastOrder?.items).toHaveLength(2);

    const tampered = `${customerId}.${'0'.repeat(64)}`;
    const bad = await postSession({}, `sf_cust_${SLUG}=${tampered}`);
    expect(bad.body.lastOrder).toBeNull();

    // Başka tenant'ın müşterisi için imzalı çerez bu işletmede işe yaramaz
    const foreign = signCustomerCookie(ctx.config.SESSION_SECRET, otherCustomerId);
    const iso = await postSession({}, `sf_cust_${SLUG}=${foreign}`);
    expect(iso.body.lastOrder).toBeNull();
  });

  it('ön dolum: cihaz çerezinde ad, tam telefon ve son adres; WhatsApp bağlantısında maskeli telefon; başka tenant yok', async () => {
    await ctx.db.insert(customerAddresses).values([
      { tenantId: a.tenantId, customerId, neighborhood: 'Tekke', addressLine: 'Eski Sk. 1', directions: null, lastUsedAt: new Date(Date.now() - 86_400_000) },
      { tenantId: a.tenantId, customerId, neighborhood: 'Medrese', addressLine: 'Lise Cad. 12 D:3', directions: 'Eczanenin üstü', lastUsedAt: new Date() },
    ]);
    const device = await postSession({}, `sf_cust_${SLUG}=${signCustomerCookie(ctx.config.SESSION_SECRET, customerId)}`);
    expect(device.body.prefill).toEqual({
      source: 'device',
      name: 'Ayşe',
      phone: '+905321234512',
      phoneMasked: '0*** *** 45 12',
      phoneKnown: true,
      address: { neighborhood: 'Medrese', addressLine: 'Lise Cad. 12 D:3', directions: 'Eczanenin üstü' },
    });
    const { token } = await createLinkToken(a.tenantId, customerId);
    const link = await postSession({ linkToken: token });
    expect(link.body.prefill).toMatchObject({ source: 'link', name: 'Ayşe', phone: null, phoneMasked: '0*** *** 45 12', phoneKnown: true });
    expect(link.body.prefill?.address?.neighborhood).toBe('Medrese');
    expect((await postSession({})).body.prefill).toBeNull();
    const foreign = await postSession({}, `sf_cust_${SLUG}=${signCustomerCookie(ctx.config.SESSION_SECRET, otherCustomerId)}`);
    expect(foreign.body.prefill).toBeNull();
  });

  it('sf_cust doğrulayıcı olası imza varyantlarını kabul eder, sahtesini reddeder', () => {
    const secret = ctx.config.SESSION_SECRET;
    expect(verifyCustomerCookie(secret, signCustomerCookie(secret, customerId))).toBe(customerId);
    const plain = `${customerId}.${createHmac('sha256', secret).update(customerId).digest('base64url')}`;
    expect(verifyCustomerCookie(secret, plain)).toBe(customerId);
    expect(verifyCustomerCookie('baska-sir-0123456789', signCustomerCookie(secret, customerId))).toBeNull();
    expect(verifyCustomerCookie(secret, 'bozuk')).toBeNull();
  });

  it('bilinmeyen slug → 404 store_not_found', async () => {
    const res = await ctx.request({ method: 'POST', url: '/api/v1/store/yok-boyle/session', body: {} });
    expectError(res, 404, 'store_not_found');
  });

  it('müşterisi olmayan token: bağlantı aktif, müşteri ve son sipariş yok', async () => {
    const { token } = await createLinkToken(a.tenantId, null);
    const { body } = await postSession({ linkToken: token });
    expect(body).toMatchObject({ linkStatus: 'active', customer: null, lastOrder: null });
  });

  it('sonradan pasifleşen ürün son siparişten düşer', async () => {
    await ctx.db.update(products).set({ isActive: false }).where(eq(products.id, menu.ayran));
    const { token } = await createLinkToken(a.tenantId, customerId);
    const { body } = await postSession({ linkToken: token });
    expect(body.lastOrder!.items.map((i) => i.name)).toEqual(['Kıymalı Pide']);
    await ctx.db.update(products).set({ isActive: true }).where(eq(products.id, menu.ayran));
  });
});

describe('DELETE /store/:slug/session', () => {
  it('"Ben değilim": iki storefront çerezini de siler', async () => {
    const res = await ctx.request({ method: 'DELETE', url: `/api/v1/store/${SLUG}/session`, cookie: `sf_link_${SLUG}=abc` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const link = cookieOf(res, `sf_link_${SLUG}`);
    const cust = cookieOf(res, `sf_cust_${SLUG}`);
    expect(link?.value).toBe('');
    expect(cust?.value).toBe('');
    expect(new Date(link!.expires!).getTime()).toBeLessThan(Date.now());
  });

  it('bilinmeyen slug → 404', async () => {
    expectError(await ctx.request({ method: 'DELETE', url: '/api/v1/store/yok-boyle/session' }), 404, 'store_not_found');
  });
});
