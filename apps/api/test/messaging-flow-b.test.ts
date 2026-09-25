// Akış B (sipariş kodu) ve buton yanıtları (review, wait, cancel) — konuşma motoru.

import { branchEvents, cancellationRequests, customers, jobs, notifications, orderEvents, orderVerificationCodes, orders, reviews } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OutboundPayload } from '../src/services/messaging/outbound';
import { transitionOrder } from '../src/services/orders/transition';
import { createTestContext, type TestContext } from './helpers';
import {
  MIN,
  conversationFor,
  createAwaitingOrder,
  flushNotify,
  getOrder,
  inbound,
  lastOut,
  outCodes,
  plus,
  setupWaTenant,
  threadRows,
  type WaSetup,
} from './wa-helpers';

let ctx: TestContext;
let t: WaSetup;
let seq = 2000;
const nextPhone = () => `+90533${String(1000000 + seq++).slice(-7)}`;
const text = (s: string) => ({ type: 'text' as const, text: s });

beforeAll(async () => {
  ctx = await createTestContext();
  t = await setupWaTenant(ctx, { name: 'Kod Test Lahmacun' });
});
afterAll(async () => {
  await ctx.close();
});

describe('Akış B: sipariş kodu', () => {
  it('geçerli kod → awaiting_customer→new (wa_code), müşteri+konuşma bağlanır, M05 anında', async () => {
    const phone = nextPhone();
    const order = await createAwaitingOrder(ctx, t, 'K7M2Q9');
    const t0 = new Date();
    await inbound(ctx, t.account, { phone, name: 'Veli' }, text('Sipariş kodu: K7M2Q9'), { now: t0 });
    const o = await getOrder(ctx.db, order.id);
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(o).toMatchObject({ status: 'new', verificationMethod: 'wa_code', customerId: conv!.customerId, conversationId: conv!.id, waStatusMsgCount: 1 });
    expect(o.verifiedAt).toBeInstanceOf(Date);
    const [vc] = await ctx.db.select().from(orderVerificationCodes).where(eq(orderVerificationCodes.orderId, order.id));
    expect(vc!.usedAt).toBeInstanceOf(Date);
    // Panel olayı (order.updated awaiting_customer → new)
    const evs = await ctx.db.select().from(branchEvents).where(and(eq(branchEvents.branchId, t.branchId), eq(branchEvents.type, 'order.updated')));
    expect(evs.some((e) => (e.payload as { from?: string; to?: string }).to === 'new')).toBe(true);
    // M05: debounce yok, iş hemen vadeli
    const out = await lastOut(ctx.db, conv!.id);
    expect((out!.payload as unknown as OutboundPayload).code).toBe('M05');
    expect(out!.orderId).toBe(order.id);
    expect(out!.body).toContain(`Siparişiniz alındı! Sipariş no: #${order.number}`);
    const [job] = await ctx.db.select().from(jobs).where(and(eq(jobs.type, 'wa.send'), eq(jobs.dedupeKey, `wa_send:${out!.id}`)));
    expect(Math.abs(job!.runAt.getTime() - Date.now())).toBeLessThan(5_000);
    expect((out!.payload as unknown as OutboundPayload).spec.type).toBe('interactive');
    // Kanca M05'i ikinci kez üretmez
    await flushNotify(ctx);
    expect((await outCodes(ctx.db, conv!.id)).filter((c) => c === 'M05')).toHaveLength(1);
    // Müşteri sayacı tek kez artar (sipariş kancası; motor ayrıca saymaz) ve ad siparişten gelir
    const [cust] = await ctx.db.select().from(customers).where(eq(customers.id, conv!.customerId!));
    expect(cust!.orderCount).toBe(1);
    expect(cust!.lastOrderAt).toBeInstanceOf(Date);
  });

  it('yalın kod da eşleşir; aynı kodla tekrar → M17d (zaten onaylandı)', async () => {
    const phone = nextPhone();
    const order = await createAwaitingOrder(ctx, t, 'AB3CD4');
    await inbound(ctx, t.account, { phone }, text('ab3cd4'));
    expect((await getOrder(ctx.db, order.id)).status).toBe('new');
    await inbound(ctx, t.account, { phone }, text('Sipariş kodu: AB3CD4'));
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M05', 'M17d']);
  });

  it('süresi dolmuş kod → M17c; bilinmeyen kod → M17b; 5 hatadan sonra sessiz + panel notu', async () => {
    const phone = nextPhone();
    await createAwaitingOrder(ctx, t, 'EXP2RD', { expiresAt: new Date(Date.now() - MIN) });
    await inbound(ctx, t.account, { phone }, text('Sipariş kodu: EXP2RD'));
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M17c']);

    const phone2 = nextPhone();
    const t0 = new Date();
    for (let i = 0; i < 7; i++) await inbound(ctx, t.account, { phone: phone2 }, text('Sipariş kodu: ZZ9ZZ9'), { now: plus(t0, i * 1000) });
    const conv2 = await conversationFor(ctx.db, t.account, phone2);
    expect(await outCodes(ctx.db, conv2!.id)).toEqual(['M17b', 'M17b', 'M17b', 'M17b', 'M17b']);
    const notes = await ctx.db.select().from(notifications).where(and(eq(notifications.tenantId, t.tenantId), eq(notifications.kind, 'order_code_attempts')));
    expect(notes).toHaveLength(1);
  });

  it('insan modundayken de kod işlenir', async () => {
    const phone = nextPhone();
    await inbound(ctx, t.account, { phone }, text('yetkili'));
    const order = await createAwaitingOrder(ctx, t, 'HM4N55');
    await inbound(ctx, t.account, { phone }, text('Sipariş kodu: HM4N55'));
    expect((await getOrder(ctx.db, order.id)).status).toBe('new');
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M20', 'M05']);
  });
});

describe('buton yanıtları', () => {
  async function deliveredOrderFor(phone: string) {
    const order = await createAwaitingOrder(ctx, t, `R${String(seq++).slice(-1)}V${String(seq++).slice(-1)}W${String(seq++).slice(-1)}`.replace(/[01]/g, '7'));
    const [vc] = await ctx.db.select().from(orderVerificationCodes).where(eq(orderVerificationCodes.orderId, order.id));
    await inbound(ctx, t.account, { phone }, text(`Sipariş kodu: ${vc!.code}`));
    await ctx.db.update(orders).set({ status: 'delivered', deliveredAt: new Date() }).where(eq(orders.id, order.id));
    return order;
  }

  it('review:good → reviews + M10a; tekrar basmak ikinci kayıt/yanıt üretmez', async () => {
    const phone = nextPhone();
    const order = await deliveredOrderFor(phone);
    await inbound(ctx, t.account, { phone }, { type: 'button_reply', id: `review:${order.id}:good`, title: 'Harika' });
    await inbound(ctx, t.account, { phone }, { type: 'button_reply', id: `review:${order.id}:bad`, title: 'Beğenmedim' });
    const rs = await ctx.db.select().from(reviews).where(eq(reviews.orderId, order.id));
    expect(rs).toHaveLength(1);
    expect(rs[0]!.rating).toBe('good');
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M05', 'M10a']);
  });

  it('review:bad → M10b liste + panel bildirimi; liste seçimi → yorum + M10c', async () => {
    const phone = nextPhone();
    const order = await deliveredOrderFor(phone);
    await inbound(ctx, t.account, { phone }, { type: 'button_reply', id: `review:${order.id}:bad`, title: 'Beğenmedim' });
    const conv = await conversationFor(ctx.db, t.account, phone);
    const m10b = await lastOut(ctx.db, conv!.id);
    const p = m10b!.payload as unknown as OutboundPayload;
    expect(p.code).toBe('M10b');
    expect(p.spec.type === 'interactive' && p.spec.interactive.kind).toBe('list');
    await inbound(ctx, t.account, { phone }, { type: 'list_reply', id: `review_reason:${order.id}:cold`, title: 'Soğuk geldi' });
    const [r] = await ctx.db.select().from(reviews).where(eq(reviews.orderId, order.id));
    expect(r).toMatchObject({ rating: 'bad', comment: 'Soğuk geldi' });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M05', 'M10b', 'M10c']);
    const notes = await ctx.db.select().from(notifications).where(and(eq(notifications.orderId, order.id), eq(notifications.kind, 'review_negative')));
    expect(notes).toHaveLength(1);
  });

  it('wait:<id> → M13a + "Müşteri bekliyor" sipariş olayı (bir kez)', async () => {
    const phone = nextPhone();
    const order = await createAwaitingOrder(ctx, t, 'W4AT52');
    await inbound(ctx, t.account, { phone }, text('Sipariş kodu: W4AT52'));
    await inbound(ctx, t.account, { phone }, { type: 'button_reply', id: `wait:${order.id}`, title: 'Beklerim' });
    await inbound(ctx, t.account, { phone }, { type: 'button_reply', id: `wait:${order.id}`, title: 'Beklerim' });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M05', 'M13a']);
    const evs = await ctx.db.select().from(orderEvents).where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.type, 'customer_waiting')));
    expect(evs).toHaveLength(1);
  });

  it('cancel:<id> (new) → cancelled customer/customer_request + M12b (bildirim kancası)', async () => {
    const phone = nextPhone();
    const order = await createAwaitingOrder(ctx, t, 'CNC3L2');
    await inbound(ctx, t.account, { phone }, text('Sipariş kodu: CNC3L2'));
    await inbound(ctx, t.account, { phone }, { type: 'button_reply', id: `cancel:${order.id}`, title: 'Siparişi iptal et' });
    const o = await getOrder(ctx.db, order.id);
    expect(o).toMatchObject({ status: 'cancelled', cancelledBy: 'customer', cancelReason: 'customer_request' });
    await flushNotify(ctx);
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M05', 'M12b']);
    expect((await lastOut(ctx.db, conv!.id))!.body).toBe(`#${o.number} numaralı siparişiniz isteğiniz üzerine iptal edildi.`);
  });

  it('cancel:<id> (accepted) → iptal talebi + M27b + insan modu', async () => {
    const phone = nextPhone();
    const order = await createAwaitingOrder(ctx, t, 'ACC3P7');
    await inbound(ctx, t.account, { phone }, text('Sipariş kodu: ACC3P7'));
    await ctx.db.update(orders).set({ status: 'accepted', acceptedAt: new Date() }).where(eq(orders.id, order.id));
    await inbound(ctx, t.account, { phone }, { type: 'button_reply', id: `cancel:${order.id}`, title: 'Siparişi iptal et' });
    const [req] = await ctx.db.select().from(cancellationRequests).where(eq(cancellationRequests.orderId, order.id));
    expect(req!.status).toBe('pending');
    expect((await getOrder(ctx.db, order.id)).cancelRequestedAt).toBeInstanceOf(Date);
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M05', 'M27b']);
    expect(conv!.mode).toBe('human');
  });

  it('eşzamanlı: panel onayı satırı kilitliyken gelen cancel:<id> kilitlenmez (40P01 yok), iptal talebine döner', async () => {
    const phone = nextPhone();
    const order = await createAwaitingOrder(ctx, t, 'RCE4K8');
    await inbound(ctx, t.account, { phone }, text('Sipariş kodu: RCE4K8'));
    let rowLocked!: () => void;
    const locked = new Promise<void>((r) => (rowLocked = r));
    // Panel: önce satır kilidi, sonra (bekleyip) geçiş → şube olayı (advisory lock)
    const panel = ctx.db.transaction(async (tx) => {
      await tx.select().from(orders).where(eq(orders.id, order.id)).for('update');
      rowLocked();
      await new Promise((r) => setTimeout(r, 300));
      await transitionOrder(tx, { orderId: order.id, tenantId: t.tenantId, to: 'accepted', actor: { type: 'user' } });
    });
    await locked;
    const customer = inbound(ctx, t.account, { phone }, { type: 'button_reply', id: `cancel:${order.id}`, title: 'Siparişi iptal et' });
    const [p, c] = await Promise.allSettled([panel, customer]);
    expect(p.status, p.status === 'rejected' ? String(p.reason) : '').toBe('fulfilled');
    expect(c.status, c.status === 'rejected' ? String(c.reason) : '').toBe('fulfilled');
    const o = await getOrder(ctx.db, order.id);
    expect(o).toMatchObject({ status: 'accepted', cancelledBy: null });
    expect(o.cancelRequestedAt).toBeInstanceOf(Date);
    const [req] = await ctx.db.select().from(cancellationRequests).where(eq(cancellationRequests.orderId, order.id));
    expect(req!.status).toBe('pending');
  });

  it('başka müşterinin siparişine ait buton yok sayılır', async () => {
    const owner = nextPhone();
    const order = await createAwaitingOrder(ctx, t, 'QWN3R5');
    await inbound(ctx, t.account, { phone: owner }, text('Sipariş kodu: QWN3R5'));
    const stranger = nextPhone();
    await inbound(ctx, t.account, { phone: stranger }, { type: 'button_reply', id: `cancel:${order.id}`, title: 'Siparişi iptal et' });
    expect((await getOrder(ctx.db, order.id)).status).toBe('new');
    const conv = await conversationFor(ctx.db, t.account, stranger);
    expect((await threadRows(ctx.db, conv!.id)).filter((r) => r.direction === 'out')).toHaveLength(0);
  });
});
