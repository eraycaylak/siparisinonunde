// Panel sipariş DTO'ları (04 §4.4 kart, §4.11 detay çekmecesi) ve rol projeksiyonu (mutfak fiyat/kişisel veri görmez).

import type { TenantRole } from '@siparis/core';
import { orderCardSchema, orderDetailExtSchema, type OrderCard, type OrderDetailExt } from '@siparis/core/orders/contracts';
import {
  branches,
  cancellationRequests,
  customers,
  deliveryZones,
  orderAcks,
  orderEvents,
  orderItemOptions,
  orderItems,
  orders,
  reviews,
  users,
  type Database,
} from '@siparis/db';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { scrubPersonal, stripPrices } from '../../lib/sse';
import { toOrderSummary, type OrderRow } from './summary';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export interface ItemWithOptions {
  id: string;
  orderId: string;
  productId: string | null;
  name: string;
  quantity: number;
  unitPriceKurus: number;
  optionsUnitKurus: number;
  lineTotalKurus: number;
  note: string | null;
  options: { groupName: string; optionName: string; priceDeltaKurus: number }[];
}

export async function loadItems(db: Database, orderIds: string[]): Promise<Map<string, ItemWithOptions[]>> {
  const map = new Map<string, ItemWithOptions[]>();
  if (!orderIds.length) return map;
  const items = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)).orderBy(asc(orderItems.sort));
  const ids = items.map((i) => i.id);
  const opts = ids.length ? await db.select().from(orderItemOptions).where(inArray(orderItemOptions.orderItemId, ids)) : [];
  for (const i of items) {
    const list = map.get(i.orderId) ?? [];
    list.push({
      id: i.id,
      orderId: i.orderId,
      productId: i.productId,
      name: i.name,
      quantity: i.quantity,
      unitPriceKurus: i.unitPriceKurus,
      optionsUnitKurus: i.optionsUnitKurus,
      lineTotalKurus: i.lineTotalKurus,
      note: i.note,
      options: opts
        .filter((o) => o.orderItemId === i.id)
        .map((o) => ({ groupName: o.groupName, optionName: o.optionName, priceDeltaKurus: o.priceDeltaKurus })),
    });
    map.set(i.orderId, list);
  }
  return map;
}

/** Kartlar: kalemler, müşteri sayacı, kurye adı, bekleyen iptal talebi, alarm adımı. */
export async function buildCards(db: Database, rows: OrderRow[]): Promise<OrderCard[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const items = await loadItems(db, ids);
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((x): x is string => Boolean(x)))];
  const custRows = customerIds.length
    ? await db
        .select({ id: customers.id, orderCount: customers.orderCount, isBlocked: customers.isBlocked })
        .from(customers)
        // KVKK ile silinmiş müşterinin sayacı/durumu gösterilmez (sipariş anonim kalır)
        .where(and(inArray(customers.id, customerIds), sql`not exists (select 1 from customer_erasures e where e.customer_id = ${customers.id})`))
    : [];
  const courierIds = [...new Set(rows.map((r) => r.courierUserId).filter((x): x is string => Boolean(x)))];
  const courierRows = courierIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, courierIds)) : [];
  const zoneIds = [...new Set(rows.map((r) => r.zoneId).filter((x): x is string => Boolean(x)))];
  const zoneRows = zoneIds.length
    ? await db.select({ id: deliveryZones.id, etaMinutes: deliveryZones.etaMinutes }).from(deliveryZones).where(inArray(deliveryZones.id, zoneIds))
    : [];
  const branchIds = [...new Set(rows.map((r) => r.branchId))];
  const branchRows = await db
    .select({ id: branches.id, prep: branches.defaultPrepMinutes, busy: branches.busyExtraMinutes })
    .from(branches)
    .where(inArray(branches.id, branchIds));
  const reqRows = await db
    .select({ id: cancellationRequests.id, orderId: cancellationRequests.orderId })
    .from(cancellationRequests)
    .where(and(inArray(cancellationRequests.orderId, ids), eq(cancellationRequests.status, 'pending')));
  const alarmRows = (await db.execute(sql`
    select order_id, max((data->>'step')::int) as step from order_events
     where order_id in (${sql.join(
       ids.map((id) => sql`${id}::uuid`),
       sql`, `,
     )}) and type = 'alarm_step'
     group by order_id`)) as unknown as { order_id: string; step: number | null }[];

  const custMap = new Map(custRows.map((c) => [c.id, c]));
  const courierMap = new Map(courierRows.map((c) => [c.id, c.name]));
  const reqMap = new Map(reqRows.map((r) => [r.orderId, r.id]));
  const alarmMap = new Map(alarmRows.map((a) => [a.order_id, a.step == null ? null : Number(a.step)]));
  const zoneEta = new Map(zoneRows.map((z) => [z.id, z.etaMinutes]));
  const branchMap = new Map(branchRows.map((b) => [b.id, b]));
  const suggest = (r: OrderRow): number => {
    const b = branchMap.get(r.branchId);
    const zone = r.fulfillmentType === 'delivery' && r.zoneId ? (zoneEta.get(r.zoneId) ?? 0) : 0;
    return Math.max(5, Math.ceil((zone + (b?.prep ?? 20) + (b?.busy ?? 0)) / 5) * 5);
  };

  return rows.map((r) => {
    const list = items.get(r.id) ?? [];
    const summary = toOrderSummary(
      r,
      list.reduce((n, i) => n + i.quantity, 0),
    );
    const c = r.customerId ? custMap.get(r.customerId) : undefined;
    return {
      ...summary,
      items: list.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        options: i.options.map((o) => o.optionName),
        note: i.note,
        lineTotalKurus: i.lineTotalKurus,
      })),
      note: r.note,
      zoneName: r.zoneName,
      changeForKurus: r.changeForKurus,
      customerOrderCount: c ? c.orderCount : null,
      customerBlocked: c?.isBlocked ?? false,
      courierName: r.courierUserId ? (courierMap.get(r.courierUserId) ?? null) : null,
      cancelRequestId: reqMap.get(r.id) ?? null,
      alarmStep: alarmMap.get(r.id) ?? null,
      outOfZoneOverride: r.outOfZoneOverride,
      zoneDeclared: (r.sourceMeta as { zoneDeclared?: unknown } | null)?.zoneDeclared === true,
      verifiedAt: iso(r.verifiedAt),
      preparingAt: iso(r.preparingAt),
      readyAt: iso(r.readyAt),
      onTheWayAt: iso(r.onTheWayAt),
      deliveredAt: iso(r.deliveredAt),
      rejectedAt: iso(r.rejectedAt),
      cancelledAt: iso(r.cancelledAt),
      delayNoticeCount: r.delayNoticeCount,
      suggestedEtaMinutes: suggest(r),
    };
  });
}

/**
 * Rol projeksiyonu (00 §4, 04 §2.4): mutfak hiçbir yanıtta fiyat görmez; müşterinin adı/telefonu/adresi de
 * mutfak ekranında gösterilmez (fişte kişisel veri yok kuralıyla uyumlu).
 */
export function projectForRole<T>(value: T, role: TenantRole): T {
  if (role !== 'kitchen') return value;
  return scrubPersonal(stripPrices(value)) as T;
}

/** Detay çekmecesi: kalemler, olay geçmişi (aktör adı), müşteri kısa geçmişi, iptal talebi, ack'ler. */
export async function buildOrderDetail(db: Database, order: OrderRow, opts: { trackingPath?: string | null } = {}): Promise<OrderDetailExt> {
  const [card] = await buildCards(db, [order]);
  const items = (await loadItems(db, [order.id])).get(order.id) ?? [];
  const events = await db
    .select({
      id: orderEvents.id,
      type: orderEvents.type,
      fromStatus: orderEvents.fromStatus,
      toStatus: orderEvents.toStatus,
      actorType: orderEvents.actorType,
      actorName: users.name,
      reason: orderEvents.reason,
      note: orderEvents.note,
      createdAt: orderEvents.createdAt,
    })
    .from(orderEvents)
    .leftJoin(users, eq(users.id, orderEvents.actorUserId))
    .where(and(eq(orderEvents.tenantId, order.tenantId), eq(orderEvents.orderId, order.id)))
    .orderBy(asc(orderEvents.createdAt));

  let customer: OrderDetailExt['customer'] = null;
  if (order.customerId) {
    const [c] = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.id, order.customerId),
          eq(customers.tenantId, order.tenantId),
          sql`not exists (select 1 from customer_erasures e where e.customer_id = ${customers.id})`,
        ),
      );
    if (c) {
      const recentRows = await db
        .select()
        .from(orders)
        .where(and(eq(orders.tenantId, order.tenantId), eq(orders.customerId, c.id), ne(orders.id, order.id)))
        .orderBy(desc(orders.placedAt))
        .limit(3);
      const recentItems = await loadItems(
        db,
        recentRows.map((r) => r.id),
      );
      customer = {
        id: c.id,
        name: c.name,
        orderCount: c.orderCount,
        lastOrderAt: iso(c.lastOrderAt),
        notes: c.notes,
        isBlocked: c.isBlocked,
        recent: recentRows.map((r) => ({
          id: r.id,
          number: r.number,
          status: r.status,
          placedAt: r.placedAt.toISOString(),
          totalKurus: r.totalKurus,
          itemsText: (recentItems.get(r.id) ?? []).map((i) => `${i.quantity}× ${i.name}`).join(', '),
        })),
      };
    }
  }

  const [req] = await db
    .select()
    .from(cancellationRequests)
    .where(eq(cancellationRequests.orderId, order.id))
    .orderBy(desc(cancellationRequests.requestedAt))
    .limit(1);
  const [review] = await db.select().from(reviews).where(eq(reviews.orderId, order.id));
  const acks = await db
    .select({ userName: users.name, deviceLabel: orderAcks.deviceLabel, ackedAt: orderAcks.ackedAt })
    .from(orderAcks)
    .leftJoin(users, eq(users.id, orderAcks.userId))
    .where(eq(orderAcks.orderId, order.id))
    .orderBy(asc(orderAcks.ackedAt));

  return {
    ...card!,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: i.name,
      quantity: i.quantity,
      unitPriceKurus: i.unitPriceKurus,
      optionsUnitKurus: i.optionsUnitKurus,
      lineTotalKurus: i.lineTotalKurus,
      note: i.note,
      options: i.options,
    })),
    events: events.map((e) => ({ ...e, actorName: e.actorName ?? null, createdAt: e.createdAt.toISOString() })),
    customerId: order.customerId,
    customerPhone: order.customerPhone,
    addressLine: order.addressLine,
    directions: order.directions,
    lat: order.lat,
    lng: order.lng,
    zoneName: order.zoneName,
    note: order.note,
    changeForKurus: order.changeForKurus,
    wantsCutlery: order.wantsCutlery,
    rejectionNote: order.rejectionNote,
    cancelNote: order.cancelNote,
    delayNoticeCount: order.delayNoticeCount,
    card: card!,
    customer,
    cancellationRequest: req ? { id: req.id, reason: req.reason, status: req.status, requestedAt: req.requestedAt.toISOString() } : null,
    review: review ? { rating: review.rating, comment: review.comment } : null,
    acks: acks.map((a) => ({ userName: a.userName ?? null, deviceLabel: a.deviceLabel, ackedAt: a.ackedAt.toISOString() })),
    printedCount: events.filter((e) => e.type === 'printed').length,
    trackingPath: opts.trackingPath ?? null,
  };
}

export { orderCardSchema, orderDetailExtSchema };
export type { OrderCard, OrderDetailExt };
