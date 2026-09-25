// Telefon siparişi (Akış E) müşteri bildirimi — dilim 2 (POST /panel/orders/manual) ↔ dilim 3 (order-notify)
// uçtan uca: kasiyer "WhatsApp'tan bilgilendirilmeyi kabul etti" kutusunu işaretlerse durum mesajı (şablon)
// müşterinin telefonuna gider; işaretlemezse hiçbir mesaj gitmez (02 §9.1, 00 §7 Akış E).

import { conversations, jobs, messages, orders, smsMessages } from '@siparis/db';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasNotifyConsent, phoneOrderNotifyFields } from '../src/services/orders/notify-consent';
import { clearMockSent } from '../src/wa/index';
import { createTestContext, type TestContext } from './helpers';
import { setupStore, type StoreFixture } from './orders-helpers';
import { flushNotify, runJobs, transition } from './wa-helpers';

let ctx: TestContext;
let s: StoreFixture;
let cashier: string;

beforeAll(async () => {
  ctx = await createTestContext();
  s = await setupStore(ctx, { wa: 'connected' });
  cashier = (await ctx.createStaff(s.tenantId, 'cashier')).cookie;
  clearMockSent();
});
afterAll(async () => {
  await ctx.close();
});

function manualBody(phone: string, notifyWhatsapp?: boolean) {
  return {
    items: [{ productId: s.pideId, quantity: 1, optionIds: [s.acisizId] }],
    fulfillmentType: 'delivery',
    neighborhood: 'Tekke',
    customerName: 'Telefon Müşteri',
    customerPhone: phone,
    addressLine: 'Kale Sk. 4',
    paymentMethod: 'cash_on_delivery',
    ...(notifyWhatsapp === undefined ? {} : { notifyWhatsapp }),
  };
}

async function placeManual(phone: string, notifyWhatsapp?: boolean) {
  const res = await ctx.request({ method: 'POST', url: '/api/v1/panel/orders/manual', cookie: cashier, body: manualBody(phone, notifyWhatsapp) });
  expect(res.statusCode, res.body).toBe(200);
  const [o] = await ctx.db.select().from(orders).where(eq(orders.id, res.json().order.id));
  return o!;
}

const outFor = (orderId: string) =>
  ctx.db
    .select()
    .from(messages)
    .where(and(eq(messages.orderId, orderId), eq(messages.direction, 'out')));

describe('tek biçim (notify-consent)', () => {
  it('onay → whatsapp + notifyConsent true; onaysız → none + false', () => {
    expect(phoneOrderNotifyFields(true)).toEqual({ statusNotifyChannel: 'whatsapp', sourceMeta: { notifyConsent: true } });
    expect(phoneOrderNotifyFields(false)).toEqual({ statusNotifyChannel: 'none', sourceMeta: { notifyConsent: false } });
    expect(hasNotifyConsent({ sourceMeta: { notifyConsent: true } })).toBe(true);
    expect(hasNotifyConsent({ sourceMeta: { notifyConsent: 'true' } })).toBe(false);
    expect(hasNotifyConsent({ sourceMeta: null })).toBe(false);
  });
});

describe('telefon siparişi + WhatsApp bildirimi (uçtan uca)', () => {
  it('onaylı: kolonlar yazılır, "onaylandı" şablonu müşterinin telefonuna gider; sonraki durum da gider', async () => {
    const phone = '0533 444 55 01';
    const o = await placeManual(phone, true);
    expect(o).toMatchObject({ channel: 'manual', status: 'accepted', statusNotifyChannel: 'whatsapp' });
    expect(o.sourceMeta).toMatchObject({ notifyConsent: true });

    await flushNotify(ctx);
    const out = await outFor(o.id);
    // 04 §4.13 adım 7: ayrı "alındı" gitmez, tek "onaylandı" (pencere yok → şablon); bütçeden 1 mesaj
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'template', templateName: 'siparis_onaylandi_v1' });
    const [fresh] = await ctx.db.select().from(orders).where(eq(orders.id, o.id));
    expect(fresh!.waStatusMsgCount).toBe(1);
    const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, out[0]!.conversationId));
    expect(conv).toBeDefined();
    expect(conv!.customerId).toBe(o.customerId);

    // Yolda → ikinci durum mesajı
    await transition(ctx, { orderId: o.id, tenantId: s.tenantId, to: 'on_the_way', actor: { type: 'user' } });
    await flushNotify(ctx);
    expect((await outFor(o.id)).length).toBeGreaterThan(out.length);
  });

  it('onaysız (varsayılan): status_notify_channel none, hiçbir WhatsApp/SMS mesajı ve konuşma oluşmaz', async () => {
    const phone = '0533 444 55 02';
    const before = await ctx.db.select().from(conversations).where(eq(conversations.tenantId, s.tenantId));
    const o = await placeManual(phone);
    expect(o).toMatchObject({ channel: 'manual', status: 'accepted', statusNotifyChannel: 'none' });
    expect(o.sourceMeta).toMatchObject({ notifyConsent: false });

    await flushNotify(ctx);
    await transition(ctx, { orderId: o.id, tenantId: s.tenantId, to: 'on_the_way', actor: { type: 'user' } });
    await transition(ctx, { orderId: o.id, tenantId: s.tenantId, to: 'delivered', actor: { type: 'user' } });
    await flushNotify(ctx);
    expect(await outFor(o.id)).toHaveLength(0);
    const sms = await ctx.db.select().from(smsMessages).where(eq(smsMessages.tenantId, s.tenantId));
    expect(sms.filter((m) => m.toPhone === o.customerPhone)).toHaveLength(0);
    const after = await ctx.db.select().from(conversations).where(eq(conversations.tenantId, s.tenantId));
    expect(after.length).toBe(before.length);
  });

  it('açıkça false gönderilince de mesaj gitmez', async () => {
    const o = await placeManual('0533 444 55 03', false);
    expect(o.statusNotifyChannel).toBe('none');
    await flushNotify(ctx);
    expect(await outFor(o.id)).toHaveLength(0);
  });
});

describe('telefon siparişi: alarm zinciri ve tekrar gönderim', () => {
  it('"Onaylı olarak kaydet" kapalı: alarm zinciri kurulmaz, 16 dk sonra otomatik iptal edilmez', async () => {
    const res = await ctx.request({
      method: 'POST',
      url: '/api/v1/panel/orders/manual',
      cookie: cashier,
      body: { ...manualBody('0533 444 55 04'), acceptNow: false },
    });
    expect(res.statusCode, res.body).toBe(200);
    const id = res.json().order.id as string;
    const alarmJobs = await ctx.db.select().from(jobs).where(and(eq(jobs.type, 'order.alarm_step'), sql`${jobs.payload}->>'orderId' = ${id}`));
    expect(alarmJobs).toHaveLength(0);
    await runJobs(ctx, ['order.alarm_step', 'order.finalize_rejection'], new Date(Date.now() + 16 * 60_000));
    const [o] = await ctx.db.select().from(orders).where(eq(orders.id, id));
    expect(o).toMatchObject({ status: 'new', cancelReason: null });
    expect(await ctx.db.select().from(smsMessages).where(eq(smsMessages.tenantId, s.tenantId))).toHaveLength(0);
  });

  it('aynı idempotencyKey ile eşzamanlı iki istek: ikisi de 200, tek sipariş', async () => {
    const body = { ...manualBody('0533 444 55 05'), idempotencyKey: 'telefon-siparis-es-zamanli-1' };
    const [r1, r2] = await Promise.all([
      ctx.request({ method: 'POST', url: '/api/v1/panel/orders/manual', cookie: cashier, body }),
      ctx.request({ method: 'POST', url: '/api/v1/panel/orders/manual', cookie: cashier, body }),
    ]);
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r2.statusCode, r2.body).toBe(200);
    expect(r1.json().order.id).toBe(r2.json().order.id);
    const rows = await ctx.db.select().from(orders).where(eq(orders.idempotencyKey, body.idempotencyKey));
    expect(rows).toHaveLength(1);
  });
});
