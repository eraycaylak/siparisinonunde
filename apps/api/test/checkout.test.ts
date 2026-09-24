// Storefront checkout (14 §6.2): quote, sipariş oluşturma (Akış A/B, SMS modu), idempotency, hız sınırı, kapalı durum.

import { ORDER_CODE_PATTERN } from '@siparis/core';
import {
  branches,
  customers,
  featureFlags,
  jobs,
  legalAcceptances,
  openingHours,
  orderItemOptions,
  orderItems,
  orderVerificationCodes,
  orders,
  tenants,
} from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, expectError, type TestContext } from './helpers';
import {
  createLinkToken,
  freshIp,
  freshPhone,
  jobsFor,
  orderBody,
  placeOrder,
  setupStore,
  stubExternalJobs,
  type StoreFixture,
} from './orders-helpers';

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

describe('POST /store/:slug/quote', () => {
  it('fiyatı sunucuda hesaplar (seçenek farkı + teslimat ücreti)', async () => {
    const res = await ctx.request({
      method: 'POST',
      url: `/api/v1/store/${s.slug}/quote`,
      body: {
        items: [
          { productId: s.pideId, quantity: 2, optionIds: [s.aciliId, s.kasarId] },
          { productId: s.ayranId, quantity: 1 },
        ],
        fulfillmentType: 'delivery',
        neighborhood: 'medrese mah.',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const q = res.json();
    expect(q.subtotalKurus).toBe(2 * (15000 + 2500) + 2500);
    expect(q.deliveryFeeKurus).toBe(1000);
    expect(q.totalKurus).toBe(q.subtotalKurus + 1000);
    expect(q.zone).toMatchObject({ id: s.zoneMerkezId, name: 'Merkez' });
    expect(q.problems).toEqual([]);
    expect(q.lines[0].options.map((o: { optionName: string }) => o.optionName)).toEqual(['Acılı', 'Kaşar']);
  });

  it('problemleri Türkçe döndürür: kısıtlı ürün, tükenen ürün, zorunlu seçenek, bölge dışı', async () => {
    const res = await ctx.request({
      method: 'POST',
      url: `/api/v1/store/${s.slug}/quote`,
      body: {
        items: [
          { productId: s.rakiId, quantity: 1 },
          { productId: s.soldOutId, quantity: 1 },
          { productId: s.pideId, quantity: 1 },
        ],
        fulfillmentType: 'delivery',
        neighborhood: 'Olmayan',
      },
    });
    expect(res.statusCode).toBe(200);
    const codes = res.json().problems.map((p: { code: string }) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['restricted_item', 'item_unavailable', 'option_rule_violation', 'out_of_delivery_area']));
    expect(res.json().problems[0].message).toMatch(/[a-zçğıöşü]/i);
  });

  it('min sepet altında problem döner; bilinmeyen işletme 404', async () => {
    const res = await ctx.request({
      method: 'POST',
      url: `/api/v1/store/${s.slug}/quote`,
      body: { items: [{ productId: s.ayranId, quantity: 1 }], fulfillmentType: 'delivery', neighborhood: 'Karatepe' },
    });
    expect(res.json().meetsMinimum).toBe(false);
    expect(res.json().problems.map((p: { code: string }) => p.code)).toContain('min_basket_not_met');
    const nf = await ctx.request({
      method: 'POST',
      url: `/api/v1/store/yok-boyle-isletme/quote`,
      body: { items: [{ productId: s.ayranId, quantity: 1 }], fulfillmentType: 'pickup' },
    });
    expect(nf.statusCode).toBe(404);
  });
});

describe('POST /store/:slug/orders — Akış B (WhatsApp kodu)', () => {
  it('awaiting_customer + kod + waLink + snapshot + yasal kabul + zaman aşımı işi + müşteri çerezi', async () => {
    const body = orderBody(s);
    const res = await placeOrder(ctx, s.slug, body);
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json();
    expect(r.status).toBe('awaiting_customer');
    expect(r.verification).toMatchObject({ required: true, method: 'wa_code', smsAvailable: true });
    expect(r.verification.code).toMatch(ORDER_CODE_PATTERN);
    expect(r.verification.waLink).toBe(`https://wa.me/905550000099?text=${encodeURIComponent(`Sipariş kodu: ${r.verification.code}`)}`);
    expect(r.trackingUrl).toMatch(/^http:\/\/localhost:3000\/t\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(res.cookies.find((c) => c.name === `sf_cust_${s.slug}`)?.httpOnly).toBe(true);

    const [o] = await ctx.db.select().from(orders).where(eq(orders.id, r.orderId));
    expect(o).toMatchObject({
      channel: 'web',
      status: 'awaiting_customer',
      verificationMethod: null,
      verifiedAt: null,
      trackingExpiresAt: null,
      fulfillmentType: 'delivery',
      neighborhood: 'Medrese',
      zoneName: 'Merkez',
      subtotalKurus: 37500,
      deliveryFeeKurus: 1000,
      totalKurus: 38500,
      changeForKurus: 50000,
      wantsCutlery: true,
      statusNotifyChannel: 'whatsapp',
    });
    expect(o!.customerPhone).toMatch(/^\+90532/);
    const items = await ctx.db.select().from(orderItems).where(eq(orderItems.orderId, o!.id));
    expect(items.map((i) => [i.name, i.quantity, i.unitPriceKurus, i.lineTotalKurus])).toEqual(
      expect.arrayContaining([
        ['Kıymalı Pide', 2, 15000, 35000],
        ['Ayran', 1, 2500, 2500],
      ]),
    );
    const opts = await ctx.db.select().from(orderItemOptions).where(eq(orderItemOptions.tenantId, s.tenantId));
    expect(opts.map((x) => x.optionName)).toEqual(expect.arrayContaining(['Acılı', 'Kaşar']));
    const legal = await ctx.db.select().from(legalAcceptances).where(eq(legalAcceptances.orderId, o!.id));
    expect(legal.map((l) => l.document).sort()).toEqual(['mesafeli_satis', 'on_bilgilendirme']);
    expect(legal[0]!.version).toBeTruthy();
    const [code] = await ctx.db.select().from(orderVerificationCodes).where(eq(orderVerificationCodes.orderId, o!.id));
    expect(code!.code).toBe(r.verification.code);
    expect(Math.round((code!.expiresAt.getTime() - Date.now()) / 60000)).toBe(30);
    const timeout = await jobsFor(ctx, o!.id, 'order.awaiting_timeout');
    expect(timeout).toHaveLength(1);
    expect(timeout[0]!.dedupeKey).toBe(`awaiting_timeout:${o!.id}`);
    expect(Math.round((timeout[0]!.runAt.getTime() - Date.now()) / 60000)).toBe(30);
    expect(await jobsFor(ctx, o!.id, 'order.alarm_step')).toHaveLength(0);
    const [c] = await ctx.db.select().from(customers).where(eq(customers.id, o!.customerId!));
    expect(c!.name).toBe('Ayşe Yılmaz');
  });

  it('idempotency: aynı anahtar → aynı yanıt, tek sipariş', async () => {
    const body = orderBody(s);
    const a = await placeOrder(ctx, s.slug, body);
    const b = await placeOrder(ctx, s.slug, body);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    const rows = await ctx.db
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, s.tenantId), eq(orders.idempotencyKey, body.idempotencyKey as string)));
    expect(rows).toHaveLength(1);
  });

  it('gel-al: kasada ödeme, adres gerekmez', async () => {
    const res = await placeOrder(
      ctx,
      s.slug,
      orderBody(s, { fulfillmentType: 'pickup', paymentMethod: 'pay_at_counter', addressLine: undefined, neighborhood: undefined, changeForKurus: undefined }),
    );
    expect(res.statusCode, res.body).toBe(200);
    const [o] = await ctx.db.select().from(orders).where(eq(orders.id, res.json().orderId));
    expect(o).toMatchObject({ fulfillmentType: 'pickup', deliveryFeeKurus: 0, addressLine: null, paymentMethod: 'pay_at_counter' });
  });
});

describe('POST /store/:slug/orders — Akış A (link çerezi)', () => {
  it('geçerli sf_link çerezi: doğrudan new, wa_link, konuşma ve müşteri bağlanır, alarm kurulur', async () => {
    const link = await createLinkToken(ctx, s);
    const res = await placeOrder(ctx, s.slug, orderBody(s), { cookie: link.cookie });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'new', verification: { required: false } });
    const [o] = await ctx.db.select().from(orders).where(eq(orders.id, res.json().orderId));
    expect(o).toMatchObject({
      channel: 'wa_link',
      verificationMethod: 'wa_link',
      conversationId: link.conversationId,
      customerId: link.customerId,
      linkTokenId: link.tokenId,
    });
    expect(o!.verifiedAt).toBeInstanceOf(Date);
    const alarms = await jobsFor(ctx, o!.id, 'order.alarm_step');
    expect(alarms.map((j) => j.dedupeKey).sort()).toEqual([2, 3, 4, 5, 6].map((n) => `alarm:${o!.id}:${n}`).sort());
    const [c] = await ctx.db.select().from(customers).where(eq(customers.id, link.customerId));
    expect(c!.phoneE164).toBe(o!.customerPhone);
    expect(c!.orderCount).toBe(1);
  });

  it('geçersiz/başka işletmenin çerezi Akış B\'ye düşer', async () => {
    const res = await placeOrder(ctx, s.slug, orderBody(s), { cookie: `sf_link_${s.slug}=gecersiz-token-degeri-0123456789` });
    expect(res.json().status).toBe('awaiting_customer');
  });
});

describe('WhatsApp\'sız mod (SMS OTP)', () => {
  let sms: StoreFixture;
  beforeAll(async () => {
    sms = await setupStore(ctx, { wa: 'error' });
  });

  it('WhatsApp hatalıyken sms_otp; OTP gönder → yanlış kod → doğru kod → new', async () => {
    const res = await placeOrder(ctx, sms.slug, orderBody(sms));
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json();
    expect(r.verification).toEqual({ required: true, method: 'sms_otp', smsAvailable: true });
    const [o0] = await ctx.db.select().from(orders).where(eq(orders.id, r.orderId));
    expect(o0!.statusNotifyChannel).toBe('sms');

    const send = await ctx.request({
      method: 'POST',
      url: `/api/v1/store/orders/${r.orderId}/sms-otp`,
      body: { phone: o0!.customerPhone },
      headers: { 'x-forwarded-for': freshIp() },
    });
    expect(send.statusCode, send.body).toBe(200);
    expect(send.json().phoneMasked).toMatch(/^0\*\*\* \*\*\* \d\d \d\d$/);
    const smsJobs = await jobsFor(ctx, r.orderId, 'sms.send');
    expect(smsJobs).toHaveLength(1);
    const payload = smsJobs[0]!.payload as { body: string; purpose: string; to: string };
    expect(payload.purpose).toBe('otp');
    expect(payload.to).toBe(o0!.customerPhone);
    const code = /(\d{6})/.exec(payload.body)![1]!;

    // 60 sn dolmadan yeniden gönderim yok
    const again = await ctx.request({
      method: 'POST',
      url: `/api/v1/store/orders/${r.orderId}/sms-otp`,
      body: { phone: o0!.customerPhone },
      headers: { 'x-forwarded-for': freshIp() },
    });
    expect(again.statusCode).toBe(429);

    const wrong = await ctx.request({
      method: 'POST',
      url: `/api/v1/store/orders/${r.orderId}/sms-verify`,
      body: { code: code === '000000' ? '111111' : '000000' },
    });
    expectError(wrong, 422, 'invalid_code');

    const ok = await ctx.request({ method: 'POST', url: `/api/v1/store/orders/${r.orderId}/sms-verify`, body: { code } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().status).toBe('new');
    const [o] = await ctx.db.select().from(orders).where(eq(orders.id, r.orderId));
    expect(o).toMatchObject({ status: 'new', verificationMethod: 'sms_otp' });
    expect(await jobsFor(ctx, r.orderId, 'order.alarm_step')).toHaveLength(5);
    const timeout = await jobsFor(ctx, r.orderId, 'order.awaiting_timeout');
    expect(timeout[0]!.status).toBe('cancelled');
  });

  it('5 hatalı denemeden sonra kod kilitlenir', async () => {
    const r = (await placeOrder(ctx, sms.slug, orderBody(sms))).json();
    const [o] = await ctx.db.select().from(orders).where(eq(orders.id, r.orderId));
    await ctx.request({
      method: 'POST',
      url: `/api/v1/store/orders/${r.orderId}/sms-otp`,
      body: { phone: o!.customerPhone },
      headers: { 'x-forwarded-for': freshIp() },
    });
    const job = (await jobsFor(ctx, r.orderId, 'sms.send'))[0]!;
    const code = /(\d{6})/.exec((job.payload as { body: string }).body)![1]!;
    const bad = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 4; i++) {
      expectError(await ctx.request({ method: 'POST', url: `/api/v1/store/orders/${r.orderId}/sms-verify`, body: { code: bad } }), 422, 'invalid_code');
    }
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/store/orders/${r.orderId}/sms-verify`, body: { code: bad } }), 422, 'code_locked');
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/store/orders/${r.orderId}/sms-verify`, body: { code } }), 422, 'code_locked');
  });

  it('WhatsApp da SMS de yoksa: awaiting_customer, doğrulama yöntemi yok (işletmeyi arama talimatı)', async () => {
    const none = await setupStore(ctx, { wa: 'none' });
    await ctx.db.update(tenants).set({ smsFallbackEnabled: false }).where(eq(tenants.id, none.tenantId));
    const res = await placeOrder(ctx, none.slug, orderBody(none));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().status).toBe('awaiting_customer');
    expect(res.json().verification).toEqual({ required: true, smsAvailable: false });
    const otp = await ctx.request({
      method: 'POST',
      url: `/api/v1/store/orders/${res.json().orderId}/sms-otp`,
      body: { phone: '05321234567' },
      headers: { 'x-forwarded-for': freshIp() },
    });
    expectError(otp, 409, 'sms_unavailable');
  });

  it('platform sms_fallback kill-switch kapalıysa SMS sunulmaz', async () => {
    await ctx.db.insert(featureFlags).values({ key: 'sms_fallback', enabled: false, kind: 'kill_switch' }).onConflictDoUpdate({
      target: featureFlags.key,
      set: { enabled: false },
    });
    const res = await placeOrder(ctx, sms.slug, orderBody(sms));
    expect(res.json().verification).toEqual({ required: true, smsAvailable: false });
    await ctx.db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.key, 'sms_fallback'));
  });
});

describe('kurallar ve korumalar', () => {
  it('duraklatılmış şube, ordering_enabled=false ve çalışma saati dışı → 409 ordering_closed', async () => {
    const x = await setupStore(ctx, { wa: 'connected' });
    await ctx.db.update(branches).set({ pausedUntil: new Date(Date.now() + 30 * 60_000) }).where(eq(branches.id, x.branchId));
    expectError(await placeOrder(ctx, x.slug, orderBody(x)), 409, 'ordering_closed');
    await ctx.db.update(branches).set({ pausedUntil: null }).where(eq(branches.id, x.branchId));

    await ctx.db.update(tenants).set({ orderingEnabled: false }).where(eq(tenants.id, x.tenantId));
    expectError(await placeOrder(ctx, x.slug, orderBody(x)), 409, 'ordering_closed');
    await ctx.db.update(tenants).set({ orderingEnabled: true }).where(eq(tenants.id, x.tenantId));

    await ctx.db.delete(openingHours).where(eq(openingHours.branchId, x.branchId));
    const closed = await placeOrder(ctx, x.slug, orderBody(x));
    expectError(closed, 409, 'ordering_closed');
    expect(closed.json().error.details.orderingState).toBe('closed');
  });

  it('min sepet ve bölge dışı → 422 cart_invalid (problems ile)', async () => {
    const res = await placeOrder(ctx, s.slug, orderBody(s, { items: [{ productId: s.ayranId, quantity: 1 }], neighborhood: 'Karatepe' }));
    expectError(res, 422, 'cart_invalid');
    expect(res.json().error.details.problems.map((p: { code: string }) => p.code)).toContain('min_basket_not_met');
    const out = await placeOrder(ctx, s.slug, orderBody(s, { neighborhood: 'Başka Mahalle' }));
    expectError(out, 422, 'cart_invalid');
    expect(out.json().error.details.problems[0].code).toBe('out_of_delivery_area');
  });

  it('ödeme kuralları: paket siparişte kasada ödeme yok, yemek kartı markası zorunlu ve kabul edilenlerden', async () => {
    expectError(await placeOrder(ctx, s.slug, orderBody(s, { paymentMethod: 'pay_at_counter' })), 422, 'payment_method_unavailable');
    expectError(await placeOrder(ctx, s.slug, orderBody(s, { paymentMethod: 'meal_card_on_delivery', changeForKurus: undefined })), 400, 'validation_error');
    expectError(
      await placeOrder(ctx, s.slug, orderBody(s, { paymentMethod: 'meal_card_on_delivery', mealCardBrand: 'edenred', changeForKurus: undefined })),
      422,
      'meal_card_brand_unavailable',
    );
    expectError(await placeOrder(ctx, s.slug, orderBody(s, { changeForKurus: 100 })), 422, 'invalid_change');
    const ok = await placeOrder(ctx, s.slug, orderBody(s, { paymentMethod: 'meal_card_on_delivery', mealCardBrand: 'multinet', changeForKurus: undefined }));
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('acceptPreInfo zorunlu; telefon geçersizse 400', async () => {
    expectError(await placeOrder(ctx, s.slug, orderBody(s, { acceptPreInfo: false })), 400, 'validation_error');
    expectError(await placeOrder(ctx, s.slug, orderBody(s, { customerPhone: '12345678901' })), 400, 'validation_error');
  });

  it('kara listedeki müşteri sipariş veremez (nötr metin)', async () => {
    const phone = freshPhone();
    await ctx.db.insert(customers).values({ tenantId: s.tenantId, phoneE164: `+90${phone.slice(1)}`, name: 'X', isBlocked: true });
    const res = await placeOrder(ctx, s.slug, orderBody(s, { customerPhone: phone }));
    expectError(res, 403, 'ordering_unavailable');
    expect(res.json().error.message).toContain('lütfen işletmeyi arayın');
  });

  it('hız sınırı: IP başına 5/dk, telefon başına 3/10 dk', async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await placeOrder(ctx, s.slug, orderBody(s), { ip })).statusCode).toBe(200);
    expectError(await placeOrder(ctx, s.slug, orderBody(s), { ip }), 429, 'rate_limited');

    const phone = freshPhone();
    for (let i = 0; i < 3; i++) expect((await placeOrder(ctx, s.slug, orderBody(s, { customerPhone: phone }))).statusCode).toBe(200);
    expectError(await placeOrder(ctx, s.slug, orderBody(s, { customerPhone: phone })), 429, 'rate_limited');
  });

  it('istemciden gelen fiyat alanları yok sayılır (şema dışı alanlar)', async () => {
    const res = await placeOrder(ctx, s.slug, orderBody(s, { totalKurus: 1, deliveryFeeKurus: 0 }));
    expect(res.statusCode).toBe(200);
    const [o] = await ctx.db.select().from(orders).where(eq(orders.id, res.json().orderId));
    expect(o!.totalKurus).toBe(38500);
    const pending = await ctx.db.select().from(jobs).where(eq(jobs.type, 'order.awaiting_timeout'));
    expect(pending.length).toBeGreaterThan(0);
  });
});
