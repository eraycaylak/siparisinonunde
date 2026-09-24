// Sipariş işleri — dilim 2 (14 §7.2):
//  - order.alarm_step: 00 §10 kademeli alarm zinciri (60 sn SSE, 2 dk platform.alert, 5 dk sms.send, müşteri bilgisi
//    order.notify_customer {event:'approval_delay'}, otomatik iptal tenant_no_response). Sipariş artık `new` değilse no-op;
//    bekleyen retteyken adım ret penceresinin sonuna ertelenir (geri alınırsa zincir kaldığı yerden sürer).
//  - order.finalize_rejection: 30 sn bekleyen ret → rejected.
//  - order.awaiting_timeout: awaiting_customer 30 dk → cancelled/customer_timeout.
// Kancalar (onOrderCreated / onOrderTransition): zinciri kurar/iptal eder, müşteri sayaçlarını günceller.
// Bu fonksiyon hem API hem worker sürecinde çağrılır; kayıtlar ada göre tekildir.

import { AWAITING_CUSTOMER_TIMEOUT_MS, REJECTION_UNDO_WINDOW_MS, formatOrderNo, formatTL } from '@siparis/core';
import { branches, customers, memberships, orderEvents, orders, tenants, users, type Database } from '@siparis/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { appendBranchEvent } from '../../lib/events';
import { cancelJobs, enqueueJob, registerJobHandler } from '../../lib/jobs';
import {
  ALARM_STEP,
  alarmDedupeKey,
  awaitingTimeoutKey,
  finalizeRejectionKey,
  normalizeAlarmPolicy,
  planAlarmSteps,
} from '../../services/orders/alarm-policy';
import type { OrderRow } from '../../services/orders/summary';
import { onOrderCreated, onOrderTransition, transitionOrder } from '../../services/orders/transition';

export interface AlarmStepPayload {
  orderId: string;
  tenantId: string;
  branchId: string;
  step: number;
  [key: string]: unknown;
}

export interface FinalizeRejectionPayload {
  orderId: string;
  tenantId: string;
  scheduledAt: string;
  blockCustomer?: boolean;
  [key: string]: unknown;
}

export interface AwaitingTimeoutPayload {
  orderId: string;
  tenantId: string;
  [key: string]: unknown;
}

/** Sipariş `new` olduğunda (oluşturma ya da awaiting_customer → new) zinciri planlar. t0 = şimdi. */
export async function scheduleAlarmChain(tx: Database, order: OrderRow): Promise<void> {
  const [branch] = await tx.select({ alarmPolicy: branches.alarmPolicy }).from(branches).where(eq(branches.id, order.branchId));
  const policy = normalizeAlarmPolicy(branch?.alarmPolicy);
  for (const s of planAlarmSteps(policy, order.testKind)) {
    await enqueueJob(tx, {
      queue: 'notify',
      type: 'order.alarm_step',
      tenantId: order.tenantId,
      delayMs: s.delayMs,
      dedupeKey: alarmDedupeKey(order.id, s.step),
      payload: { orderId: order.id, tenantId: order.tenantId, branchId: order.branchId, step: s.step },
    });
  }
}

/** Sipariş `new`den çıkınca kalan adımları iptal eder. */
export async function cancelAlarmChain(tx: Database, orderId: string): Promise<number> {
  return cancelJobs(tx, { type: 'order.alarm_step', orderId });
}

async function bumpCustomer(tx: Database, order: OrderRow): Promise<void> {
  if (!order.customerId || order.testKind) return;
  await tx
    .update(customers)
    .set({ orderCount: sql`${customers.orderCount} + 1`, lastOrderAt: order.verifiedAt ?? order.placedAt })
    .where(and(eq(customers.id, order.customerId), eq(customers.tenantId, order.tenantId)));
}

/** İşletme sahibinin uyarı telefonu: owner kullanıcısının telefonu → şube → işletme telefonu. */
async function ownerAlertPhone(db: Database, tenantId: string, branchPhone: string | null): Promise<string | null> {
  const [owner] = await db
    .select({ phone: users.phone })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'owner'), isNull(memberships.disabledAt)))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  if (owner?.phone) return owner.phone;
  if (branchPhone && /^\+905/.test(branchPhone)) return branchPhone;
  const [t] = await db.select({ phone: tenants.phone }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.phone && /^\+905/.test(t.phone) ? t.phone : null;
}

async function recordAlarmEvent(tx: Database, order: OrderRow, step: number, note: string | null = null) {
  await tx.insert(orderEvents).values({
    tenantId: order.tenantId,
    orderId: order.id,
    type: 'alarm_step',
    actorType: 'system',
    note,
    data: { step },
  });
  await appendBranchEvent(tx, {
    tenantId: order.tenantId,
    branchId: order.branchId,
    type: 'order.alarm',
    payload: { orderId: order.id, number: order.number, step },
  });
}

/** Tek alarm adımı (idempotent: sipariş `new` değilse hiçbir şey yapmaz). */
export async function runAlarmStep(db: Database, payload: AlarmStepPayload): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, payload.orderId), eq(orders.tenantId, payload.tenantId)))
      .for('update');
    if (!order || order.status !== 'new') return;

    // Bekleyen ret: eskalasyon durur; adım ret penceresinin sonrasına ertelenir (geri alınırsa sürer)
    if (order.rejectionScheduledAt) {
      const resumeAt = new Date(order.rejectionScheduledAt.getTime() + REJECTION_UNDO_WINDOW_MS + 1_000);
      await enqueueJob(tx, {
        queue: 'notify',
        type: 'order.alarm_step',
        tenantId: order.tenantId,
        runAt: resumeAt,
        dedupeKey: `${alarmDedupeKey(order.id, payload.step)}:after:${order.rejectionScheduledAt.getTime()}`,
        payload: { ...payload },
      });
      return;
    }

    const [branch] = await tx.select().from(branches).where(eq(branches.id, order.branchId));
    const policy = normalizeAlarmPolicy(branch?.alarmPolicy);
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, order.tenantId));
    const isTest = order.testKind === 'onboarding_test';

    switch (payload.step) {
      case ALARM_STEP.REPEAT: {
        await recordAlarmEvent(tx, order, ALARM_STEP.REPEAT);
        return;
      }
      case ALARM_STEP.PLATFORM_WA: {
        if (order.testKind === 'canary' || !policy.platformWaEnabled) {
          await recordAlarmEvent(tx, order, ALARM_STEP.PLATFORM_WA, 'platform_wa_disabled');
          return;
        }
        await enqueueJob(tx, {
          queue: 'notify',
          type: 'platform.alert',
          tenantId: order.tenantId,
          dedupeKey: `platform_alert:new_order:${order.id}`,
          payload: {
            tenantId: order.tenantId,
            branchId: order.branchId,
            kind: 'new_order_alarm',
            orderId: order.id,
            number: order.number,
            waitingMinutes: 2,
            totalKurus: order.totalKurus,
            test: isTest,
          },
        });
        await recordAlarmEvent(tx, order, ALARM_STEP.PLATFORM_WA);
        return;
      }
      case ALARM_STEP.SMS: {
        if (order.testKind || !policy.smsEnabled) return;
        const to = await ownerAlertPhone(tx, order.tenantId, branch?.phone ?? null);
        if (!to) {
          await recordAlarmEvent(tx, order, ALARM_STEP.SMS, 'no_owner_phone');
          return;
        }
        await enqueueJob(tx, {
          queue: 'notify',
          type: 'sms.send',
          tenantId: order.tenantId,
          dedupeKey: `sms_alarm:${order.id}`,
          payload: {
            tenantId: order.tenantId,
            orderId: order.id,
            to,
            body: `Siparişin Önünde: ${tenant?.name ?? 'İşletmeniz'} için ${formatOrderNo(order.number)} numaralı sipariş (${formatTL(order.totalKurus)}) 5 dakikadır onay bekliyor. Lütfen paneli açın.`,
            purpose: 'alarm',
            countsTowardQuota: true,
          },
        });
        await recordAlarmEvent(tx, order, ALARM_STEP.SMS);
        return;
      }
      case ALARM_STEP.CUSTOMER_NOTICE: {
        if (order.testKind) return;
        await enqueueJob(tx, {
          queue: 'notify',
          type: 'order.notify_customer',
          tenantId: order.tenantId,
          dedupeKey: `notify_approval_delay:${order.id}`,
          payload: {
            orderId: order.id,
            tenantId: order.tenantId,
            event: 'approval_delay',
            remainingMinutes: policy.autoCancelMinutes - policy.customerNoticeMinutes,
          },
        });
        await recordAlarmEvent(tx, order, ALARM_STEP.CUSTOMER_NOTICE);
        return;
      }
      case ALARM_STEP.AUTO_CANCEL: {
        if (order.testKind === 'onboarding_test') return;
        await transitionOrder(tx, {
          orderId: order.id,
          tenantId: order.tenantId,
          to: 'cancelled',
          actor: { type: 'system' },
          cancelledBy: 'system',
          reason: 'tenant_no_response',
        });
        await appendBranchEvent(tx, {
          tenantId: order.tenantId,
          branchId: order.branchId,
          type: 'order.alarm',
          payload: { orderId: order.id, number: order.number, step: ALARM_STEP.AUTO_CANCEL },
        });
        return;
      }
      default:
        return;
    }
  });
}

/** 30 sn bekleyen ret → rejected (geri alındıysa ya da yeni bir ret planlandıysa no-op). */
export async function runFinalizeRejection(db: Database, payload: FinalizeRejectionPayload): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, payload.orderId), eq(orders.tenantId, payload.tenantId)))
      .for('update');
    if (!order || order.status !== 'new' || !order.rejectionScheduledAt || !order.rejectionReason) return;
    if (payload.scheduledAt && Math.abs(order.rejectionScheduledAt.getTime() - new Date(payload.scheduledAt).getTime()) > 1000) return;
    await transitionOrder(tx, {
      orderId: order.id,
      tenantId: order.tenantId,
      to: 'rejected',
      actor: { type: 'user', userId: order.rejectionRequestedBy },
      reason: order.rejectionReason,
      note: order.rejectionNote,
    });
    if (payload.blockCustomer && order.customerId) {
      await tx
        .update(customers)
        .set({ isBlocked: true })
        .where(and(eq(customers.id, order.customerId), eq(customers.tenantId, order.tenantId)));
    }
  });
}

/** awaiting_customer 30 dk → cancelled (system, customer_timeout). */
export async function runAwaitingTimeout(db: Database, payload: AwaitingTimeoutPayload): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, payload.orderId), eq(orders.tenantId, payload.tenantId)))
      .for('update');
    if (!order || order.status !== 'awaiting_customer') return;
    await transitionOrder(tx, {
      orderId: order.id,
      tenantId: order.tenantId,
      to: 'cancelled',
      actor: { type: 'system' },
      cancelledBy: 'system',
      reason: 'customer_timeout',
    });
  });
}

export function registerOrderJobs(): void {
  registerJobHandler<AlarmStepPayload>('order.alarm_step', (payload, { db }) => runAlarmStep(db, payload));
  registerJobHandler<FinalizeRejectionPayload>('order.finalize_rejection', (payload, { db }) => runFinalizeRejection(db, payload));
  registerJobHandler<AwaitingTimeoutPayload>('order.awaiting_timeout', (payload, { db }) => runAwaitingTimeout(db, payload));

  onOrderCreated('orders.lifecycle', async ({ tx, order }) => {
    if (order.status === 'new') {
      await scheduleAlarmChain(tx, order);
      await bumpCustomer(tx, order);
    } else if (order.status === 'awaiting_customer') {
      await enqueueJob(tx, {
        queue: 'notify',
        type: 'order.awaiting_timeout',
        tenantId: order.tenantId,
        delayMs: AWAITING_CUSTOMER_TIMEOUT_MS,
        dedupeKey: awaitingTimeoutKey(order.id),
        payload: { orderId: order.id, tenantId: order.tenantId },
      });
    }
  });

  onOrderTransition('orders.lifecycle', async ({ tx, order, from, to }) => {
    if (from === 'awaiting_customer') await cancelJobs(tx, { dedupeKey: awaitingTimeoutKey(order.id) });
    if (from === 'new') {
      await cancelAlarmChain(tx, order.id);
      if (to !== 'rejected') await cancelJobs(tx, { dedupeKey: finalizeRejectionKey(order.id) });
    }
    if (to === 'new') {
      await scheduleAlarmChain(tx, order);
      await bumpCustomer(tx, order);
    }
  });
}
