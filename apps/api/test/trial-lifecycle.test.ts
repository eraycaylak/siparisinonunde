// İş modeli kapıları (00 §9, 05 §A.2.1): deneme bitişi uygulanıyor mu, salt-okunur işletme sipariş alıyor mu
// (vitrin ucu VE telefon siparişi ucu), kayıt kapısı kapalıyken kayıt reddediliyor mu (denetim 04.10.2026
// B10 + B13, ardından çekişmeli son denetim (B)).

import type { StorefrontView } from '@siparis/core/menu/contracts';
import { auditLog, featureFlags, orders, subscriptions, tenants } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enforceTrialEnds } from '../src/services/admin/trial';
import { createTestContext, expectError, type TestContext, type TestTenant } from './helpers';
import { orderBody, placeOrder, setupStore } from './orders-helpers';

const DAY = 86_400_000;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

async function getStore(slug: string) {
  const res = await ctx.request({ method: 'GET', url: `/api/v1/store/${slug}` });
  return { res, body: res.json() as StorefrontView };
}

async function stageOf(tenantId: string) {
  const [t] = await ctx.db.select({ stage: tenants.lifecycleStage }).from(tenants).where(eq(tenants.id, tenantId));
  return t!.stage;
}

async function subStatusOf(tenantId: string) {
  const [s] = await ctx.db.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
  return s?.status ?? null;
}

/** Denemesi `days` gün önce bitmiş işletme (hem tenant hem abonelik satırı, kayıttaki gibi). */
async function withExpiredTrial(t: TestTenant, days: number) {
  const trialEndsAt = new Date(Date.now() - days * DAY);
  await ctx.db.update(tenants).set({ trialEndsAt }).where(eq(tenants.id, t.tenantId));
  await ctx.db.update(subscriptions).set({ trialEndsAt }).where(eq(subscriptions.tenantId, t.tenantId));
  return trialEndsAt;
}

describe('salt-okunur işletme sipariş almaz (00 §9)', () => {
  it('vitrin orderingEnabled=false ve "duraklatıldı" durumuyla döner (müşteriye teknik hata gösterilmez)', async () => {
    const t = await ctx.createTenantWithOwner({ name: 'Salt Okunur Pide', slug: 'salt-okunur-pide' });

    const acik = await getStore(t.slug);
    expect(acik.res.statusCode, acik.res.body).toBe(200);
    expect(acik.body.orderingEnabled).toBe(true);
    expect(acik.body.branch.orderingState).toBe('open');

    await ctx.db.update(tenants).set({ lifecycleStage: 'read_only' }).where(eq(tenants.id, t.tenantId));
    const kapali = await getStore(t.slug);
    // Vitrin açık kalır (menü okunur), yalnız sipariş alma kapanır: web tarafı bu iki alanı
    // "Şu an online sipariş alınmıyor. Sipariş için lütfen işletmeyi arayın." bandına çevirir.
    expect(kapali.res.statusCode, kapali.res.body).toBe(200);
    expect(kapali.body.orderingEnabled).toBe(false);
    expect(kapali.body.branch.orderingState).toBe('paused');
    expect(kapali.body.live).toBe(true);
  });

  it('askı ve kapanış aşamaları da kapalı kalır', async () => {
    const t = await ctx.createTenantWithOwner({ slug: 'aski-kapanis' });
    for (const stage of ['suspended', 'churned'] as const) {
      await ctx.db.update(tenants).set({ lifecycleStage: stage }).where(eq(tenants.id, t.tenantId));
      const { body } = await getStore(t.slug);
      expect(body.orderingEnabled, stage).toBe(false);
    }
  });

  it('ödeme gecikmesi (past_due) sipariş almayı durdurmaz — dunning G..G+10', async () => {
    const t = await ctx.createTenantWithOwner({ slug: 'odeme-gecikti' });
    await ctx.db.update(tenants).set({ lifecycleStage: 'past_due' }).where(eq(tenants.id, t.tenantId));
    const { body } = await getStore(t.slug);
    expect(body.orderingEnabled).toBe(true);
  });

  // Vitrinin düğmeyi gizlemesi yetmez: doğrudan API çağrısıyla sipariş geçmemeli (store-context.ts
  // tenantOrderingBlocked → ORDERING_BLOCKED_STAGES; fail-closed)
  it('read_only işletmede POST /store/:slug/orders → 409 ordering_closed', async () => {
    const s = await setupStore(ctx, { wa: 'connected', slug: 'salt-okunur-siparis-ucu' });
    await ctx.db.update(tenants).set({ lifecycleStage: 'read_only' }).where(eq(tenants.id, s.tenantId));
    expectError(await placeOrder(ctx, s.slug, orderBody(s)), 409, 'ordering_closed');

    // Ödeme alınıp aşama geri açılınca aynı sipariş geçer (kapının tek sebebi aşama)
    await ctx.db.update(tenants).set({ lifecycleStage: 'trial' }).where(eq(tenants.id, s.tenantId));
    const ok = await placeOrder(ctx, s.slug, orderBody(s));
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

// Denetim 04.10.2026 çekişmeli son denetim (B): vitrin "lütfen arayın" derken telefon siparişi ucu kapısızdı,
// yani talebin tamamı kapısız yoldan akabiliyordu ve iş modeli kapısı tamamen atlanabiliyordu.
describe('salt-okunur işletmede telefon siparişi (Akış E) de kaydedilemez', () => {
  it('POST /panel/orders/manual → 403 tenant_read_only; ödeme alınınca aynı sipariş geçer', async () => {
    const s = await setupStore(ctx, { wa: 'connected', slug: 'salt-okunur-telefon' });
    const cashier = (await ctx.createStaff(s.tenantId, 'cashier')).cookie;
    const body = () => ({
      items: [{ productId: s.pideId, quantity: 1, optionIds: [s.acisizId] }],
      fulfillmentType: 'delivery',
      neighborhood: 'Tekke',
      customerName: 'Telefon Müşteri',
      customerPhone: '0532 700 10 20',
      addressLine: 'Kale Sk. 4',
      paymentMethod: 'cash_on_delivery',
    });
    const manual = () => ctx.request({ method: 'POST', url: '/api/v1/panel/orders/manual', cookie: cashier, body: body() });

    await ctx.db.update(tenants).set({ lifecycleStage: 'read_only' }).where(eq(tenants.id, s.tenantId));
    expectError(await manual(), 403, 'tenant_read_only');
    // Kapı yazmayı GERÇEKTEN engelledi mi (403 dönüp satır yazmak en kötüsü olurdu)
    const yazilan = await ctx.db.select({ id: orders.id }).from(orders).where(eq(orders.tenantId, s.tenantId));
    expect(yazilan).toHaveLength(0);

    // Askı ve kapanış aşamaları da kapalı
    for (const stage of ['suspended', 'churned'] as const) {
      await ctx.db.update(tenants).set({ lifecycleStage: stage }).where(eq(tenants.id, s.tenantId));
      expectError(await manual(), 403, 'tenant_read_only');
    }

    // Ödeme alınıp aşama geri açılınca aynı sipariş geçer (kapının tek sebebi aşamadır)
    await ctx.db.update(tenants).set({ lifecycleStage: 'trial' }).where(eq(tenants.id, s.tenantId));
    const ok = await manual();
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('ödeme gecikmesi (past_due) telefon siparişini durdurmaz — dunning G..G+10', async () => {
    const s = await setupStore(ctx, { wa: 'connected', slug: 'gecikmis-telefon' });
    const cashier = (await ctx.createStaff(s.tenantId, 'cashier')).cookie;
    await ctx.db.update(tenants).set({ lifecycleStage: 'past_due' }).where(eq(tenants.id, s.tenantId));
    const res = await ctx.request({
      method: 'POST',
      url: '/api/v1/panel/orders/manual',
      cookie: cashier,
      body: {
        items: [{ productId: s.pideId, quantity: 1, optionIds: [s.acisizId] }],
        fulfillmentType: 'pickup',
        customerName: 'Gel-al Müşteri',
        customerPhone: '0532 700 10 21',
        paymentMethod: 'pay_at_counter',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  // Vitrin kapıları (`ordering_enabled`, `web_live_at`) telefon siparişine BİLEREK uygulanmaz: online siparişi
  // kapatan ya da henüz canlıya geçmemiş (kurulum/pilot) işletme kasadan sipariş girmeye devam eder (04 §3.6).
  it('online sipariş kapalı ve canlı değilken telefon siparişi çalışmaya devam eder', async () => {
    const s = await setupStore(ctx, { wa: 'connected', slug: 'vitrini-kapali-telefon' });
    const cashier = (await ctx.createStaff(s.tenantId, 'cashier')).cookie;
    await ctx.db.update(tenants).set({ orderingEnabled: false, webLiveAt: null }).where(eq(tenants.id, s.tenantId));
    // Vitrin kapalı
    const { body: vitrin } = await getStore(s.slug);
    expect(vitrin.orderingEnabled).toBe(false);
    // Kasa açık
    const res = await ctx.request({
      method: 'POST',
      url: '/api/v1/panel/orders/manual',
      cookie: cashier,
      body: {
        items: [{ productId: s.pideId, quantity: 1, optionIds: [s.acisizId] }],
        fulfillmentType: 'pickup',
        customerName: 'Kurulum Müşterisi',
        customerPhone: '0532 700 10 22',
        paymentMethod: 'pay_at_counter',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('deneme bitişini uygulayan iş (cron.trial_watch)', () => {
  it('uyarı bandı dolan denemeyi read_only yapar, aboneliği eşitler ve denetim kaydı yazar', async () => {
    const t = await ctx.createTenantWithOwner({ slug: 'denemesi-bitti' });
    const trialEndsAt = await withExpiredTrial(t, 5);

    const applied = await enforceTrialEnds(ctx.db);
    expect(applied.map((a) => a.tenantId)).toContain(t.tenantId);
    expect(await stageOf(t.tenantId)).toBe('read_only');
    expect(await subStatusOf(t.tenantId)).toBe('read_only');

    const [log] = await ctx.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, t.tenantId), eq(auditLog.action, 'tenant.trial_ended')));
    expect(log!.actorUserId).toBeNull();
    expect(log!.data).toMatchObject({ actorType: 'system', from: 'trial', to: 'read_only', graceDays: 3, trialEndsAt: trialEndsAt.toISOString() });

    // Vitrin aynı anda sipariş almayı bırakır
    const { body } = await getStore(t.slug);
    expect(body.orderingEnabled).toBe(false);
  });

  it('ikinci koşu aynı işletmeye dokunmaz (idempotent)', async () => {
    const t = await ctx.createTenantWithOwner({ slug: 'idempotent-deneme' });
    await withExpiredTrial(t, 9);
    expect((await enforceTrialEnds(ctx.db)).map((a) => a.tenantId)).toContain(t.tenantId);
    expect((await enforceTrialEnds(ctx.db)).map((a) => a.tenantId)).not.toContain(t.tenantId);
    expect(await stageOf(t.tenantId)).toBe('read_only');
  });

  it('uyarı bandı sürerken (bitiş + 3 günden önce) dokunmaz', async () => {
    const t = await ctx.createTenantWithOwner({ slug: 'uyari-bandi' });
    await withExpiredTrial(t, 1);
    await enforceTrialEnds(ctx.db);
    expect(await stageOf(t.tenantId)).toBe('trial');
    const { body } = await getStore(t.slug);
    expect(body.orderingEnabled).toBe(true);
  });

  it('ücretli plana geçen işletmeye dokunmaz', async () => {
    const t = await ctx.createTenantWithOwner({ slug: 'plan-secti' });
    await withExpiredTrial(t, 30);
    await ctx.db.update(subscriptions).set({ status: 'active' }).where(eq(subscriptions.tenantId, t.tenantId));
    await enforceTrialEnds(ctx.db);
    expect(await stageOf(t.tenantId)).toBe('trial');
  });

  it('pilot işletme ücretsiz dönemde kapanmaz', async () => {
    const t = await ctx.createTenantWithOwner({ slug: 'pilot-isletme' });
    await withExpiredTrial(t, 30);
    await ctx.db.update(tenants).set({ lifecycleStage: 'pilot' }).where(eq(tenants.id, t.tenantId));
    await enforceTrialEnds(ctx.db);
    expect(await stageOf(t.tenantId)).toBe('pilot');
  });

  it('trial_ends_at boş işletmeye dokunmaz', async () => {
    const t = await ctx.createTenantWithOwner({ slug: 'bitisi-yazilmamis' });
    await ctx.db.update(tenants).set({ trialEndsAt: null }).where(eq(tenants.id, t.tenantId));
    await enforceTrialEnds(ctx.db);
    expect(await stageOf(t.tenantId)).toBe('trial');
  });
});

describe('kayıt kapısı (signup_open)', () => {
  const signupBody = (over: Record<string, unknown> = {}) => ({
    businessName: 'Kapı Testi Kebap',
    ownerName: 'Veli Usta',
    phone: '0533 444 55 66',
    email: 'kapi-testi@example.com',
    password: 'guclu-parola-1',
    city: 'Yozgat',
    acceptTerms: true,
    ...over,
  });

  it('bayrak kapalıyken 403 signup_closed + lead formu yolu döner', async () => {
    await ctx.db
      .insert(featureFlags)
      .values({ key: 'signup_open', enabled: false, kind: 'kill_switch' })
      .onConflictDoUpdate({ target: featureFlags.key, set: { enabled: false } });

    const res = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/signup',
      body: signupBody(),
      headers: { 'x-forwarded-for': '10.44.0.1' },
    });
    expectError(res, 403, 'signup_closed');
    expect(res.json().error.details).toMatchObject({ leadFormPath: '/demo' });

    const status = await ctx.request({ method: 'GET', url: '/api/v1/public/signup-status' });
    expect(status.json()).toMatchObject({ open: false });

    // Hiçbir işletme yazılmamalı
    const [hit] = await ctx.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.name, 'Kapı Testi Kebap'));
    expect(hit).toBeUndefined();
  });

  it('bayrak açılınca kayıt tekrar çalışır', async () => {
    await ctx.db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.key, 'signup_open'));
    const res = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/signup',
      body: signupBody(),
      headers: { 'x-forwarded-for': '10.44.0.2' },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().tenant).toMatchObject({ lifecycleStage: 'trial' });
  });
});
