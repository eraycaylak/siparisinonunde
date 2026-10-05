// Kurye uç noktaları (14 §6.3 Kurye; 04 §9) — dilim 2.
// Yalnız kendine atanmış açık siparişler; tam müşteri telefonu yalnız burada (00 §7 "Fişte kişisel veri").
// Başka kuryenin siparişi 404 (IDOR, D06 §6.6). Teslimden sonra adres/telefon listede görünmez; gel-al/masada
// siparişte kurye teslimatı olmadığı için adres, telefon ve koordinat hiç dönmez (veri minimizasyonu).

import { DEFAULT_TIMEZONE, isFinal, localDateString, zonedTimeToUtc, type TenantRole } from '@siparis/core';
import {
  courierActionResponseSchema,
  courierDeliveredRequestSchema,
  courierOrdersResponseSchema,
  courierUndeliverableRequestSchema,
} from '@siparis/core/orders/contracts';
import { courierPaymentMethods } from '@siparis/core/orders/delivery';
import { orders, type Database } from '@siparis/db';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit, auditActor } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { requireTenantRole, tenantAuth, type TenantAuth } from '../../plugins/auth';
import {
  loadBranchPaymentMap,
  loadDeliveryFailures,
  loadOrderBranch,
  recordDeliveryFailure,
  recordPaymentMethodChange,
  resolveCourierPayment,
} from '../../services/orders/courier';
import { loadItems } from '../../services/orders/panel-dto';
import type { OrderRow } from '../../services/orders/summary';
import { transitionOrder } from '../../services/orders/transition';

const ROLES: readonly TenantRole[] = ['courier', 'owner', 'manager', 'cashier'];
const OPEN_FOR_COURIER = ['accepted', 'preparing', 'ready', 'on_the_way'] as const;

const idParams = z.object({ id: z.uuid() });

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

async function toCourierDtos(db: Database, tenantId: string, rows: OrderRow[]) {
  const items = await loadItems(
    db,
    rows.map((r) => r.id),
  );
  const branchPayments = await loadBranchPaymentMap(db, tenantId, [...new Set(rows.map((r) => r.branchId))]);
  const failures = await loadDeliveryFailures(
    db,
    tenantId,
    rows.map((r) => r.id),
  );
  return rows.map((o) => {
    // Kuryenin müşteri verisine erişimi yalnız "elinde teslim edilecek paket varken": gel-al/masada siparişte
    // kurye teslimatı yoktur, teslim/iptal sonrası da adres ve telefon görünmez (04 §9.2 Gizlilik).
    const showCustomer = o.fulfillmentType === 'delivery' && !isFinal(o.status);
    const failure = failures.get(o.id);
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      fulfillmentType: o.fulfillmentType,
      customerName: o.customerName,
      customerPhone: showCustomer ? o.customerPhone : null,
      neighborhood: showCustomer ? o.neighborhood : null,
      addressLine: showCustomer ? o.addressLine : null,
      directions: showCustomer ? o.directions : null,
      lat: showCustomer ? o.lat : null,
      lng: showCustomer ? o.lng : null,
      zoneName: showCustomer ? o.zoneName : null,
      paymentMethod: o.paymentMethod,
      mealCardBrand: o.mealCardBrand,
      // Siparişin mevcut yöntemi de sınanır: online/kasada ödenmişse liste boş döner, ekran "farklı yöntemle"
      // önermez (yoksa kurye seçeneği görür ama uç 422 `payment_method_locked` verirdi).
      allowedPaymentMethods: courierPaymentMethods({
        branchPaymentMethods: branchPayments.get(o.branchId)?.paymentMethods ?? [],
        fulfillmentType: o.fulfillmentType,
        orderPaymentMethod: o.paymentMethod,
      }),
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
      deliveryAttempts: failure?.attempts ?? 0,
      lastDeliveryFailure: failure?.last ? { reason: failure.last.reason, note: failure.last.note, at: failure.last.at.toISOString() } : null,
      version: o.version,
    };
  });
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
    return { items: await toCourierDtos(app.db, auth.tenantId, rows), deliveredToday: Number(count?.n ?? 0), serverTime: now.toISOString() };
  });

  // POST /courier/orders/:id/on-the-way — "Yola çıktım"
  app.post('/orders/:id/on-the-way', { ...guard, schema: { params: idParams, response: { 200: courierActionResponseSchema } } }, async (request) => {
    const auth = tenantAuth(request);
    const r = await app.db.transaction(async (tx) => {
      const o = await lockAssigned(tx, auth, request.params.id);
      if (o.fulfillmentType !== 'delivery') throw conflict('invalid_transition', 'Gel-al siparişinde "Yola çıktım" yok.');
      if (o.status === 'cancelled') throw conflict('order_cancelled', 'Bu sipariş iptal edildi.');
      if (o.status === 'preparing') throw conflict('order_not_ready', 'Sipariş mutfakta hazırlanıyor. Hazır olunca yola çıkabilirsiniz.');
      const res = await transitionOrder(tx, {
        orderId: o.id,
        tenantId: auth.tenantId,
        to: 'on_the_way',
        actor: { type: 'user', userId: auth.userId },
      });
      if (res.changed) await audit(tx, { ...auditActor(request), action: 'order.on_the_way', entityType: 'order', entityId: o.id, data: { by: 'courier' } });
      return res;
    });
    const [dto] = await toCourierDtos(app.db, auth.tenantId, [r.order]);
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
        const branch = await loadOrderBranch(tx, o);
        // Kapıda bildirilen yöntem: şubede açık ve kapıda tahsil edilen yöntemlerden olmalı (denetim H11)
        const patch = resolveCourierPayment(branch, o, request.body ?? undefined);
        const extra: Partial<typeof orders.$inferInsert> = patch ? { ...patch } : {};
        // online_card (Faz 2) ödemesi kapıda alınmaz: durumunu ödeme sağlayıcısı yazar, kurye "ödendi" diyemez.
        // (Bu siparişte yöntem de değiştirilemez: resolveCourierPayment 422 payment_method_locked verir.)
        if (o.paymentMethod !== 'online_card') {
          extra.paymentStatus = 'paid';
          extra.paidAt = now;
        }
        if (patch) await recordPaymentMethodChange(tx, { order: o, patch, actorUserId: auth.userId, now });
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
            data: {
              by: 'courier',
              ...(patch
                ? {
                    paidWith: patch.paymentMethod,
                    paidWithBrand: patch.mealCardBrand,
                    previousPaymentMethod: o.paymentMethod,
                    previousMealCardBrand: o.mealCardBrand ?? null,
                  }
                : {}),
            },
          });
        }
        return res;
      });
      return { order: null, status: r.order.status };
    },
  );

  // POST /courier/orders/:id/undeliverable — "Teslim edilemedi" (04 §9.2)
  // Sipariş DURUM DEĞİŞTİRMEZ: karar işletmededir (tekrar dene ya da `courier_issue` ile iptal). Panele uyarı gider.
  app.post(
    '/orders/:id/undeliverable',
    { ...guard, schema: { params: idParams, body: courierUndeliverableRequestSchema, response: { 200: courierActionResponseSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const now = new Date();
      const order = await app.db.transaction(async (tx) => {
        const o = await lockAssigned(tx, auth, request.params.id);
        if (o.fulfillmentType !== 'delivery') throw conflict('invalid_transition', 'Gel-al siparişinde teslim bildirimi yapılmaz.');
        if (o.status === 'cancelled') throw conflict('order_cancelled', 'Bu sipariş iptal edildi.');
        if (o.status === 'delivered') throw conflict('already_delivered', 'Bu sipariş teslim edildi olarak kaydedilmiş.');
        if (o.status !== 'on_the_way') throw conflict('order_not_on_the_way', 'Önce "Yola çıktım" demeniz gerekiyor.');
        await recordDeliveryFailure(tx, { order: o, reason: request.body.reason, note: request.body.note, actorUserId: auth.userId, now });
        await audit(tx, {
          ...auditActor(request),
          action: 'order.delivery_failed',
          entityType: 'order',
          entityId: o.id,
          data: { by: 'courier', reason: request.body.reason },
        });
        return o;
      });
      const [dto] = await toCourierDtos(app.db, auth.tenantId, [order]);
      return { order: dto ?? null, status: order.status };
    },
  );
};

export default routes;
