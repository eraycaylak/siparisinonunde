// Sipariş işleri — dilim 2 (14 §7.2):
//  - t=0 Web Push: scheduleAlarmChain `push.send` işini de kuyruğa atar (services/push/send.ts; canary hariç).
//  - order.alarm_step: 00 §10 kademeli alarm zinciri (60 sn SSE, 2 dk platform.alert, 5 dk sms.send, müşteri bilgisi
//    order.notify_customer {event:'approval_delay'}, otomatik iptal tenant_no_response). Sipariş artık `new` değilse no-op;
//    bekleyen retteyken adım ret penceresinin sonuna ertelenir (geri alınırsa zincir kaldığı yerden sürer).
//  - order.finalize_rejection: 30 sn bekleyen ret → rejected.
//  - order.awaiting_timeout: awaiting_customer 30 dk → cancelled/customer_timeout.
// Kancalar (onOrderCreated / onOrderTransition): zinciri kurar/iptal eder, müşteri sayaçlarını günceller.
// Bu fonksiyon hem API hem worker sürecinde çağrılır; kayıtlar ada göre tekildir.

import { AWAITING_CUSTOMER_TIMEOUT_MS, REJECTION_UNDO_WINDOW_MS, formatOrderNo, formatTL } from '@siparis/core';
import { branches, customers, memberships, orderEvents, orders, tenants, users, waAccounts, type Database } from '@siparis/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { channelDelivers, mockDelivers, type Config } from '../../config';
import { appendBranchEvent } from '../../lib/events';
import { cancelJobs, enqueueJob, generationKey, registerJobHandler } from '../../lib/jobs';
import { ALARM_STEP, alarmDedupeKey, awaitingTimeoutKey, normalizeAlarmPolicy, planAlarmSteps } from '../../services/orders/alarm-policy';
import type { OrderRow } from '../../services/orders/summary';
import { onOrderCreated, onOrderTransition, transitionOrder } from '../../services/orders/transition';
import { enqueueNewOrderPush } from '../../services/push/send';

export interface AlarmStepPayload {
  orderId: string;
  tenantId: string;
  branchId: string;
  step: number;
  /**
   * Adımın kaçıncı DENEMESİ olduğu (anahtar eki `…#g<gen>`, `generationKey`). 0/tanımsız = çıplak anahtar.
   * Artıranlar: bekleyen ret ertelemesi (aşağıda) ve emniyet cron'u (`watchNewOrders`). Adımın kendisi dışarıya
   * etki üretmez — nesil yalnız tam unique altında yeni bir satır açabilmek içindir.
   */
  gen?: number;
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

/** Erteleme bekleme katsayısının katlanmayı bıraktığı nesil (üst sınır 2^6 ≈ 33 dk'lık adım). */
const DEFER_MAX_SHIFT = 6;

/**
 * Bekleyen ret yüzünden ertelenen alarm adımının, RET ANINA göre kümülatif beklemesi (ms).
 *
 * `gen = 1` tam olarak eski davranıştır: ret + 30 sn geri alma penceresi + 1 sn. Sonraki nesiller katlanarak
 * uzayan adımlarla EKLENİR (31 sn, +62 sn, +124 sn …, sınırdan sonra sabit +33 dk), yani hedef an her nesilde
 * kesin olarak İLERLER. Neden gerekli: ret 30 sn'de kesinleşmediyse (ör. `finalize_rejection` kalıcı başarısız)
 * hedef an geçmişte kalır; sabit bekleme ile adım her worker turunda yeniden ertelenip her turda yeni bir satır
 * açardı (sonsuz döngü). Katlanan adımla satır sayısı günde onlarla sınırlı kalır ve asıl arıza zaten
 * `job_failed_permanent` kritik uyarısını vermiştir.
 */
export function deferWaitMs(gen: number, baseMs = REJECTION_UNDO_WINDOW_MS + 1_000): number {
  const n = Math.max(1, Math.floor(gen));
  const capped = Math.min(n, DEFER_MAX_SHIFT);
  // 1 + 2 + 4 + … + 2^(capped-1) = 2^capped - 1; sınırdan sonra her nesil sabit 2^DEFER_MAX_SHIFT ekler
  return baseMs * (2 ** capped - 1 + 2 ** DEFER_MAX_SHIFT * Math.max(0, n - DEFER_MAX_SHIFT));
}

/** Sipariş `new` olduğunda (oluşturma ya da awaiting_customer → new) zinciri planlar. t0 = şimdi. */
export async function scheduleAlarmChain(tx: Database, order: OrderRow): Promise<void> {
  // Telefon siparişini personel kendisi girer: uyarılacak kimse yok, otomatik iptal edilmez (canlı ekran da çalmaz)
  if (order.channel === 'manual') return;
  // t=0: panel sesiyle birlikte kayıtlı cihazlara Web Push (00 §10; canary dışarıya bildirim üretmez)
  await enqueueNewOrderPush(tx, order);
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

/** Alarm zincirinin kanal durumunu belirleyen yapılandırma alanları (channelDelivers). */
export type AlarmConfig = Pick<Config, 'NODE_ENV' | 'DEPLOY_ENV' | 'PLATFORM_WA_PROVIDER' | 'SMS_PROVIDER'>;

/**
 * Tek alarm adımı (idempotent: sipariş `new` değilse hiçbir şey yapmaz). config verilirse canlı ortamda taklit (mock)
 * kanala gönderim yapılmaz: adım "…_unavailable" notuyla kaydedilir ve panel kartı uyarının gittiğini söylemez
 * (panel-dto alarmNotice; 00 §12a madde 10). Kayıt notu dolu adımlar "gitti" sayılmaz.
 */
export async function runAlarmStep(db: Database, payload: AlarmStepPayload, config?: AlarmConfig): Promise<void> {
  const platformWaLive = !config || channelDelivers(config, 'platform_wa');
  const smsLive = !config || channelDelivers(config, 'sms');
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, payload.orderId), eq(orders.tenantId, payload.tenantId)))
      .for('update');
    if (!order || order.status !== 'new') return;

    // Bekleyen ret: eskalasyon durur; adım ret penceresinin sonrasına ertelenir (geri alınırsa sürer).
    // Erteleme bir SONRAKİ nesli açar: eski `…:after:<ret zamanı>` deseni, ret hâlâ aynı ana planlıyken ikinci kez
    // ertelemek gerektiğinde ÇALIŞAN kendi satırının anahtarını üretiyordu → çakışma → adım buharlaşıyordu.
    if (order.rejectionScheduledAt) {
      const gen = (payload.gen ?? 0) + 1;
      const resumeAt = new Date(order.rejectionScheduledAt.getTime() + deferWaitMs(gen));
      await enqueueJob(tx, {
        queue: 'notify',
        type: 'order.alarm_step',
        tenantId: order.tenantId,
        runAt: resumeAt,
        dedupeKey: generationKey(alarmDedupeKey(order.id, payload.step), gen),
        payload: { ...payload, gen },
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
        // Canlı ortamda ortak numara taklitse (META secret'ları yok) uyarı hiçbir yere gitmez: gönderilmiş gibi kaydedilmez
        if (!platformWaLive) {
          await recordAlarmEvent(tx, order, ALARM_STEP.PLATFORM_WA, 'platform_wa_unavailable');
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
        if (!smsLive) {
          await recordAlarmEvent(tx, order, ALARM_STEP.SMS, 'sms_unavailable');
          return;
        }
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
            body: `Yemek Gelsin: ${tenant?.name ?? 'İşletmeniz'} için ${formatOrderNo(order.number)} numaralı sipariş (${formatTL(order.totalKurus)}) 5 dakikadır onay bekliyor. Lütfen paneli açın.`,
            purpose: 'alarm',
            countsTowardQuota: true,
          },
        });
        await recordAlarmEvent(tx, order, ALARM_STEP.SMS);
        return;
      }
      case ALARM_STEP.CUSTOMER_NOTICE: {
        if (order.testKind) return;
        // Müşteriye ulaşan yollar işletmenin WhatsApp numarası (ortak numara ya da kendi hesabı) ve SMS'tir; canlı ortamda
        // hepsi taklitse bilgi mesajı gidemez, gitmiş gibi de kaydedilmez
        if (config && !smsLive) {
          let waLive = platformWaLive;
          if (tenant?.waMode === 'own') {
            const [acc] = await tx
              .select({ provider: waAccounts.provider })
              .from(waAccounts)
              .where(and(eq(waAccounts.tenantId, order.tenantId), eq(waAccounts.branchId, order.branchId)))
              .limit(1);
            waLive = !!acc && (acc.provider !== 'mock' || mockDelivers(config));
          }
          if (!waLive) {
            await recordAlarmEvent(tx, order, ALARM_STEP.CUSTOMER_NOTICE, 'customer_channel_unavailable');
            return;
          }
        }
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
  registerJobHandler<AlarmStepPayload>('order.alarm_step', (payload, { db, config }) => runAlarmStep(db, payload, config));
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
      // Anahtar değil tür+sipariş ile: `finalize_rejection` anahtarı nesil eki taşır (`…#g<version>`), tek bir
      // anahtar metni artık siparişin tüm ret işlerini kapsamıyor. Bekleyen ret zaten tek olabilir (reject rotası
      // ikincisine 409 `rejection_pending` verir), yani iptal kümesi pratikte aynı kalır.
      if (to !== 'rejected') await cancelJobs(tx, { type: 'order.finalize_rejection', orderId: order.id });
    }
    if (to === 'new') {
      await scheduleAlarmChain(tx, order);
      await bumpCustomer(tx, order);
    }
  });
}
