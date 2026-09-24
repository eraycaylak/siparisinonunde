// Kademeli alarm zinciri (00 §10, 04 §4.5) — sahte saatle işler: adımlar, iptal, bekleyen ret, test siparişleri,
// awaiting_customer zaman aşımı.

import { branchEvents, branches, orderEvents, orders } from '@siparis/db';
import { and, eq, gt } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers';
import { createHookedOrder, jobsFor, runJobsAt, setupStore, stubExternalJobs, type StoreFixture } from './orders-helpers';

let ctx: TestContext;
let s: StoreFixture;
let calls: ReturnType<typeof stubExternalJobs>;

const MIN = 60_000;

beforeAll(async () => {
  ctx = await createTestContext();
  calls = stubExternalJobs();
  s = await setupStore(ctx, { wa: 'connected' });
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  // Önceki testlerin zincirleri birbirini etkilemesin
  await ctx.sql`update jobs set status = 'cancelled' where status = 'pending'`;
  for (const k of Object.keys(calls)) calls[k]!.length = 0;
});

const byOrder = (type: string, orderId: string) => calls[type]!.filter((p) => p.orderId === orderId);
const statusOf = async (id: string) => (await ctx.db.select().from(orders).where(eq(orders.id, id)))[0]!;
async function alarmEvents(orderId: string) {
  const rows = await ctx.db
    .select()
    .from(branchEvents)
    .where(and(eq(branchEvents.branchId, s.branchId), eq(branchEvents.type, 'order.alarm'), gt(branchEvents.seq, 0)));
  return rows.filter((r) => (r.payload as { orderId: string }).orderId === orderId).map((r) => (r.payload as { step: number }).step);
}

describe('zincir (varsayılan politika 15/10 dk)', () => {
  it('adımlar sırasıyla: 60 sn SSE, 2 dk platform uyarısı, 5 dk SMS, 10 dk müşteri, 15 dk otomatik iptal', async () => {
    const o = await createHookedOrder(ctx, s);
    const planned = await jobsFor(ctx, o.id, 'order.alarm_step');
    const delays = planned
      .map((j) => [(j.payload as { step: number }).step, Math.round((j.runAt.getTime() - o.createdAt.getTime()) / 1000)] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(delays.map((d) => d[0])).toEqual([2, 3, 4, 5, 6]);
    expect(delays.map((d) => Math.round(d[1] / 60))).toEqual([1, 2, 5, 10, 15]);

    await runJobsAt(ctx, 30_000);
    expect(await alarmEvents(o.id)).toEqual([]);

    await runJobsAt(ctx, 61_000);
    expect(await alarmEvents(o.id)).toEqual([2]);
    expect(byOrder('platform.alert', o.id)).toHaveLength(0);

    await runJobsAt(ctx, 2 * MIN + 1000);
    expect(byOrder('platform.alert', o.id)).toEqual([
      expect.objectContaining({ tenantId: s.tenantId, branchId: s.branchId, kind: 'new_order_alarm', orderId: o.id, test: false }),
    ]);

    await runJobsAt(ctx, 5 * MIN + 1000);
    const sms = byOrder('sms.send', o.id);
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ purpose: 'alarm', tenantId: s.tenantId });
    expect(String(sms[0]!.to)).toMatch(/^\+90555/);
    expect(String(sms[0]!.body)).toContain(`#${o.number}`);

    await runJobsAt(ctx, 10 * MIN + 1000);
    expect(byOrder('order.notify_customer', o.id).filter((p) => p.event === 'approval_delay')).toEqual([
      expect.objectContaining({ event: 'approval_delay', remainingMinutes: 5 }),
    ]);
    expect((await statusOf(o.id)).status).toBe('new');

    await runJobsAt(ctx, 15 * MIN + 1000);
    const done = await statusOf(o.id);
    expect(done).toMatchObject({ status: 'cancelled', cancelledBy: 'system', cancelReason: 'tenant_no_response' });
    expect(done.trackingExpiresAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * 86400_000);
    expect(await alarmEvents(o.id)).toEqual([2, 3, 4, 5, 6]);
    const ev = await ctx.db.select().from(orderEvents).where(and(eq(orderEvents.orderId, o.id), eq(orderEvents.type, 'alarm_step')));
    expect(ev).toHaveLength(4);
  });

  it('onaylanan siparişte kalan adımlar iptal edilir; hiçbir eskalasyon gitmez', async () => {
    const o = await createHookedOrder(ctx, s);
    await runJobsAt(ctx, 61_000);
    const res = await ctx.request({ method: 'POST', url: `/api/v1/panel/orders/${o.id}/accept`, cookie: s.ownerCookie, body: { etaMinutes: 20 } });
    expect(res.statusCode).toBe(200);
    const jobs = await jobsFor(ctx, o.id, 'order.alarm_step');
    expect(jobs.filter((j) => j.status === 'pending')).toHaveLength(0);
    await runJobsAt(ctx, 16 * MIN);
    expect(byOrder('platform.alert', o.id)).toHaveLength(0);
    expect(byOrder('sms.send', o.id)).toHaveLength(0);
    expect((await statusOf(o.id)).status).toBe('accepted');
  });

  it('bekleyen ret sırasında adım ertelenir; ret kesinleşirse eskalasyon gitmez', async () => {
    const o = await createHookedOrder(ctx, s);
    // ret, 2 dk adımından hemen önce planlanmış gibi
    await ctx.db
      .update(orders)
      .set({ rejectionScheduledAt: new Date(Date.now() + 2 * MIN - 5_000), rejectionReason: 'too_busy', rejectionRequestedBy: s.owner.id })
      .where(eq(orders.id, o.id));
    await runJobsAt(ctx, 2 * MIN + 1000);
    expect(byOrder('platform.alert', o.id)).toHaveLength(0);
    const deferred = (await jobsFor(ctx, o.id, 'order.alarm_step')).filter((j) => j.dedupeKey?.includes(':after:'));
    expect(deferred.length).toBeGreaterThan(0);
    // ret kesinleşir (iş yok; doğrudan geçiş simülasyonu)
    await ctx.request({ method: 'POST', url: `/api/v1/panel/orders/${o.id}/undo-reject`, cookie: s.ownerCookie });
    await ctx.request({ method: 'POST', url: `/api/v1/panel/orders/${o.id}/reject`, cookie: s.ownerCookie, body: { reason: 'too_busy' } });
    await runJobsAt(ctx, 3 * MIN);
    expect((await statusOf(o.id)).status).toBe('rejected');
    await runJobsAt(ctx, 16 * MIN);
    expect(byOrder('platform.alert', o.id)).toHaveLength(0);
    expect(byOrder('sms.send', o.id)).toHaveLength(0);
  });

  it('geri alınan ret: zincir kaldığı yerden sürer (ertelenen adım çalışır)', async () => {
    const o = await createHookedOrder(ctx, s);
    await ctx.db
      .update(orders)
      .set({ rejectionScheduledAt: new Date(Date.now() + 2 * MIN - 5_000), rejectionReason: 'too_busy', rejectionRequestedBy: s.owner.id })
      .where(eq(orders.id, o.id));
    await runJobsAt(ctx, 2 * MIN + 1000);
    expect(byOrder('platform.alert', o.id)).toHaveLength(0);
    await ctx.request({ method: 'POST', url: `/api/v1/panel/orders/${o.id}/undo-reject`, cookie: s.ownerCookie });
    await runJobsAt(ctx, 3 * MIN);
    expect(byOrder('platform.alert', o.id)).toHaveLength(1);
  });

  it('politika: platform WA ve SMS kapalıysa gönderilmez; iptal süresi ayarı uygulanır (10 dk → müşteri 5 dk)', async () => {
    await ctx.db
      .update(branches)
      .set({ alarmPolicy: { auto_cancel_minutes: 10, customer_notice_minutes: 10, platform_wa_enabled: false, sms_enabled: false } })
      .where(eq(branches.id, s.branchId));
    try {
      const o = await createHookedOrder(ctx, s);
      const steps = (await jobsFor(ctx, o.id, 'order.alarm_step')).map((j) => [
        (j.payload as { step: number }).step,
        Math.round((j.runAt.getTime() - o.createdAt.getTime()) / MIN),
      ]);
      expect(steps).toEqual(expect.arrayContaining([[5, 5], [6, 10]]));
      await runJobsAt(ctx, 10 * MIN + 1000);
      expect(byOrder('platform.alert', o.id)).toHaveLength(0);
      expect(byOrder('sms.send', o.id)).toHaveLength(0);
      expect(byOrder('order.notify_customer', o.id).filter((p) => p.event === 'approval_delay')).toHaveLength(1);
      expect((await statusOf(o.id)).cancelReason).toBe('tenant_no_response');
    } finally {
      await ctx.db
        .update(branches)
        .set({ alarmPolicy: { auto_cancel_minutes: 15, customer_notice_minutes: 10, platform_wa_enabled: true, sms_enabled: true } })
        .where(eq(branches.id, s.branchId));
    }
  });
});

describe('test siparişleri', () => {
  it('onboarding_test: yalnız 60 sn + 2 dk (TEST etiketiyle); SMS, müşteri ve otomatik iptal yok', async () => {
    const o = await createHookedOrder(ctx, s, { testKind: 'onboarding_test' });
    const steps = (await jobsFor(ctx, o.id, 'order.alarm_step')).map((j) => (j.payload as { step: number }).step).sort();
    expect(steps).toEqual([2, 3]);
    await runJobsAt(ctx, 20 * MIN);
    expect(byOrder('platform.alert', o.id)).toEqual([expect.objectContaining({ test: true, kind: 'new_order_alarm' })]);
    expect(byOrder('sms.send', o.id)).toHaveLength(0);
    expect(byOrder('order.notify_customer', o.id).filter((p) => p.event === 'approval_delay')).toHaveLength(0);
    expect((await statusOf(o.id)).status).toBe('new');
  });

  it('canary: hiçbir dış bildirim yok', async () => {
    const o = await createHookedOrder(ctx, s, { testKind: 'canary' });
    await runJobsAt(ctx, 20 * MIN);
    expect(byOrder('platform.alert', o.id)).toHaveLength(0);
    expect(byOrder('sms.send', o.id)).toHaveLength(0);
    expect(byOrder('order.notify_customer', o.id).filter((p) => p.event === 'approval_delay')).toHaveLength(0);
  });
});

describe('awaiting_customer zaman aşımı', () => {
  it('30 dk doğrulanmayan sipariş cancelled/customer_timeout olur; doğrulanan etkilenmez', async () => {
    const a = await createHookedOrder(ctx, s, { status: 'awaiting_customer' });
    const b = await createHookedOrder(ctx, s, { status: 'awaiting_customer' });
    await ctx.request({ method: 'POST', url: `/api/v1/panel/orders/${b.id}/verify`, cookie: s.ownerCookie });
    await runJobsAt(ctx, 29 * MIN);
    expect((await statusOf(a.id)).status).toBe('awaiting_customer');
    await runJobsAt(ctx, 30 * MIN + 1000);
    expect(await statusOf(a.id)).toMatchObject({ status: 'cancelled', cancelledBy: 'system', cancelReason: 'customer_timeout' });
    expect((await statusOf(b.id)).status).not.toBe('awaiting_customer');
    expect((await statusOf(b.id)).cancelReason).not.toBe('customer_timeout');
  });
});
