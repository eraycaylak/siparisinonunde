import { branchEvents, orderEvents, orders } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors';
import {
  createOrderNumber,
  offOrderCreated,
  offOrderTransition,
  onOrderCreated,
  onOrderTransition,
  recordOrderCreated,
  transitionOrder,
  transitionOrderTx,
  type OrderTransitionEvent,
} from '../src/services/orders/transition';
import { createTestContext, type TestContext, type TestTenant } from './helpers';

let ctx: TestContext;
let t: TestTenant;

beforeAll(async () => {
  ctx = await createTestContext();
  t = await ctx.createTenantWithOwner();
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => {
  offOrderTransition('test');
  offOrderCreated('test');
});

const user = () => ({ type: 'user' as const, userId: t.owner.id });

async function expectAppError(p: Promise<unknown>, status: number, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === status && e.code === code);
}

describe('transitionOrder', () => {
  it('geçerli geçiş: durum, sürüm, zaman damgası, order_events, branch_events', async () => {
    const order = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new' });
    const res = await transitionOrderTx(ctx.db, {
      orderId: order.id,
      tenantId: t.tenantId,
      to: 'accepted',
      actor: user(),
      extra: { etaMinutes: 30 },
    });
    expect(res.changed).toBe(true);
    expect(res.from).toBe('new');
    expect(res.order.status).toBe('accepted');
    expect(res.order.version).toBe(order.version + 1);
    expect(res.order.acceptedAt).toBeInstanceOf(Date);
    expect(res.order.acceptedByUserId).toBe(t.owner.id);
    expect(res.order.etaMinutes).toBe(30);
    expect(res.summary).toMatchObject({ id: order.id, status: 'accepted', itemCount: 1, customerPhoneMasked: '0*** *** 45 67' });

    const ev = await ctx.db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ fromStatus: 'new', toStatus: 'accepted', actorType: 'user', actorUserId: t.owner.id, type: 'status_changed' });

    const [be] = await ctx.db.select().from(branchEvents).where(eq(branchEvents.seq, res.seq!));
    expect(be).toMatchObject({ type: 'order.updated', branchId: t.branchId, tenantId: t.tenantId });
    expect(be!.payload).toMatchObject({ change: 'status', from: 'new', to: 'accepted', order: { id: order.id, status: 'accepted' } });
  });

  it('tüm akış: accepted → preparing → ready → on_the_way → delivered; takip süresi final + 7 gün', async () => {
    const order = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'accepted', extra: { fulfillmentType: 'delivery' } });
    for (const to of ['preparing', 'ready', 'on_the_way', 'delivered'] as const) {
      await transitionOrderTx(ctx.db, { orderId: order.id, tenantId: t.tenantId, to, actor: user() });
    }
    const [o] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.status).toBe('delivered');
    expect(o!.preparingAt && o!.readyAt && o!.onTheWayAt && o!.deliveredAt).toBeTruthy();
    const ttlDays = (o!.trackingExpiresAt!.getTime() - o!.deliveredAt!.getTime()) / 86400000;
    expect(ttlDays).toBeCloseTo(7, 5);
    expect(o!.version).toBe(order.version + 4);
  });

  it('geçersiz geçiş → 409 invalid_transition; final durumdan çıkış yok', async () => {
    const order = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new' });
    await expectAppError(transitionOrderTx(ctx.db, { orderId: order.id, tenantId: t.tenantId, to: 'delivered', actor: user() }), 409, 'invalid_transition');
    const done = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'rejected', extra: { rejectionReason: 'too_busy' } });
    await expectAppError(transitionOrderTx(ctx.db, { orderId: done.id, tenantId: t.tenantId, to: 'new', actor: user() }), 409, 'invalid_transition');
  });

  it('sürüm çakışması → 409 version_conflict; zaten hedefteyse no-op', async () => {
    const order = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new' });
    await expectAppError(
      transitionOrderTx(ctx.db, { orderId: order.id, tenantId: t.tenantId, to: 'accepted', actor: user(), expectedVersion: 99 }),
      409,
      'version_conflict',
    );
    const ok = await transitionOrderTx(ctx.db, { orderId: order.id, tenantId: t.tenantId, to: 'accepted', actor: user(), expectedVersion: 1 });
    expect(ok.changed).toBe(true);
    const again = await transitionOrderTx(ctx.db, { orderId: order.id, tenantId: t.tenantId, to: 'accepted', actor: user(), expectedVersion: 1 });
    expect(again.changed).toBe(false);
    expect(again.seq).toBeNull();
    expect(again.order.version).toBe(2);
  });

  it('eşzamanlı iki onay: biri kazanır, diğeri no-op (satır kilidi)', async () => {
    const order = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new' });
    const input = { orderId: order.id, tenantId: t.tenantId, to: 'accepted' as const, actor: user(), expectedVersion: 1 };
    const [a, b] = await Promise.all([transitionOrderTx(ctx.db, input), transitionOrderTx(ctx.db, input)]);
    expect([a.changed, b.changed].sort()).toEqual([false, true]);
    const ev = await ctx.db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id));
    expect(ev).toHaveLength(1);
  });

  it('ret sebebi zorunlu; other için not; iptalde cancelled_by aktörden türetilir', async () => {
    const o1 = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new' });
    await expectAppError(transitionOrderTx(ctx.db, { orderId: o1.id, tenantId: t.tenantId, to: 'rejected', actor: user() }), 400, 'reason_required');
    await expectAppError(
      transitionOrderTx(ctx.db, { orderId: o1.id, tenantId: t.tenantId, to: 'rejected', actor: user(), reason: 'other' }),
      400,
      'note_required',
    );
    const rej = await transitionOrderTx(ctx.db, { orderId: o1.id, tenantId: t.tenantId, to: 'rejected', actor: user(), reason: 'too_busy' });
    expect(rej.order).toMatchObject({ status: 'rejected', rejectionReason: 'too_busy' });
    expect(rej.order.rejectedAt).toBeInstanceOf(Date);

    const o2 = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'accepted' });
    const c = await transitionOrderTx(ctx.db, {
      orderId: o2.id,
      tenantId: t.tenantId,
      to: 'cancelled',
      actor: user(),
      reason: 'courier_issue',
      note: 'Kurye yok',
    });
    expect(c.order).toMatchObject({ cancelledBy: 'tenant', cancelReason: 'courier_issue', cancelNote: 'Kurye yok' });

    const o3 = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new' });
    const sys = await transitionOrderTx(ctx.db, { orderId: o3.id, tenantId: t.tenantId, to: 'cancelled', actor: { type: 'system' }, reason: 'tenant_no_response' });
    expect(sys.order.cancelledBy).toBe('system');
  });

  it('bekleyen ret varken onay → 409 rejection_pending; iptal bekleyen reti temizler', async () => {
    const order = await ctx.createOrder({
      tenantId: t.tenantId,
      branchId: t.branchId,
      status: 'new',
      extra: { rejectionScheduledAt: new Date(Date.now() + 30_000), rejectionReason: 'too_busy' },
    });
    await expectAppError(transitionOrderTx(ctx.db, { orderId: order.id, tenantId: t.tenantId, to: 'accepted', actor: user() }), 409, 'rejection_pending');
    const c = await transitionOrderTx(ctx.db, { orderId: order.id, tenantId: t.tenantId, to: 'cancelled', actor: { type: 'customer' }, reason: 'customer_request' });
    expect(c.order.rejectionScheduledAt).toBeNull();
    expect(c.order.cancelledBy).toBe('customer');
  });

  it('başka tenant\'ın siparişi → 404', async () => {
    const other = await ctx.createTenantWithOwner();
    const order = await ctx.createOrder({ tenantId: other.tenantId, branchId: other.branchId, status: 'new' });
    await expectAppError(transitionOrderTx(ctx.db, { orderId: order.id, tenantId: t.tenantId, to: 'accepted', actor: user() }), 404, 'not_found');
  });

  it('onOrderTransition aynı transaction\'da çağrılır; hata geçişi geri alır', async () => {
    const calls: Pick<OrderTransitionEvent, 'from' | 'to' | 'reason'>[] = [];
    onOrderTransition('test', async (e) => {
      calls.push({ from: e.from, to: e.to, reason: e.reason });
      // Kanca aynı tx'i görür
      const [row] = await e.tx.select({ status: orders.status }).from(orders).where(eq(orders.id, e.order.id));
      expect(row!.status).toBe(e.to);
    });
    const order = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new' });
    await transitionOrderTx(ctx.db, { orderId: order.id, tenantId: t.tenantId, to: 'rejected', actor: user(), reason: 'closed' });
    expect(calls).toEqual([{ from: 'new', to: 'rejected', reason: 'closed' }]);

    onOrderTransition('test', () => {
      throw new Error('yan etki başarısız');
    });
    const o2 = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new' });
    await expect(transitionOrderTx(ctx.db, { orderId: o2.id, tenantId: t.tenantId, to: 'accepted', actor: user() })).rejects.toThrow('yan etki');
    const [after] = await ctx.db.select().from(orders).where(eq(orders.id, o2.id));
    expect(after!.status).toBe('new');
    expect(await ctx.db.select().from(orderEvents).where(eq(orderEvents.orderId, o2.id))).toHaveLength(0);
  });
});

describe('sipariş numarası ve oluşturma kaydı', () => {
  it('tenant başına artan numara (1001…); tenant\'lar bağımsız', async () => {
    const a = await ctx.createTenantWithOwner();
    const b = await ctx.createTenantWithOwner();
    const nums = await ctx.db.transaction(async (tx) => [
      await createOrderNumber(tx, a.tenantId),
      await createOrderNumber(tx, a.tenantId),
      await createOrderNumber(tx, b.tenantId),
    ]);
    expect(nums).toEqual([1001, 1002, 1001]);
    // Eşzamanlı üretimde çakışma yok
    const par = await Promise.all(Array.from({ length: 8 }, () => ctx.db.transaction((tx) => createOrderNumber(tx, a.tenantId))));
    expect(new Set(par).size).toBe(8);
  });

  it('recordOrderCreated: order_events + order.created + onOrderCreated', async () => {
    const seen: string[] = [];
    onOrderCreated('test', (e) => {
      seen.push(e.summary.id);
    });
    const order = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new' });
    const { seq, summary } = await ctx.db.transaction((tx) => recordOrderCreated(tx, { order, actor: { type: 'customer' } }));
    expect(seen).toEqual([order.id]);
    expect(summary.number).toBe(order.number);
    const [be] = await ctx.db.select().from(branchEvents).where(and(eq(branchEvents.seq, seq), eq(branchEvents.tenantId, t.tenantId)));
    expect(be!.type).toBe('order.created');
    const [ev] = await ctx.db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id));
    expect(ev).toMatchObject({ type: 'created', fromStatus: null, toStatus: 'new', actorType: 'customer' });
  });

  it('transitionOrder transaction dışında da tek başına tutarlı (transitionOrder + db.transaction)', async () => {
    const order = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'awaiting_customer' });
    const res = await ctx.db.transaction((tx) =>
      transitionOrder(tx, { orderId: order.id, tenantId: t.tenantId, to: 'new', actor: { type: 'customer' }, extra: { verificationMethod: 'sms_otp' } }),
    );
    expect(res.order.verificationMethod).toBe('sms_otp');
    expect(res.order.verifiedAt).toBeInstanceOf(Date);
  });
});
