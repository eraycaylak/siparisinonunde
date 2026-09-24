// Kurye uç noktaları (14 §6.3 Kurye; 04 §9) — dilim 2.
// Yalnız kendine atanmış açık siparişler; tam müşteri telefonu yalnız burada (00 §7 "Fişte kişisel veri").
// Başka kuryenin siparişi 404 (IDOR, D06 §6.6). Teslimden sonra adres/telefon listede görünmez.

import { DEFAULT_TIMEZONE, localDateString, zonedTimeToUtc, type TenantRole } from '@siparis/core';
import {
  courierActionResponseSchema,
  courierDeliveredRequestSchema,
  courierOrdersResponseSchema,
} from '@siparis/core/orders/contracts';
import { orders, type Database } from '@siparis/db';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit, auditActor } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { requireTenantRole, tenantAuth, type TenantAuth } from '../../plugins/auth';
import { loadItems } from '../../services/orders/panel-dto';
import type { OrderRow } from '../../services/orders/summary';
import { transitionOrder } from '../../services/orders/transition';

const ROLES: readonly TenantRole[] = ['courier', 'owner', 'manager', 'cashier'];
const OPEN_FOR_COURIER = ['accepted', 'preparing', 'ready', 'on_the_way'] as const;

const idParams = z.object({ id: z.uuid() });

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

async function toCourierDtos(db: Database, rows: OrderRow[]) {
  const items = await loadItems(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    fulfillmentType: o.fulfillmentType,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    neighborhood: o.neighborhood,
    addressLine: o.addressLine,
    directions: o.directions,
    lat: o.lat,
    lng: o.lng,
    zoneName: o.zoneName,
    paymentMethod: o.paymentMethod,
    mealCardBrand: o.mealCardBrand,
    totalKurus: o.totalKurus,
    changeForKurus: o.changeForKurus,
    changeKurus:
      o.paymentMethod === 'cash_on_delivery' && o.changeForKurus && o.changeForKurus > o.totalKurus ? o.changeForKurus - o.totalKurus : null,
    note: o.note,
    items: (items.get(o.id) ?? []).map((i) => ({
      name: i.name,
      quantity: i.quantity,
      options: i.options.map((x) => x.optionName),
      note: i.note,
    })),
    estimatedReadyAt: iso(o.estimatedReadyAt),
    readyAt: iso(o.readyAt),
    onTheWayAt: iso(o.onTheWayAt),
    version: o.version,
  }));
}

/** Kilitli, bu kuryeye atanmış sipariş; değilse 404. */
async function lockAssigned(tx: Database, auth: TenantAuth, id: string): Promise<OrderRow> {
  const [o] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.tenantId, auth.tenantId), eq(orders.courierUserId, auth.userId)))
    .for('update');
  if (!o) throw notFound('Sipariş bulunamadı.');
  return o;
}

function startOfIstanbulDay(now: Date): Date {
  return zonedTimeToUtc(localDateString(now, DEFAULT_TIMEZONE), '00:00', DEFAULT_TIMEZONE);
}

const routes: FastifyPluginAsyncZod = async (app) => {
  const guard = { preHandler: requireTenantRole(ROLES) };

  // GET /courier/orders — bana atanmış açık siparişler
  app.get('/orders', { ...guard, schema: { response: { 200: courierOrdersResponseSchema } } }, async (request) => {
    const auth = tenantAuth(request);
    const rows = await app.db
      .select()
      .from(orders)
      .where(
        and(eq(orders.tenantId, auth.tenantId), eq(orders.courierUserId, auth.userId), inArray(orders.status, [...OPEN_FOR_COURIER])),
      )
      .orderBy(asc(orders.acceptedAt), asc(orders.placedAt));
    const now = new Date();
    const [count] = await app.db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, auth.tenantId),
          eq(orders.courierUserId, auth.userId),
          eq(orders.status, 'delivered'),
          gte(orders.deliveredAt, startOfIstanbulDay(now)),
        ),
      );
    return { items: await toCourierDtos(app.db, rows), deliveredToday: Number(count?.n ?? 0), serverTime: now.toISOString() };
  });

  // POST /courier/orders/:id/on-the-way — "Yola çıktım"
  app.post('/orders/:id/on-the-way', { ...guard, schema: { params: idParams, response: { 200: courierActionResponseSchema } } }, async (request) => {
    const auth = tenantAuth(request);
    const r = await app.db.transaction(async (tx) => {
      const o = await lockAssigned(tx, auth, request.params.id);
      if (o.fulfillmentType !== 'delivery') throw conflict('invalid_transition', 'Gel-al siparişinde "Yola çıktım" yok.');
      if (o.status === 'cancelled') throw conflict('order_cancelled', 'Bu sipariş iptal edildi.');
      const res = await transitionOrder(tx, {
        orderId: o.id,
        tenantId: auth.tenantId,
        to: 'on_the_way',
        actor: { type: 'user', userId: auth.userId },
      });
      if (res.changed) await audit(tx, { ...auditActor(request), action: 'order.on_the_way', entityType: 'order', entityId: o.id, data: { by: 'courier' } });
      return res;
    });
    const [dto] = await toCourierDtos(app.db, [r.order]);
    return { order: dto ?? null, status: r.order.status };
  });

  // POST /courier/orders/:id/delivered — "Teslim ettim" (ödeme alındı → paid)
  app.post(
    '/orders/:id/delivered',
    { ...guard, schema: { params: idParams, body: courierDeliveredRequestSchema, response: { 200: courierActionResponseSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const now = new Date();
      const r = await app.db.transaction(async (tx) => {
        const o = await lockAssigned(tx, auth, request.params.id);
        if (o.status === 'cancelled') throw conflict('order_cancelled', 'Bu sipariş iptal edildi.');
        const extra: Partial<typeof orders.$inferInsert> = { paymentStatus: 'paid', paidAt: now };
        const paidWith = request.body?.paidWith;
        if (paidWith && paidWith !== o.paymentMethod) {
          extra.paymentMethod = paidWith;
          extra.mealCardBrand = paidWith === 'meal_card_on_delivery' ? (request.body?.mealCardBrand ?? null) : null;
        }
        const res = await transitionOrder(tx, {
          orderId: o.id,
          tenantId: auth.tenantId,
          to: 'delivered',
          actor: { type: 'user', userId: auth.userId },
          extra,
          now,
        });
        if (res.changed) {
          await audit(tx, {
            ...auditActor(request),
            action: 'order.delivered',
            entityType: 'order',
            entityId: o.id,
            data: { by: 'courier', ...(extra.paymentMethod ? { paidWith: extra.paymentMethod } : {}) },
          });
        }
        return res;
      });
      return { order: null, status: r.order.status };
    },
  );
};

export default routes;
