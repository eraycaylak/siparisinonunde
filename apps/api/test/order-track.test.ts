// Takip sayfası (14 §6.2, 03 §7): geçerli/süresi dolmuş/geçersiz token, iptal kuralları, iptal talebi, değerlendirme.

import { branchEvents, cancellationRequests, orders, reviews } from '@siparis/db';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTrackingToken } from '../src/lib/tracking';
import { createTestContext, expectError, type TestContext } from './helpers';
import { orderBody, placeOrder, setupStore, stubExternalJobs, type StoreFixture } from './orders-helpers';

let ctx: TestContext;
let s: StoreFixture;

beforeAll(async () => {
  ctx = await createTestContext();
  stubExternalJobs();
  s = await setupStore(ctx, { wa: 'connected' });
});
afterAll(async () => {
  await ctx.close();
});

const tokenOf = (orderId: string) => createTrackingToken(orderId, ctx.config.TRACKING_SECRET);
const track = (orderId: string) => ctx.request({ method: 'GET', url: `/api/v1/store/track/${tokenOf(orderId)}` });

async function newOrder(status: 'new' | 'accepted' | 'delivered' | 'awaiting_customer' = 'new') {
  const res = await placeOrder(ctx, s.slug, orderBody(s));
  const id = res.json().orderId as string;
  if (status !== 'awaiting_customer') {
    await ctx.request({ method: 'POST', url: `/api/v1/panel/orders/${id}/verify`, cookie: s.ownerCookie });
  }
  if (status === 'accepted' || status === 'delivered') {
    await ctx.request({ method: 'POST', url: `/api/v1/panel/orders/${id}/accept`, cookie: s.ownerCookie, body: { etaMinutes: 30 } });
  }
  if (status === 'delivered') {
    for (const to of ['on_the_way', 'delivered']) {
      await ctx.request({ method: 'POST', url: `/api/v1/panel/orders/${id}/advance`, cookie: s.ownerCookie, body: { to } });
    }
  }
  const [o] = await ctx.db.select().from(orders).where(eq(orders.id, id));
  expect(o!.status).toBe(status);
  return o!;
}

describe('GET /store/track/:token', () => {
  it('awaiting_customer: doğrulama bilgisi, maskeli telefon, no-store başlıkları', async () => {
    const o = await newOrder('awaiting_customer');
    const res = await track(o.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const b = res.json();
    expect(b.expired).toBe(false);
    expect(b.order).toMatchObject({
      number: o.number,
      status: 'awaiting_customer',
      statusLabel: 'WhatsApp onayınız bekleniyor',
      canCancel: true,
      canRequestCancel: false,
      totals: { subtotalKurus: 37500, deliveryFeeKurus: 1000, totalKurus: 38500 },
    });
    expect(b.order.verification).toMatchObject({ method: 'wa_code', smsAvailable: true });
    expect(b.order.verification.waLink).toContain('wa.me/905550000099');
    expect(b.order.phoneMasked).toMatch(/^0\*\*\*/);
    expect(JSON.stringify(b)).not.toContain('Cumhuriyet Cd.');
    expect(b.business).toMatchObject({ slug: s.slug, phone: '+903542120000' });
  });

  it('accepted: çizelge ve tahmini saat', async () => {
    const o = await newOrder('accepted');
    const b = (await track(o.id)).json();
    expect(b.order.status).toBe('accepted');
    expect(b.order.statusLabel).toMatch(/^Onaylandı · Tahmini \d\d\.\d\d$/);
    expect(b.order.etaAt).toBeTruthy();
    const steps = b.order.timeline.map((t: { status: string; at: string | null }) => [t.status, Boolean(t.at)]);
    expect(steps).toEqual([
      ['new', true],
      ['accepted', true],
      ['on_the_way', false],
      ['delivered', false],
    ]);
    expect(b.order.items[0]).toMatchObject({ name: 'Kıymalı Pide', quantity: 2, options: ['Acılı', 'Kaşar'] });
  });

  it('geçersiz token 404; süresi dolmuş link 410 ve kişisel veri yok', async () => {
    expect((await ctx.request({ method: 'GET', url: '/api/v1/store/track/AAAAAAAAAAAAAAAAAAAAAA.xxxxxxxxxxxxxxxx' })).statusCode).toBe(404);
    const o = await newOrder('delivered');
    await ctx.db.update(orders).set({ trackingExpiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, o.id));
    const res = await track(o.id);
    expectError(res, 410, 'tracking_link_expired');
    expect(res.body).not.toContain('Ayşe');
    expect(res.body).not.toContain('Kıymalı');
    expect(res.json().error.details.business.slug).toBe(s.slug);
  });
});

describe('iptal kuralları (03 §7.4)', () => {
  it('awaiting_customer ve new: doğrudan iptal (customer, customer_request)', async () => {
    for (const st of ['awaiting_customer', 'new'] as const) {
      const o = await newOrder(st);
      const res = await ctx.request({ method: 'POST', url: `/api/v1/store/track/${tokenOf(o.id)}/cancel`, body: { reason: 'Yanlış sipariş verdim' } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({ result: 'cancelled', status: 'cancelled' });
      const [c] = await ctx.db.select().from(orders).where(eq(orders.id, o.id));
      expect(c).toMatchObject({ status: 'cancelled', cancelledBy: 'customer', cancelReason: 'customer_request', cancelNote: 'Yanlış sipariş verdim' });
      expect(c!.trackingExpiresAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * 86400_000);
    }
  });

  it('accepted: iptal talebi (tek bekleyen), panel olayı; işletme onaylarsa customer iptali', async () => {
    const o = await newOrder('accepted');
    const res = await ctx.request({ method: 'POST', url: `/api/v1/store/track/${tokenOf(o.id)}/cancel`, body: {} });
    expect(res.json()).toEqual({ result: 'requested', status: 'accepted' });
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/store/track/${tokenOf(o.id)}/cancel`, body: {} }), 409, 'cancel_request_exists');
    const [ev] = await ctx.db.select().from(branchEvents).where(eq(branchEvents.branchId, s.branchId)).orderBy(desc(branchEvents.seq)).limit(1);
    expect(ev!.payload).toMatchObject({ change: 'cancel_request', order: { id: o.id, cancelRequested: true } });
    const b = (await track(o.id)).json();
    expect(b.order).toMatchObject({ canCancel: false, canRequestCancel: false, cancelRequested: true, cancelRequestStatus: 'pending' });

    const [req] = await ctx.db.select().from(cancellationRequests).where(eq(cancellationRequests.orderId, o.id));
    const decide = await ctx.request({
      method: 'POST',
      url: `/api/v1/panel/orders/${o.id}/cancellation-request/${req!.id}/decide`,
      cookie: s.ownerCookie,
      body: { approve: true },
    });
    expect(decide.statusCode, decide.body).toBe(200);
    const [c] = await ctx.db.select().from(orders).where(eq(orders.id, o.id));
    expect(c).toMatchObject({ status: 'cancelled', cancelledBy: 'customer', cancelReason: 'customer_request' });
  });

  it('iptal talebi reddedilirse sipariş sürer; takip sayfası "rejected" gösterir', async () => {
    const o = await newOrder('accepted');
    await ctx.request({ method: 'POST', url: `/api/v1/store/track/${tokenOf(o.id)}/cancel`, body: {} });
    const [req] = await ctx.db.select().from(cancellationRequests).where(eq(cancellationRequests.orderId, o.id));
    const res = await ctx.request({
      method: 'POST',
      url: `/api/v1/panel/orders/${o.id}/cancellation-request/${req!.id}/decide`,
      cookie: s.ownerCookie,
      body: { approve: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().order).toMatchObject({ status: 'accepted', cancelRequested: false });
    expect((await track(o.id)).json().order).toMatchObject({ cancelRequestStatus: 'rejected', canRequestCancel: true });
  });

  it('final durumda iptal yok (409)', async () => {
    const o = await newOrder('delivered');
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/store/track/${tokenOf(o.id)}/cancel`, body: {} }), 409, 'invalid_transition');
  });
});

describe('değerlendirme (03 §7.5)', () => {
  it('yalnız delivered ve tek sefer', async () => {
    const pending = await newOrder('accepted');
    expectError(
      await ctx.request({ method: 'POST', url: `/api/v1/store/track/${tokenOf(pending.id)}/review`, body: { rating: 'good' } }),
      409,
      'review_not_allowed',
    );
    const o = await newOrder('delivered');
    const ok = await ctx.request({ method: 'POST', url: `/api/v1/store/track/${tokenOf(o.id)}/review`, body: { rating: 'bad', comment: 'Soğuk geldi' } });
    expect(ok.statusCode, ok.body).toBe(200);
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/store/track/${tokenOf(o.id)}/review`, body: { rating: 'good' } }), 409, 'review_exists');
    const [r] = await ctx.db.select().from(reviews).where(eq(reviews.orderId, o.id));
    expect(r).toMatchObject({ rating: 'bad', comment: 'Soğuk geldi', tenantId: s.tenantId });
    expect((await track(o.id)).json().order.review).toEqual({ rating: 'bad', comment: 'Soğuk geldi' });
  });
});
