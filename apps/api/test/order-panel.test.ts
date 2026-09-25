// Panel sipariş API'si (14 §6.3): canlı liste, aksiyonlar (FSM), ret + geri al + kesinleşme, gecikme, kurye,
// telefon siparişi, fiş, rol ve tenant yalıtımı.

import { auditLog, branches, jobs, orderAcks, orders, products } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createTestContext, expectError, expectIsolated, testConfig, type TestContext } from './helpers';
import { createHookedOrder, jobsFor, runJobsAt, setupStore, stubExternalJobs, type StoreFixture } from './orders-helpers';

let ctx: TestContext;
let s: StoreFixture;
let other: StoreFixture;
let cashier: string;
let kitchen: string;
let courier: { user: { id: string }; cookie: string };

beforeAll(async () => {
  ctx = await createTestContext();
  stubExternalJobs();
  s = await setupStore(ctx, { wa: 'connected' });
  other = await setupStore(ctx, { wa: 'connected' });
  cashier = (await ctx.createStaff(s.tenantId, 'cashier')).cookie;
  kitchen = (await ctx.createStaff(s.tenantId, 'kitchen')).cookie;
  courier = await ctx.createStaff(s.tenantId, 'courier');
});
afterAll(async () => {
  await ctx.close();
});

const post = (url: string, cookie: string, body?: unknown) => ctx.request({ method: 'POST', url: `/api/v1/panel${url}`, cookie, body: body ?? {} });
const get = (url: string, cookie: string) => ctx.request({ method: 'GET', url: `/api/v1/panel${url}`, cookie });
const statusOf = async (id: string) => (await ctx.db.select().from(orders).where(eq(orders.id, id)))[0]!;

describe('canlı liste ve roller', () => {
  it('active: açık siparişler kartlarla; mutfak fiyatsız ve kişisel verisiz yalnız hazırlık durumları', async () => {
    const n = await createHookedOrder(ctx, s);
    const a = await createHookedOrder(ctx, s);
    await post(`/orders/${a.id}/accept`, s.ownerCookie, { etaMinutes: 20 });

    const res = await get('/orders/active', s.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    const ids = res.json().items.map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining([n.id, a.id]));
    const card = res.json().items.find((c: { id: string }) => c.id === n.id);
    expect(card).toMatchObject({ status: 'new', totalKurus: 16000, customerName: 'Test Müşteri', itemCount: 1 });
    expect(card.items[0]).toMatchObject({ name: 'Kıymalı Pide', quantity: 1, options: ['Acısız'] });

    const k = await get('/orders/active', kitchen);
    expect(k.statusCode).toBe(200);
    const kIds = k.json().items.map((c: { id: string }) => c.id);
    expect(kIds).toContain(a.id);
    expect(kIds).not.toContain(n.id);
    expect(k.body).not.toMatch(/Kurus/);
    expect(k.body).not.toContain('Test Müşteri');
    expect(k.json().completed).toEqual([]);

    const kd = await get(`/orders/${a.id}`, kitchen);
    expect(kd.statusCode, kd.body).toBe(200);
    expect(kd.body).not.toMatch(/Kurus/);
    expect(kd.json().customerPhone).toBeNull();
  });

  it('mutfak: onay/ret yok (403), preparing/ready ilerletir, teslim edemez', async () => {
    const o = await createHookedOrder(ctx, s);
    expect((await post(`/orders/${o.id}/accept`, kitchen, { etaMinutes: 20 })).statusCode).toBe(403);
    expect((await post(`/orders/${o.id}/reject`, kitchen, { reason: 'closed' })).statusCode).toBe(403);
    await post(`/orders/${o.id}/accept`, cashier, { etaMinutes: 20 });
    expect((await post(`/orders/${o.id}/advance`, kitchen, { to: 'preparing' })).statusCode).toBe(200);
    expect((await post(`/orders/${o.id}/advance`, kitchen, { to: 'ready' })).statusCode).toBe(200);
    expect((await post(`/orders/${o.id}/advance`, kitchen, { to: 'delivered' })).statusCode).toBe(403);
    expect((await statusOf(o.id)).status).toBe('ready');
  });

  it('kurye rolü panel sipariş uçlarına erişemez', async () => {
    expect((await get('/orders/active', courier.cookie)).statusCode).toBe(403);
  });

  it('tenant yalıtımı: başka işletmenin siparişi 404', async () => {
    const foreign = await createHookedOrder(ctx, other);
    expectIsolated(await get(`/orders/${foreign.id}`, s.ownerCookie));
    for (const [url, body] of [
      [`/orders/${foreign.id}/accept`, { etaMinutes: 20 }],
      [`/orders/${foreign.id}/reject`, { reason: 'closed' }],
      [`/orders/${foreign.id}/ack`, {}],
      [`/orders/${foreign.id}/advance`, { to: 'ready' }],
      [`/orders/${foreign.id}/delay`, { extraMinutes: 10 }],
      [`/orders/${foreign.id}/verify`, {}],
    ] as const) {
      expect((await post(url, s.ownerCookie, body)).statusCode, url).toBe(404);
    }
    expect((await get(`/orders/${foreign.id}/receipt?type=kitchen`, s.ownerCookie)).statusCode).toBe(404);
    const list = await get('/orders', s.ownerCookie);
    expect(list.json().items.map((c: { id: string }) => c.id)).not.toContain(foreign.id);
    expect((await statusOf(foreign.id)).status).toBe('new');
  });
});

describe('aksiyonlar', () => {
  it('ack: order_acks + ilk ack first_acked_at', async () => {
    const o = await createHookedOrder(ctx, s);
    const r1 = await post(`/orders/${o.id}/ack`, cashier, { deviceLabel: 'Kasa tableti' });
    expect(r1.statusCode, r1.body).toBe(200);
    const first = r1.json().order.firstAckedAt;
    expect(first).toBeTruthy();
    const r2 = await post(`/orders/${o.id}/ack`, s.ownerCookie);
    expect(r2.json().order.firstAckedAt).toBe(first);
    expect(await ctx.db.select().from(orderAcks).where(eq(orderAcks.orderId, o.id))).toHaveLength(2);
  });

  it('accept: tahmini saat 5 dk\'ya yukarı yuvarlanır, sürüm çakışması 409, audit', async () => {
    const o = await createHookedOrder(ctx, s);
    expectError(await post(`/orders/${o.id}/accept`, s.ownerCookie, { etaMinutes: 25, version: o.version + 5 }), 409, 'version_conflict');
    const res = await post(`/orders/${o.id}/accept`, s.ownerCookie, { etaMinutes: 25, version: o.version });
    expect(res.statusCode, res.body).toBe(200);
    const c = res.json().order;
    expect(c.status).toBe('accepted');
    expect(c.etaMinutes).toBe(25);
    const eta = new Date(c.estimatedReadyAt).getTime();
    expect(eta % (5 * 60_000)).toBe(0);
    expect(eta - Date.now()).toBeGreaterThan(24 * 60_000);
    const logs = await ctx.db.select().from(auditLog).where(and(eq(auditLog.entityId, o.id), eq(auditLog.action, 'order.accept')));
    expect(logs).toHaveLength(1);
    // alarm zinciri iptal
    const alarms = await jobsFor(ctx, o.id, 'order.alarm_step');
    expect(alarms.every((j) => j.status === 'cancelled')).toBe(true);
  });

  it('ret → bekleyen ret; onay 409 rejection_pending; geri al; yeniden ret → 30 sn sonra rejected', async () => {
    const o = await createHookedOrder(ctx, s);
    const rej = await post(`/orders/${o.id}/reject`, cashier, { reason: 'too_busy' });
    expect(rej.statusCode, rej.body).toBe(200);
    expect(rej.json().order).toMatchObject({ status: 'new', rejectionReason: 'too_busy' });
    expect(rej.json().order.rejectionScheduledAt).toBeTruthy();
    expect(new Date(rej.json().undoDeadline).getTime() - Date.now()).toBeGreaterThan(25_000);
    expectError(await post(`/orders/${o.id}/accept`, cashier, { etaMinutes: 20 }), 409, 'rejection_pending');
    expectError(await post(`/orders/${o.id}/reject`, cashier, { reason: 'closed' }), 409, 'rejection_pending');
    const fin = await jobsFor(ctx, o.id, 'order.finalize_rejection');
    expect(fin).toHaveLength(1);
    expect(fin[0]!.dedupeKey).toBe(`finalize_rejection:${o.id}`);

    const undo = await post(`/orders/${o.id}/undo-reject`, cashier);
    expect(undo.statusCode, undo.body).toBe(200);
    expect(undo.json().order).toMatchObject({ status: 'new', rejectionScheduledAt: null, rejectionReason: null });
    expect((await jobsFor(ctx, o.id, 'order.finalize_rejection'))[0]!.status).toBe('cancelled');
    expectError(await post(`/orders/${o.id}/undo-reject`, cashier), 409, 'no_pending_rejection');
    // geri alınmış ret işi 30 sn sonra çalışsa da sipariş new kalır
    await runJobsAt(ctx, 31_000);
    expect((await statusOf(o.id)).status).toBe('new');

    await post(`/orders/${o.id}/reject`, cashier, { reason: 'other', note: 'Malzeme bitti' });
    await runJobsAt(ctx, 31_000);
    const done = await statusOf(o.id);
    expect(done).toMatchObject({ status: 'rejected', rejectionReason: 'other', rejectionNote: 'Malzeme bitti', rejectionScheduledAt: null });
    expect(done.trackingExpiresAt).toBeTruthy();
    expectError(await post(`/orders/${o.id}/undo-reject`, cashier), 409, 'rejection_finalized');
  });

  it('ret: "Diğer" notsuz 400; "Ürün kalmadı" seçilen ürünleri bugün tükendi yapar; yalnız new reddedilir', async () => {
    const o = await createHookedOrder(ctx, s);
    expectError(await post(`/orders/${o.id}/reject`, cashier, { reason: 'other' }), 400, 'note_required');
    await post(`/orders/${o.id}/reject`, cashier, { reason: 'item_unavailable', soldOutProductIds: [s.ayranId] });
    const [p] = await ctx.db.select().from(products).where(eq(products.id, s.ayranId));
    expect(p!.soldOutUntil!.getTime()).toBeGreaterThan(Date.now());
    await ctx.db.update(products).set({ soldOutUntil: null }).where(eq(products.id, s.ayranId));

    const acc = await createHookedOrder(ctx, s);
    await post(`/orders/${acc.id}/accept`, cashier, { etaMinutes: 20 });
    expectError(await post(`/orders/${acc.id}/reject`, cashier, { reason: 'closed' }), 409, 'invalid_transition');
  });

  it('advance: FSM (new → ready yok), gel-alda yolda yok, teslimde ödendi', async () => {
    const o = await createHookedOrder(ctx, s);
    expectError(await post(`/orders/${o.id}/advance`, cashier, { to: 'ready' }), 409, 'invalid_transition');
    const p = await createHookedOrder(ctx, s, { fulfillmentType: 'pickup' });
    await post(`/orders/${p.id}/accept`, cashier, { etaMinutes: 15 });
    expectError(await post(`/orders/${p.id}/advance`, cashier, { to: 'on_the_way' }), 409, 'invalid_transition');
    expect((await post(`/orders/${p.id}/advance`, cashier, { to: 'ready' })).statusCode).toBe(200);
    const d = await post(`/orders/${p.id}/advance`, cashier, { to: 'delivered' });
    expect(d.json().order).toMatchObject({ status: 'delivered', paymentStatus: 'paid' });
  });

  it('cancel: new iptal edilemez (ret kullanılır); accepted → tenant iptali; "Müşteri istedi" → customer', async () => {
    const o = await createHookedOrder(ctx, s);
    expectError(await post(`/orders/${o.id}/cancel`, cashier, { reason: 'other', note: 'x' }), 409, 'invalid_transition');
    await post(`/orders/${o.id}/accept`, cashier, { etaMinutes: 20 });
    const res = await post(`/orders/${o.id}/cancel`, cashier, { reason: 'courier_issue' });
    expect(res.json().order).toMatchObject({ status: 'cancelled', cancelledBy: 'tenant', cancelReason: 'courier_issue' });

    const o2 = await createHookedOrder(ctx, s);
    await post(`/orders/${o2.id}/accept`, cashier, { etaMinutes: 20 });
    const r2 = await post(`/orders/${o2.id}/cancel`, cashier, { reason: 'customer_request' });
    expect(r2.json().order).toMatchObject({ status: 'cancelled', cancelledBy: 'customer', cancelReason: 'customer_request' });
  });

  it('delay: en çok 2 kez; müşteri bildirimi işi; tahmini saat uzar', async () => {
    const o = await createHookedOrder(ctx, s);
    expectError(await post(`/orders/${o.id}/delay`, cashier, { extraMinutes: 10 }), 409, 'invalid_transition');
    const acc = (await post(`/orders/${o.id}/accept`, cashier, { etaMinutes: 20 })).json().order;
    const d1 = await post(`/orders/${o.id}/delay`, cashier, { extraMinutes: 15 });
    expect(d1.statusCode, d1.body).toBe(200);
    expect(new Date(d1.json().order.estimatedReadyAt).getTime() - new Date(acc.estimatedReadyAt).getTime()).toBe(15 * 60_000);
    expect((await post(`/orders/${o.id}/delay`, cashier, { extraMinutes: 10 })).statusCode).toBe(200);
    expectError(await post(`/orders/${o.id}/delay`, cashier, { extraMinutes: 10 }), 409, 'delay_limit');
    const notes = (await jobsFor(ctx, o.id, 'order.notify_customer')).filter((j) => (j.payload as { event: string }).event === 'delay');
    expect(notes.map((j) => (j.payload as { extraMinutes: number }).extraMinutes).sort()).toEqual([10, 15]);
    expect((await statusOf(o.id)).delayNoticeCount).toBe(2);
  });

  it('assign-courier: yalnız bu işletmenin kuryesi; ata ve yola çıkar', async () => {
    const o = await createHookedOrder(ctx, s);
    await post(`/orders/${o.id}/accept`, cashier, { etaMinutes: 20 });
    const foreignCourier = await ctx.createStaff(other.tenantId, 'courier');
    expectError(await post(`/orders/${o.id}/assign-courier`, cashier, { userId: foreignCourier.user.id }), 404, 'not_found');
    const r = await post(`/orders/${o.id}/assign-courier`, cashier, { userId: courier.user.id });
    expect(r.json().order).toMatchObject({ courierUserId: courier.user.id, status: 'accepted', courierName: 'Test courier' });
    const r2 = await post(`/orders/${o.id}/assign-courier`, cashier, { userId: courier.user.id, onTheWay: true });
    expect(r2.json().order.status).toBe('on_the_way');
    const list = await get('/orders/couriers', cashier);
    expect(list.json().items.find((c: { id: string }) => c.id === courier.user.id)).toMatchObject({ onTheWayCount: 1 });
  });

  it('Telefonla doğruladım: awaiting_customer → new (staff) ve alarm zinciri', async () => {
    const o = await createHookedOrder(ctx, s, { status: 'awaiting_customer' });
    const r = await post(`/orders/${o.id}/verify`, cashier);
    expect(r.json().order).toMatchObject({ status: 'new', verificationMethod: 'staff' });
    expect(await jobsFor(ctx, o.id, 'order.alarm_step')).toHaveLength(5);
    const logs = await ctx.db.select().from(auditLog).where(and(eq(auditLog.entityId, o.id), eq(auditLog.action, 'order.verify_by_phone')));
    expect(logs).toHaveLength(1);
  });
});

describe('telefon siparişi (Akış E)', () => {
  it('manual: aynı işlemde new → accepted, kanal manual, staff; alarm kurulmaz', async () => {
    const res = await post('/orders/manual', cashier, {
      items: [{ productId: s.pideId, quantity: 1, optionIds: [s.acisizId] }],
      fulfillmentType: 'delivery',
      neighborhood: 'Tekke',
      customerName: 'Telefon Müşteri',
      customerPhone: '0533 222 33 44',
      addressLine: 'Kale Sk. 4',
      paymentMethod: 'card_on_delivery',
    });
    expect(res.statusCode, res.body).toBe(200);
    const c = res.json().order;
    expect(c).toMatchObject({ status: 'accepted', channel: 'manual', verificationMethod: 'staff', totalKurus: 16000 });
    expect(c.etaMinutes).toBe(50);
    const alarms = await jobsFor(ctx, c.id, 'order.alarm_step');
    expect(alarms.every((j) => j.status === 'cancelled')).toBe(true);
    const [o] = await ctx.db.select().from(orders).where(eq(orders.id, c.id));
    expect(o!.statusNotifyChannel).toBe('none');
    const lookup = await get('/orders/manual/customers?phone=2223344', cashier);
    expect(lookup.json().items[0]).toMatchObject({ name: 'Telefon Müşteri', orderCount: 1 });
    expect(lookup.json().items[0].addresses[0]).toMatchObject({ neighborhood: 'Tekke', addressLine: 'Kale Sk. 4' });
    expect(lookup.json().items[0].lastOrders[0].items[0].optionIds).toEqual([s.acisizId]);
  });

  it('bölge dışı: istisnasız 422; istisna ücretiyle kaydedilir ve audit', async () => {
    const body = {
      items: [{ productId: s.pideId, quantity: 1, optionIds: [s.acisizId] }],
      fulfillmentType: 'delivery',
      neighborhood: 'Bilinmeyen',
      customerName: 'Uzak Müşteri',
      customerPhone: '0533 222 33 55',
      addressLine: 'Köy yolu 1',
      paymentMethod: 'cash_on_delivery',
      acceptNow: false,
    };
    expectError(await post('/orders/manual', cashier, body), 422, 'cart_invalid');
    const ok = await post('/orders/manual', cashier, { ...body, outOfZoneFeeKurus: 5000 });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().order).toMatchObject({ status: 'new', deliveryFeeKurus: 5000, outOfZoneOverride: true });
    const logs = await ctx.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, ok.json().order.id), eq(auditLog.action, 'order.out_of_zone_override')));
    expect(logs).toHaveLength(1);
  });

  it('manual/menu: tükenenler işaretli, kısıtlı ürün yok', async () => {
    const res = await get('/orders/manual/menu', cashier);
    expect(res.statusCode).toBe(200);
    const productsList = res.json().categories.flatMap((c: { products: { id: string; soldOut: boolean }[] }) => c.products);
    expect(productsList.find((p: { id: string }) => p.id === s.rakiId)).toBeUndefined();
    expect(productsList.find((p: { id: string }) => p.id === s.soldOutId).soldOut).toBe(true);
    expect(res.json().zones).toHaveLength(2);
  });
});

describe('detay, liste ve fiş', () => {
  it('detay: olay geçmişi aktör adıyla, müşteri kısa geçmişi', async () => {
    const o = await createHookedOrder(ctx, s);
    await post(`/orders/${o.id}/accept`, s.ownerCookie, { etaMinutes: 30 });
    const d = await get(`/orders/${o.id}`, cashier);
    expect(d.statusCode, d.body).toBe(200);
    const b = d.json();
    expect(b.events.map((e: { type: string }) => e.type)).toEqual(['created', 'status_changed']);
    expect(b.events[1]).toMatchObject({ toStatus: 'accepted', actorName: 'Test Sahip' });
    expect(b.customerPhone).toBe('+905321234567');
    expect(b.trackingPath).toMatch(/^\/t\//);
  });

  it('liste: durum filtresi, arama, imleç; kasiyer yalnız bugün + dün', async () => {
    const res = await get('/orders?status=accepted,delivered&limit=2', s.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items).toHaveLength(2);
    expect(res.json().items.every((c: { status: string }) => ['accepted', 'delivered'].includes(c.status))).toBe(true);
    expect(res.json().nextCursor).toBeTruthy();
    const page2 = await get(`/orders?status=accepted,delivered&limit=2&cursor=${res.json().nextCursor}`, s.ownerCookie);
    const p1 = res.json().items.map((c: { id: string }) => c.id);
    for (const c of page2.json().items) expect(p1).not.toContain(c.id);

    const old = await createHookedOrder(ctx, s);
    await ctx.db.update(orders).set({ placedAt: new Date(Date.now() - 5 * 86400_000) }).where(eq(orders.id, old.id));
    const own = await get(`/orders?q=${old.number}`, s.ownerCookie);
    expect(own.json().items.map((c: { id: string }) => c.id)).toContain(old.id);
    const cash = await get(`/orders?q=${old.number}`, cashier);
    expect(cash.json().items.map((c: { id: string }) => c.id)).not.toContain(old.id);
    expect((await get('/orders', kitchen)).statusCode).toBe(403);
  });

  it('fiş: mutfak fiyatsız/kişisel verisiz; paket adres tam, telefon maskeli; yeniden baskı KOPYA; HTML', async () => {
    const o = await createHookedOrder(ctx, s);
    const k = await get(`/orders/${o.id}/receipt?type=kitchen&print=1`, cashier);
    expect(k.statusCode, k.body).toBe(200);
    expect(k.json()).toMatchObject({ type: 'kitchen', copy: false, customer: null, totals: null, payment: null });
    expect(k.body).not.toContain('Test Müşteri');
    expect(k.body).not.toMatch(/Kurus/);
    const again = await get(`/orders/${o.id}/receipt?type=kitchen&print=1`, cashier);
    expect(again.json().copy).toBe(true);

    const d = await get(`/orders/${o.id}/receipt?type=delivery`, cashier);
    expect(d.json().customer).toMatchObject({ addressLine: 'Test Sk. No 1', phoneMasked: '0*** *** 45 67' });
    expect(d.body).not.toContain('+905321234567');
    expect(d.json().footer).toBe('Mali değeri yoktur.');

    const html = await get(`/orders/${o.id}/receipt?type=delivery&format=html`, cashier);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.body).toContain(`#${o.number}`);
    expect(html.body).toContain('ACISIZ');

    expect((await get(`/orders/${o.id}/receipt?type=delivery`, kitchen)).statusCode).toBe(403);
    await ctx.db.update(orders).set({ status: 'new' }).where(eq(orders.id, o.id));
  });

  it('fiş ayarları (branches.receipt_settings) fişe yansır: kopya, yazı boyutu, genişlik, WhatsApp satırı, alt bilgi, baskı planı', async () => {
    const o = await createHookedOrder(ctx, s);
    // Varsayılanlar
    const d0 = await get(`/orders/${o.id}/receipt?type=delivery`, cashier);
    expect(d0.json()).toMatchObject({
      layout: { widthMm: 80, fontSize: 'normal', copies: 1, showLogo: true },
      waLine: 'Bir sonraki siparişinizi WhatsApp’tan verin: 0555 000 00 99',
      footerText: null,
      printPlan: { auto: true, kitchen: true, delivery: true },
    });
    const act0 = await get('/orders/active', cashier);
    expect(act0.json().branch.receipt).toEqual({ autoPrint: true, printKitchen: true, printDelivery: true });

    await ctx.db
      .update(branches)
      .set({
        receiptSettings: {
          width_mm: 58,
          font_size: 'large',
          copies: 2,
          show_logo: false,
          show_wa_line: false,
          footer_text: 'Afiyet olsun',
          auto_print: false,
          print_kitchen: false,
          print_delivery: true,
        },
      })
      .where(eq(branches.id, s.branchId));
    const d = await get(`/orders/${o.id}/receipt?type=delivery`, cashier);
    expect(d.json()).toMatchObject({
      layout: { widthMm: 58, fontSize: 'large', copies: 2, showLogo: false },
      waLine: null,
      footerText: 'Afiyet olsun',
      printPlan: { auto: false, kitchen: false, delivery: true },
    });
    // Mutfak fişi: alt bilgi/WhatsApp satırı yok, düzen aynı
    const k = await get(`/orders/${o.id}/receipt?type=kitchen`, kitchen);
    expect(k.json()).toMatchObject({ layout: { widthMm: 58, copies: 2 }, waLine: null, footerText: null });
    const html = await get(`/orders/${o.id}/receipt?type=delivery&format=html`, cashier);
    expect(html.body).toContain('size: 58mm auto');
    expect(html.body).toContain('font: 15px/1.35');
    expect(html.body.match(/<section class="copy/g)).toHaveLength(2);
    expect(html.body).toContain('Afiyet olsun');
    expect(html.body).not.toContain('WhatsApp’tan verin');
    // Sorgu parametresi genişliği ezer
    expect((await get(`/orders/${o.id}/receipt?type=delivery&format=html&width=80`, cashier)).body).toContain('size: 80mm auto');
    const act = await get('/orders/active', cashier);
    expect(act.json().branch.receipt).toEqual({ autoPrint: false, printKitchen: false, printDelivery: true });

    // Bozuk değerler varsayılana düşer
    await ctx.db.update(branches).set({ receiptSettings: { copies: 9, font_size: 'dev' } as never }).where(eq(branches.id, s.branchId));
    expect((await get(`/orders/${o.id}/receipt?type=kitchen`, cashier)).json().layout).toMatchObject({ copies: 1, fontSize: 'normal' });
    await ctx.db.update(branches).set({ receiptSettings: {} }).where(eq(branches.id, s.branchId));
    await ctx.db.update(orders).set({ status: 'new' }).where(eq(orders.id, o.id));
  });

  it('pending jobs yalnız bu işletmeye ait tenant_id taşır', async () => {
    const rows = await ctx.db.select().from(jobs).where(eq(jobs.type, 'order.alarm_step'));
    expect(rows.every((j) => j.tenantId === s.tenantId || j.tenantId === other.tenantId)).toBe(true);
  });
});

describe('SSE açılışında branch.state', () => {
  it('akış açılınca güncel sipariş alma durumu tek olay olarak gelir (id taşımaz)', async () => {
    const base = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const res = await fetch(`${base}/api/v1/panel/stream?branchId=${s.branchId}`, {
      headers: { cookie: s.ownerCookie, accept: 'text/event-stream' },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const deadline = Date.now() + 3000;
    while (!buf.includes('branch.state') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
    controller.abort();
    const frame = buf.split('\n\n').find((f) => f.includes('branch.state'))!;
    expect(frame).toBeTruthy();
    expect(frame).not.toMatch(/^id: /m);
    const data = JSON.parse(frame.replace(/^data: /, ''));
    expect(data).toMatchObject({ type: 'branch.state', data: { orderingState: 'open', busyExtraMinutes: 0, pausedUntil: null } });
  });
});

describe('istek logu: telefon ve belirteçler maskeli (CLAUDE.md kural 7)', () => {
  it('manuel sipariş müşteri araması ve takip linki URL\'si loga açık yazılmaz', async () => {
    const lines: string[] = [];
    const logStream = { write: (chunk: string) => void lines.push(chunk) };
    const app = await buildApp({ config: testConfig({ LOG_LEVEL: 'info' }), db: ctx.handle, logStream });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/panel/orders/manual/customers?phone=05321234567', headers: { cookie: cashier } });
      expect(res.statusCode, res.body).toBe(200);
      await app.inject({ method: 'GET', url: '/api/v1/store/track/gizli-takip-belirteci-123' });
    } finally {
      await app.close();
    }
    const log = lines.join('');
    expect(log).toContain('/api/v1/panel/orders/manual/customers?phone=***');
    expect(log).not.toContain('5321234567');
    expect(log).toContain('/api/v1/store/track/***');
    expect(log).not.toContain('gizli-takip-belirteci');
  });
});
