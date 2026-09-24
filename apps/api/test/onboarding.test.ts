// Dilim 4 — onboarding: adım durumları, WhatsApp'sız başla, test siparişi (onboarding_test, 'new', SSE olayı),
// canlıya geçiş (Kapı 1 / Kapı 2), eksik listesi; yetki ve yalıtım. Kayıttan (signup) başlayan gerçek akış.

import { auditLog, branchEvents, orders, tenantOnboarding, tenants, waAccounts } from '@siparis/db';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieFrom, createTestContext, expectError, type TestContext, type TestTenant } from './helpers';
import { createProduct } from './settings-helpers';

let ctx: TestContext;
let owner: string;
let tenantId: string;
let branchId: string;
let other: TestTenant;

const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, cookie: string, body?: unknown) =>
  ctx.request({ method, url: `/api/v1/panel${url}`, cookie, body });

type Step = { code: string; done: boolean; missing: string[] };
const stepOf = (body: { steps: Step[] }, code: string) => body.steps.find((s) => s.code === code)!;

beforeAll(async () => {
  ctx = await createTestContext();
  const signup = await ctx.request({
    method: 'POST',
    url: '/api/v1/auth/signup',
    headers: { 'x-forwarded-for': '10.44.0.1' },
    body: { businessName: 'Kurulum Pide', ownerName: 'Eray Çaylak', phone: '0532 765 43 21', email: 'eray@kurulum.test', password: 'kurulum123', acceptTerms: true },
  });
  expect(signup.statusCode, signup.body).toBe(201);
  owner = cookieFrom(signup);
  tenantId = signup.json().tenant.id;
  branchId = signup.json().tenant.defaultBranchId;
  other = await ctx.createTenantWithOwner();
});

afterAll(async () => {
  await ctx.close();
});

describe('GET /panel/onboarding', () => {
  it('yeni kayıt: saatler hazır, diğerleri eksik; eksik listesi', async () => {
    const res = await req('GET', '/onboarding', owner);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.steps.map((s: Step) => s.code)).toEqual(['business_info', 'menu', 'hours', 'zones', 'whatsapp', 'test_order', 'go_live']);
    expect(stepOf(body, 'hours').done).toBe(true);
    expect(stepOf(body, 'business_info').done).toBe(false);
    expect(stepOf(body, 'business_info').missing).toEqual(expect.arrayContaining(['VKN/TCKN', 'Unvan ya da ad-soyad']));
    expect(stepOf(body, 'menu').done).toBe(false);
    expect(stepOf(body, 'zones').done).toBe(false);
    expect(stepOf(body, 'whatsapp').done).toBe(false);
    expect(body.canGoLiveWeb).toBe(false);
    expect(body.missingForWeb.length).toBeGreaterThan(0);
    expect(body).toMatchObject({ branchId, lifecycleStage: 'trial', testOrder: null, liveAt: null, webLiveAt: null });
    const [ob] = await ctx.db.select().from(tenantOnboarding).where(eq(tenantOnboarding.tenantId, tenantId));
    expect(ob!.step).toBe('account_created');
  });

  it('canlıya geçiş eksikken 409 ve eksikler; test siparişi menüsüz 409', async () => {
    const res = await req('POST', '/onboarding/go-live', owner);
    expectError(res, 409, 'onboarding_incomplete');
    expect(res.json().error.details.missing.length).toBeGreaterThan(0);
    expectError(await req('POST', '/onboarding/test-order', owner), 409, 'menu_empty');
  });
});

describe('adımları tamamla → test siparişi → canlıya geç', () => {
  it('işletme bilgisi, menü, bölge + WhatsApp\'sız başla', async () => {
    expect(
      (await req('PATCH', '/tenant', owner, { legalName: 'Eray Çaylak', taxNo: '12345678901', address: 'Yozgat Merkez' })).statusCode,
    ).toBe(200);
    expect((await req('PATCH', `/branches/${branchId}`, owner, { addressLine: 'Lise Cad. 5', lat: 39.82, lng: 34.81 })).statusCode).toBe(200);
    await createProduct(ctx.db, tenantId, { name: 'Kuşbaşılı Pide', priceKurus: 22000 });
    expect((await req('POST', '/zones', owner, { name: 'Yakın', kind: 'radius', radiusM: 3000, feeKurus: 0, minOrderKurus: 15000, etaMinutes: 30 })).statusCode).toBe(201);

    const ws = await req('POST', '/onboarding/whatsappless', owner, { enabled: true });
    expect(ws.statusCode, ws.body).toBe(200);
    const body = ws.json();
    expect(stepOf(body, 'business_info').done).toBe(true);
    expect(stepOf(body, 'menu').done).toBe(true);
    expect(stepOf(body, 'zones').done).toBe(true);
    expect(stepOf(body, 'whatsapp').done).toBe(true);
    expect(body.whatsapp).toMatchObject({ connected: false, whatsappless: true });
    expect(body.canGoLiveWeb).toBe(true);
    expect(body.canGoLiveFull).toBe(false);
  });

  it('test siparişi: onboarding_test, new, ilk aktif ürün; order.created olayı; tekrar çağrı aynı siparişi döner', async () => {
    const res = await req('POST', '/onboarding/test-order', owner);
    expect(res.statusCode, res.body).toBe(201);
    const order = res.json().order;
    expect(order).toMatchObject({ status: 'new', testKind: 'onboarding_test', totalKurus: 22000, itemCount: 1, branchId });
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
    expect(row).toMatchObject({ customerPhone: '+905327654321', verificationMethod: 'staff', channel: 'web', fulfillmentType: 'pickup' });
    const evs = await ctx.db
      .select()
      .from(branchEvents)
      .where(and(eq(branchEvents.branchId, branchId), eq(branchEvents.type, 'order.created')))
      .orderBy(desc(branchEvents.seq));
    expect(evs.some((e) => (e.payload as { order: { id: string } }).order.id === order.id)).toBe(true);

    const again = await req('POST', '/onboarding/test-order', owner);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ created: false, order: { id: order.id } });

    const status = (await req('GET', '/onboarding', owner)).json();
    expect(stepOf(status, 'test_order').done).toBe(true);
    expect(status.testOrder).toMatchObject({ id: order.id, status: 'new' });
    const logs = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, 'onboarding.test_order')));
    expect(logs).toHaveLength(1);
  });

  it('test siparişi raporlara girmez', async () => {
    const r = (await req('GET', '/reports/daily', owner)).json();
    expect(r.byStatus).toEqual({});
  });

  it('canlıya geç (WhatsApp\'sız): web_live_at dolar, live_at boş; WhatsApp bağlanınca tam canlı', async () => {
    const res = await req('POST', '/onboarding/go-live', owner);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ webLive: true, live: false, liveAt: null, lifecycleStage: 'trial' });
    expect(res.json().missingForFull.join(' ')).toContain('WhatsApp');
    const [t1] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(t1!.webLiveAt).not.toBeNull();
    expect(t1!.liveAt).toBeNull();

    await ctx.db.insert(waAccounts).values({ tenantId, branchId, provider: 'mock', webhookToken: `wh-${tenantId}`, status: 'connected', displayPhone: '+905550001122' });
    const full = await req('POST', '/onboarding/go-live', owner);
    expect(full.json()).toMatchObject({ webLive: true, live: true, missingForFull: [] });
    const [t2] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(t2!.liveAt).not.toBeNull();
    expect(t2!.webLiveAt!.getTime()).toBe(t1!.webLiveAt!.getTime());
    const status = (await req('GET', '/onboarding', owner)).json();
    expect(stepOf(status, 'go_live').done).toBe(true);
    expect(status.doneCount).toBe(7);
    const [ob] = await ctx.db.select().from(tenantOnboarding).where(eq(tenantOnboarding.tenantId, tenantId));
    expect(ob!.step).toBe('live');
  });
});

describe('yetki ve yalıtım', () => {
  it('yönetici görür ama canlıya geçemez; kasiyer göremez; tenant kapsamı', async () => {
    const manager = await ctx.createStaff(tenantId, 'manager');
    expect((await req('GET', '/onboarding', manager.cookie)).statusCode).toBe(200);
    expectError(await req('POST', '/onboarding/go-live', manager.cookie), 403, 'forbidden');
    const cashier = await ctx.createStaff(tenantId, 'cashier');
    expectError(await req('GET', '/onboarding', cashier.cookie), 403, 'forbidden');
    expectError(await req('POST', '/onboarding/test-order', cashier.cookie), 403, 'forbidden');
    // Diğer tenant kendi durumunu görür; bu tenant'ın test siparişi orada yok
    const o = (await req('GET', '/onboarding', other.ownerCookie)).json();
    expect(o.testOrder).toBeNull();
    expect(o.branchId).toBe(other.branchId);
    expectError(await req('POST', '/onboarding/whatsappless', owner, { enabled: 'evet' }), 400, 'validation_error');
  });
});
