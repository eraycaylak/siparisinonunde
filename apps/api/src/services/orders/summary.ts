// Sipariş satırı → OrderSummary DTO (panel, SSE, listeler) ve olay yayını.

import { maskPhone, type OrderStatus, type OrderSummary } from '@siparis/core';
import { orderItems, orders, type Database } from '@siparis/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { appendBranchEvent } from '../../lib/events';

export type OrderRow = typeof orders.$inferSelect;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toOrderSummary(o: OrderRow, itemCount: number): OrderSummary {
  return {
    id: o.id,
    tenantId: o.tenantId,
    branchId: o.branchId,
    number: o.number,
    status: o.status,
    channel: o.channel,
    fulfillmentType: o.fulfillmentType,
    testKind: o.testKind ?? null,
    customerName: o.customerName ?? null,
    customerPhoneMasked: o.customerPhone ? maskPhone(o.customerPhone) : null,
    neighborhood: o.neighborhood ?? null,
    itemCount,
    subtotalKurus: o.subtotalKurus,
    deliveryFeeKurus: o.deliveryFeeKurus,
    totalKurus: o.totalKurus,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    mealCardBrand: o.mealCardBrand ?? null,
    etaMinutes: o.etaMinutes ?? null,
    estimatedReadyAt: iso(o.estimatedReadyAt),
    placedAt: o.placedAt.toISOString(),
    firstAckedAt: iso(o.firstAckedAt),
    acceptedAt: iso(o.acceptedAt),
    rejectionScheduledAt: iso(o.rejectionScheduledAt),
    rejectionReason: o.rejectionReason ?? null,
    cancelReason: o.cancelReason ?? null,
    cancelledBy: o.cancelledBy ?? null,
    cancelRequested: o.cancelRequestedAt != null,
    courierUserId: o.courierUserId ?? null,
    verificationMethod: o.verificationMethod ?? null,
    version: o.version,
    updatedAt: o.updatedAt.toISOString(),
  };
}

/** Siparişlerin kalem adetleri (Σ quantity). */
export async function itemCounts(db: Database, orderIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!orderIds.length) return map;
  const rows = await db
    .select({ orderId: orderItems.orderId, n: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))
    .groupBy(orderItems.orderId);
  for (const r of rows) map.set(r.orderId, Number(r.n));
  return map;
}

export async function loadOrderSummary(db: Database, order: OrderRow): Promise<OrderSummary> {
  const counts = await itemCounts(db, [order.id]);
  return toOrderSummary(order, counts.get(order.id) ?? 0);
}

export async function loadOrderSummaries(db: Database, rows: OrderRow[]): Promise<OrderSummary[]> {
  const counts = await itemCounts(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toOrderSummary(r, counts.get(r.id) ?? 0));
}

/**
 * `order.updated` olayı yayınlar (durum dışı değişiklikler: ack, süre, kurye, bekleyen ret, iptal talebi…).
 * `change` kısa bir etikettir ('ack', 'eta', 'courier', 'rejection_scheduled', 'rejection_undone', 'cancel_request'…).
 */
export async function emitOrderUpdated(
  tx: Database,
  input: { order: OrderRow; change: string; from?: OrderStatus | null; to?: OrderStatus | null },
): Promise<number> {
  const summary = await loadOrderSummary(tx, input.order);
  return appendBranchEvent(tx, {
    tenantId: input.order.tenantId,
    branchId: input.order.branchId,
    type: 'order.updated',
    payload: { order: summary, change: input.change, from: input.from ?? null, to: input.to ?? null },
  });
}

/** Siparişi id + tenant ile getirir (yoksa undefined; başka tenant'ın kaydı görünmez). */
export async function findOrder(db: Database, tenantId: string, orderId: string): Promise<OrderRow | undefined> {
  const [row] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
  return row;
}

