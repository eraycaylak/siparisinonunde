// Sipariş durum geçişi (14 §7.3): FSM (core) + sürüm kontrolü + zaman damgası + order_events +
// branch_events ('order.updated') + yan etki abonelikleri — hepsi çağıranın transaction'ında.

import {
  STATUS_TIMESTAMP_FIELD,
  TRACKING_TTL_AFTER_FINAL_MS,
  isFinal,
  validateTransition,
  type CancelledBy,
  type OrderEventActorType,
  type OrderStatus,
  type OrderSummary,
} from '@siparis/core';
import { nextOrderNumber, orderEvents, orders, type Database } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { appendBranchEvent } from '../../lib/events';
import { AppError, conflict, notFound } from '../../lib/errors';
import { loadOrderSummary, type OrderRow } from './summary';

export interface TransitionActor {
  type: OrderEventActorType;
  userId?: string | null;
}

export interface TransitionOrderInput {
  orderId: string;
  tenantId: string;
  to: OrderStatus;
  actor: TransitionActor;
  /** Ret: rejection_reason; iptal: cancel_reason */
  reason?: string | null;
  note?: string | null;
  /** İptalde verilmezse aktörden türetilir: user → tenant, customer → customer, system → system */
  cancelledBy?: CancelledBy | null;
  /** İstemcinin bildiği sürüm; farklıysa 409 version_conflict */
  expectedVersion?: number | null;
  /** Aynı güncellemede yazılacak ek kolonlar (ör. etaMinutes, estimatedReadyAt, verificationMethod) */
  extra?: Partial<Omit<typeof orders.$inferInsert, 'id' | 'tenantId' | 'status' | 'version'>>;
  now?: Date;
}

export interface TransitionResult {
  order: OrderRow;
  from: OrderStatus;
  to: OrderStatus;
  /** false: sipariş zaten hedef durumdaydı (no-op, 07 §4) */
  changed: boolean;
  summary: OrderSummary;
  seq: number | null;
}

export interface OrderTransitionEvent {
  tx: Database;
  order: OrderRow;
  from: OrderStatus;
  to: OrderStatus;
  actor: TransitionActor;
  reason: string | null;
  note: string | null;
  summary: OrderSummary;
}
export type OrderTransitionHook = (e: OrderTransitionEvent) => Promise<void> | void;

export interface OrderCreatedEvent {
  tx: Database;
  order: OrderRow;
  actor: TransitionActor;
  summary: OrderSummary;
}
export type OrderCreatedHook = (e: OrderCreatedEvent) => Promise<void> | void;

const transitionHooks = new Map<string, OrderTransitionHook>();
const createdHooks = new Map<string, OrderCreatedHook>();

/**
 * Durum değişimine abone olur (bildirim, alarm, yazdırma…). Aynı transaction'da çalışır; hata fırlatırsa
 * geçiş geri alınır. `name` ile tekil: yeniden kayıt öncekini değiştirir.
 */
export function onOrderTransition(name: string, fn: OrderTransitionHook): void {
  transitionHooks.set(name, fn);
}
export function offOrderTransition(name: string): void {
  transitionHooks.delete(name);
}

/** Yeni sipariş kaydına abone olur (alarm zinciri, debounce mesajı…). */
export function onOrderCreated(name: string, fn: OrderCreatedHook): void {
  createdHooks.set(name, fn);
}
export function offOrderCreated(name: string): void {
  createdHooks.delete(name);
}

/** Tenant'ın sıradaki sipariş numarası (tenants.order_seq, satır kilidiyle). Transaction içinde çağırın. */
export function createOrderNumber(tx: Database, tenantId: string): Promise<number> {
  return nextOrderNumber(tx, tenantId);
}

function defaultCancelledBy(actor: TransitionActor): CancelledBy {
  return actor.type === 'user' ? 'tenant' : actor.type;
}

export async function transitionOrder(tx: Database, input: TransitionOrderInput): Promise<TransitionResult> {
  const now = input.now ?? new Date();
  const [current] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, input.tenantId)))
    .for('update');
  if (!current) throw notFound('Sipariş bulunamadı.');

  const from = current.status;
  if (from === input.to) {
    return { order: current, from, to: input.to, changed: false, summary: await loadOrderSummary(tx, current), seq: null };
  }
  if (input.expectedVersion != null && input.expectedVersion !== current.version) {
    throw conflict('version_conflict', 'Sipariş başka biri tarafından güncellendi. Ekranı yenileyin.', {
      currentVersion: current.version,
      status: current.status,
    });
  }
  if (input.to === 'accepted' && current.rejectionScheduledAt) {
    throw conflict('rejection_pending', 'Bu sipariş için bekleyen bir ret var. Önce geri alın.');
  }

  const cancelledBy = input.to === 'cancelled' ? (input.cancelledBy ?? defaultCancelledBy(input.actor)) : null;
  const err = validateTransition(from, input.to, { reason: input.reason, note: input.note, cancelledBy });
  if (err) {
    if (err.code === 'invalid_transition') {
      throw conflict('invalid_transition', err.message, { from, to: input.to });
    }
    throw new AppError(400, err.code, err.message);
  }

  const note = input.note?.trim() || null;
  const patch: Partial<typeof orders.$inferInsert> = { ...input.extra, status: input.to, version: current.version + 1, updatedAt: now };
  const tsField = STATUS_TIMESTAMP_FIELD[input.to] as keyof typeof orders.$inferInsert | undefined;
  if (tsField) (patch as Record<string, unknown>)[tsField] = now;
  if (from === 'new' || from === 'awaiting_customer') {
    patch.rejectionScheduledAt = null;
    patch.rejectionRequestedBy = null;
  }
  if (input.to === 'accepted' && input.actor.type === 'user') patch.acceptedByUserId = input.actor.userId ?? null;
  if (input.to === 'rejected') {
    patch.rejectionReason = input.reason as OrderRow['rejectionReason'];
    patch.rejectionNote = note;
  }
  if (input.to === 'cancelled') {
    patch.cancelledBy = cancelledBy;
    patch.cancelReason = input.reason as OrderRow['cancelReason'];
    patch.cancelNote = note;
  }
  if (input.to === 'new' && !current.verifiedAt && !patch.verifiedAt) patch.verifiedAt = now;
  if (isFinal(input.to)) patch.trackingExpiresAt = new Date(now.getTime() + TRACKING_TTL_AFTER_FINAL_MS);

  const [updated] = await tx
    .update(orders)
    .set(patch)
    .where(and(eq(orders.id, current.id), eq(orders.version, current.version)))
    .returning();
  if (!updated) {
    throw conflict('version_conflict', 'Sipariş başka biri tarafından güncellendi. Ekranı yenileyin.', {
      currentVersion: current.version,
    });
  }

  await tx.insert(orderEvents).values({
    tenantId: updated.tenantId,
    orderId: updated.id,
    type: 'status_changed',
    fromStatus: from,
    toStatus: input.to,
    actorType: input.actor.type,
    actorUserId: input.actor.userId ?? null,
    reason: input.reason ?? null,
    note,
    createdAt: now,
  });

  const summary = await loadOrderSummary(tx, updated);
  const seq = await appendBranchEvent(tx, {
    tenantId: updated.tenantId,
    branchId: updated.branchId,
    type: 'order.updated',
    payload: { order: summary, change: 'status', from, to: input.to },
  });

  const event: OrderTransitionEvent = {
    tx,
    order: updated,
    from,
    to: input.to,
    actor: input.actor,
    reason: input.reason ?? null,
    note,
    summary,
  };
  for (const hook of transitionHooks.values()) await hook(event);

  return { order: updated, from, to: input.to, changed: true, summary, seq };
}

/** Kısayol: kendi transaction'ında geçiş. */
export function transitionOrderTx(db: Database, input: TransitionOrderInput): Promise<TransitionResult> {
  return db.transaction((tx) => transitionOrder(tx, input));
}

/**
 * Yeni sipariş kaydedildikten sonra (aynı transaction'da) çağrılır: order_events 'created' + branch_events
 * 'order.created' + onOrderCreated abonelikleri.
 */
export async function recordOrderCreated(
  tx: Database,
  input: { order: OrderRow; actor: TransitionActor; now?: Date },
): Promise<{ summary: OrderSummary; seq: number }> {
  const { order } = input;
  await tx.insert(orderEvents).values({
    tenantId: order.tenantId,
    orderId: order.id,
    type: 'created',
    fromStatus: null,
    toStatus: order.status,
    actorType: input.actor.type,
    actorUserId: input.actor.userId ?? null,
    createdAt: input.now ?? new Date(),
  });
  const summary = await loadOrderSummary(tx, order);
  const seq = await appendBranchEvent(tx, {
    tenantId: order.tenantId,
    branchId: order.branchId,
    type: 'order.created',
    payload: { order: summary, change: 'created', from: null, to: order.status },
  });
  for (const hook of createdHooks.values()) await hook({ tx, order, actor: input.actor, summary });
  return { summary, seq };
}
