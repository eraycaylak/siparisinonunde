// Panel siparişler (14 §6.3 Canlı + Sipariş; stream.ts hariç) — dilim 2.
// Roller (04 §2.4): owner/manager/cashier tüm sipariş aksiyonları; kitchen yalnız okuma (fiyatsız, kişisel verisiz)
// + preparing/ready ilerletme; courier bu uçları kullanmaz (/courier). Tüm sorgular tenant kapsamlıdır; başka tenant 404.

import {
  ADVANCE_TARGETS,
  FINAL_ORDER_STATUSES,
  OPEN_ORDER_STATUSES,
  ORDER_STATUSES,
  REJECTION_UNDO_WINDOW_MS,
  acceptOrderRequestSchema,
  assignCourierRequestSchema,
  cancelOrderRequestSchema,
  cartItemSchema,
  delayOrderRequestSchema,
  endOfLocalDay,
  fulfillmentTypeSchema,
  idSchema,
  localDateString,
  mealCardBrandSchema,
  normalizePhone,
  nonNegativeKurusSchema,
  paymentMethodSchema,
  rejectOrderRequestSchema,
  TENANT_CANCEL_REASONS,
  validateTransition,
  zonedTimeToUtc,
  type OrderStatus,
  type TenantRole,
} from '@siparis/core';
import {
  branches,
  cancellationRequests,
  customerAddresses,
  customers,
  memberships,
  orderAcks,
  orderEvents,
  orderItemOptions,
  orderItems,
  orders,
  products,
  tenants,
  users,
  waAccounts,
  type Database,
} from '@siparis/db';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit, auditActor } from '../../lib/audit';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors';
import { cancelJobs, enqueueJob } from '../../lib/jobs';
import { trackingUrl } from '../../lib/tracking';
import { assertBranchAccess, defaultBranchId, requireTenantRole, tenantAuth, type TenantAuth } from '../../plugins/auth';
import { finalizeRejectionKey } from '../../services/orders/alarm-policy';
import { insertOrderWithItems, rememberAddress, upsertCustomerByPhone } from '../../services/orders/create-order';
import { soldOutUntilFor } from '../../services/menu/sold-out';
import { phoneOrderNotifyFields } from '../../services/orders/notify-consent';
import {
  activeOrdersResponseSchema,
  courierListResponseSchema,
  manualMenuResponseSchema,
  manualOrderRequestSchema,
  orderCardResponseSchema,
  ordersListResponseSchema,
  panelAssignCourierRequestSchema,
  panelCancelRequestSchema,
  panelRejectRequestSchema,
  rejectOrderResponseSchema,
  customerLookupResponseSchema,
  RECEIPT_TYPES,
  type ManualMenuResponse,
} from '@siparis/core/orders/contracts';
import { buildCards, buildOrderDetail, loadItems, orderDetailExtSchema, projectForRole, type OrderCard } from '../../services/orders/panel-dto';
import { fieldError, validatePayment } from '../../services/orders/payment';
import { loadPricingProducts, loadZones, quoteForBranch } from '../../services/orders/pricing-context';
import { buildReceipt, renderReceiptHtml, resolveReceiptSettings } from '../../services/orders/receipt';
import { emitOrderUpdated, findOrder, type OrderRow } from '../../services/orders/summary';
import { transitionOrder } from '../../services/orders/transition';

const STAFF: readonly TenantRole[] = ['owner', 'manager', 'cashier'];
const READERS: readonly TenantRole[] = ['owner', 'manager', 'cashier', 'kitchen'];
const KITCHEN_STATUSES: OrderStatus[] = ['accepted', 'preparing', 'ready'];
const MAX_DELAY_NOTICES = 2;

const idParams = z.object({ id: z.uuid() });
const cardResponse = orderCardResponseSchema;

const activeQuery = z.object({ branchId: z.uuid().optional() });
const listQuery = z.object({
  status: z.string().max(200).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  branchId: z.uuid().optional(),
  channel: z.string().max(40).optional(),
  fulfillmentType: fulfillmentTypeSchema.optional(),
  includeTests: z.enum(['0', '1']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const ackBody = z.object({ deviceLabel: z.string().trim().max(60).optional() }).optional();
const decideParams = z.object({ id: z.uuid(), reqId: z.uuid() });
const decideBody = z.object({ approve: z.boolean() });

const receiptQuery = z.object({
  type: z.enum(RECEIPT_TYPES).default('kitchen'),
  format: z.enum(['json', 'html']).default('json'),
  /** 1: yazdırma kaydı (order_events 'printed'); sonraki baskılar KOPYA. */
  print: z.enum(['0', '1']).optional(),
  width: z.enum(['58', '80']).optional(),
});

const lookupQuery = z.object({ phone: z.string().trim().min(3).max(20) });

function roundUpTo5Minutes(d: Date): Date {
  const step = 5 * 60_000;
  return new Date(Math.ceil(d.getTime() / step) * step);
}

async function resolveBranchId(app: { db: Database }, auth: TenantAuth, branchId?: string): Promise<string> {
  const id = branchId ?? auth.branchId ?? (await defaultBranchId(app.db, auth.tenantId));
  if (!id) throw notFound('Şube bulunamadı.');
  await assertBranchAccess(app.db, auth, id);
  return id;
}

/** Tenant (ve üyelik şubesi) kapsamlı sipariş; yoksa 404. */
async function loadOrderFor(db: Database, auth: TenantAuth, id: string): Promise<OrderRow> {
  const order = await findOrder(db, auth.tenantId, id);
  if (!order || (auth.branchId && order.branchId !== auth.branchId)) throw notFound('Sipariş bulunamadı.');
  return order;
}

/** Kilitli okuma (aynı transaction'da güncelleme için). */
async function lockOrder(tx: Database, auth: TenantAuth, id: string): Promise<OrderRow> {
  const [o] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.tenantId, auth.tenantId)))
    .for('update');
  if (!o || (auth.branchId && o.branchId !== auth.branchId)) throw notFound('Sipariş bulunamadı.');
  return o;
}

function checkVersion(order: OrderRow, version?: number) {
  if (version != null && version !== order.version) {
    throw conflict('version_conflict', 'Sipariş başka biri tarafından güncellendi. Ekranı yenileyin.', {
      currentVersion: order.version,
      status: order.status,
    });
  }
}

async function cardOf(db: Database, order: OrderRow, role: TenantRole): Promise<OrderCard> {
  const [card] = await buildCards(db, [order]);
  return projectForRole(card!, role);
}

function startOfLocalDay(date: Date, tz = 'Europe/Istanbul'): Date {
  return zonedTimeToUtc(localDateString(date, tz), '00:00', tz);
}

/** 'YYYY-MM-DD' (İstanbul yerel günü) ya da ISO zaman. */
function parseDateBound(v: string | undefined, end: boolean): Date | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const start = zonedTimeToUtc(v, '00:00', 'Europe/Istanbul');
    return end ? endOfLocalDay(start) : start;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw fieldError(end ? 'to' : 'from', 'Tarih biçimi geçersiz.');
  return d;
}

function encodeCursor(o: OrderRow): string {
  return Buffer.from(`${o.placedAt.toISOString()}|${o.id}`).toString('base64url');
}
function decodeCursor(c: string): { placedAt: Date; id: string } | null {
  try {
    const [ts, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
    const d = new Date(ts ?? '');
    if (!id || Number.isNaN(d.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { placedAt: d, id };
  } catch {
    return null;
  }
}


const routes: FastifyPluginAsyncZod = async (app) => {
  const readers = { preHandler: requireTenantRole(READERS) };
  const staff = { preHandler: requireTenantRole(STAFF) };

  // -------------------------------------------------------------------------
  // GET /panel/orders/active — açık siparişler + bugün tamamlananlar (45 sn emniyet sorgusu, 14 §7.1)
  app.get('/orders/active', { ...readers, schema: { querystring: activeQuery, response: { 200: activeOrdersResponseSchema } } }, async (request) => {
    const auth = tenantAuth(request);
    const branchId = await resolveBranchId(app, auth, request.query.branchId);
    const [branch] = await app.db.select().from(branches).where(eq(branches.id, branchId));
    const kitchen = auth.role === 'kitchen';
    const statuses = kitchen ? KITCHEN_STATUSES : [...OPEN_ORDER_STATUSES];
    const open = await app.db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, auth.tenantId),
          eq(orders.branchId, branchId),
          inArray(orders.status, statuses),
          or(isNull(orders.testKind), ne(orders.testKind, 'canary')),
        ),
      )
      .orderBy(asc(orders.placedAt))
      .limit(300);
    const now = new Date();
    const completed = kitchen
      ? []
      : await app.db
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.tenantId, auth.tenantId),
              eq(orders.branchId, branchId),
              inArray(orders.status, [...FINAL_ORDER_STATUSES]),
              gte(orders.updatedAt, startOfLocalDay(now)),
              or(isNull(orders.testKind), ne(orders.testKind, 'canary')),
            ),
          )
          .orderBy(desc(orders.updatedAt))
          .limit(60);
    const [items, done] = await Promise.all([buildCards(app.db, open), buildCards(app.db, completed)]);
    return {
      branch: {
        id: branch!.id,
        name: branch!.name,
        usePreparingStep: branch!.usePreparingStep,
        defaultPrepMinutes: branch!.defaultPrepMinutes,
        busyExtraMinutes: branch!.busyExtraMinutes,
        acceptsDelivery: branch!.acceptsDelivery,
        receipt: (() => {
          const st = resolveReceiptSettings(branch!.receiptSettings);
          return { autoPrint: st.auto_print, printKitchen: st.print_kitchen, printDelivery: st.print_delivery };
        })(),
      },
      items: items.map((c) => projectForRole(c, auth.role)),
      completed: done.map((c) => projectForRole(c, auth.role)),
      serverTime: now.toISOString(),
    };
  });

  // GET /panel/orders — geçmiş (filtre + imleç) (04 §4.18). Kasiyer bugün + dün.
  app.get('/orders', { ...staff, schema: { querystring: listQuery, response: { 200: ordersListResponseSchema } } }, async (request) => {
    const auth = tenantAuth(request);
    const q = request.query;
    const where: SQL[] = [eq(orders.tenantId, auth.tenantId)];
    if (q.branchId || auth.branchId) where.push(eq(orders.branchId, await resolveBranchId(app, auth, q.branchId)));
    if (q.status) {
      const list = q.status.split(',').map((s) => s.trim()).filter(Boolean);
      for (const s of list) if (!(ORDER_STATUSES as readonly string[]).includes(s)) throw fieldError('status', 'Geçersiz durum filtresi.');
      if (list.length) where.push(inArray(orders.status, list as OrderStatus[]));
    }
    if (q.channel) where.push(eq(orders.channel, q.channel as OrderRow['channel']));
    if (q.fulfillmentType) where.push(eq(orders.fulfillmentType, q.fulfillmentType));
    if (q.includeTests !== '1') where.push(or(isNull(orders.testKind), ne(orders.testKind, 'canary'))!);
    let from = parseDateBound(q.from, false);
    const to = parseDateBound(q.to, true);
    if (auth.role === 'cashier') {
      const minFrom = startOfLocalDay(new Date(Date.now() - 86_400_000));
      if (!from || from < minFrom) from = minFrom;
    }
    if (from) where.push(gte(orders.placedAt, from));
    if (to) where.push(lt(orders.placedAt, to));
    if (q.q) {
      const term = q.q.replace(/^#/, '');
      const digits = term.replace(/\D/g, '');
      const conds: SQL[] = [ilike(orders.customerName, `%${term.replace(/[%_]/g, '')}%`)];
      if (/^\d+$/.test(term)) {
        conds.push(eq(orders.number, Number(term)));
        if (digits.length >= 4) conds.push(sql`${orders.customerPhone} like ${`%${digits.slice(-10)}`}`);
      }
      where.push(or(...conds)!);
    }
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      if (!c) throw fieldError('cursor', 'Geçersiz sayfa imleci.');
      where.push(sql`(${orders.placedAt}, ${orders.id}) < (${c.placedAt.toISOString()}::timestamptz, ${c.id}::uuid)`);
    }
    const limit = q.limit ?? 30;
    const rows = await app.db
      .select()
      .from(orders)
      .where(and(...where))
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const cards = await buildCards(app.db, page);
    return {
      items: cards.map((c) => projectForRole(c, auth.role)),
      ...(rows.length > limit ? { nextCursor: encodeCursor(page[page.length - 1]!) } : {}),
    };
  });

  // GET /panel/orders/couriers — kurye atama listesi (04 §4.15)
  app.get('/orders/couriers', { ...staff, schema: { response: { 200: courierListResponseSchema } } }, async (request) => {
    const auth = tenantAuth(request);
    const rows = await app.db
      .select({ id: users.id, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, auth.tenantId), eq(memberships.role, 'courier'), isNull(memberships.disabledAt), isNull(users.disabledAt)))
      .orderBy(asc(users.name));
    const counts = rows.length
      ? await app.db
          .select({
            courier: orders.courierUserId,
            active: sql<number>`count(*)::int`,
            onTheWay: sql<number>`count(*) filter (where ${orders.status} = 'on_the_way')::int`,
          })
          .from(orders)
          .where(
            and(
              eq(orders.tenantId, auth.tenantId),
              inArray(
                orders.courierUserId,
                rows.map((r) => r.id),
              ),
              inArray(orders.status, ['accepted', 'preparing', 'ready', 'on_the_way']),
            ),
          )
          .groupBy(orders.courierUserId)
      : [];
    const map = new Map(counts.map((c) => [c.courier, c]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        activeCount: Number(map.get(r.id)?.active ?? 0),
        onTheWayCount: Number(map.get(r.id)?.onTheWay ?? 0),
      })),
    };
  });

  // -------------------------------------------------------------------------
  // Telefon siparişi (Akış E, 04 §4.13)

  // GET /panel/orders/manual/menu — menü (fiyatlı; tükenen işaretli; "WhatsApp'ta satılamaz" listelenmez), bölgeler, ödeme
  app.get('/orders/manual/menu', { ...staff, schema: { response: { 200: manualMenuResponseSchema } } }, async (request) => {
    const auth = tenantAuth(request);
    const branchId = await resolveBranchId(app, auth);
    const [branch] = await app.db.select().from(branches).where(eq(branches.id, branchId));
    const productMap = await loadPricingProducts(app.db, auth.tenantId);
    const zones = await loadZones(app.db, auth.tenantId, branchId);
    const now = Date.now();
    const cats = new Map<string, ManualMenuResponse['categories'][number] & { sort: number }>();
    const list = [...productMap.values()]
      .filter((p) => p.isActive !== false && !p.waRestricted)
      .sort((a, b) => a.categorySort - b.categorySort || a.sort - b.sort || a.name.localeCompare(b.name, 'tr'));
    for (const p of list) {
      const cat = cats.get(p.categoryId) ?? { id: p.categoryId, name: p.categoryName ?? '', sort: p.categorySort, products: [] };
      const soldOut = p.soldOutUntil ? new Date(p.soldOutUntil).getTime() > now : false;
      cat.products.push({
        id: p.id,
        name: p.name,
        description: p.description,
        priceKurus: p.priceKurus,
        soldOut,
        optionGroups: p.optionGroups.map((g) => ({
          id: g.id,
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          options: g.options.filter((o) => o.isActive !== false).map((o) => ({ id: o.id, name: o.name, priceDeltaKurus: o.priceDeltaKurus })),
        })),
      });
      cats.set(p.categoryId, cat);
    }
    return {
      branch: {
        id: branch!.id,
        name: branch!.name,
        acceptsDelivery: branch!.acceptsDelivery,
        acceptsPickup: branch!.acceptsPickup,
        paymentMethods: branch!.paymentMethods,
        mealCardBrands: branch!.mealCardBrands,
        prepMinutes: branch!.defaultPrepMinutes,
        busyExtraMinutes: branch!.busyExtraMinutes,
      },
      zones: zones
        .filter((z) => z.isActive)
        .map((z) => ({
          id: z.id,
          name: z.name,
          kind: z.kind,
          neighborhoods: z.neighborhoods,
          feeKurus: z.feeKurus,
          minOrderKurus: z.minOrderKurus,
          etaMinutes: z.etaMinutes,
        })),
      categories: [...cats.values()].sort((a, b) => a.sort - b.sort).map(({ sort: _s, ...c }) => c),
    };
  });

  // GET /panel/orders/manual/customers?phone= — telefonla müşteri arama: kayıtlı adresler + son 3 sipariş
  app.get('/orders/manual/customers', { ...staff, schema: { querystring: lookupQuery, response: { 200: customerLookupResponseSchema } } }, async (request) => {
    const auth = tenantAuth(request);
    const digits = request.query.phone.replace(/\D/g, '').replace(/^0+/, '').replace(/^90(?=5\d{9}$)/, '');
    if (digits.length < 3) return { items: [] };
    const found = await app.db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, auth.tenantId), sql`${customers.phoneE164} like ${`%${digits}%`}`))
      .orderBy(desc(customers.lastOrderAt))
      .limit(5);
    const items = [];
    for (const c of found) {
      const addrs = await app.db
        .select()
        .from(customerAddresses)
        .where(and(eq(customerAddresses.tenantId, auth.tenantId), eq(customerAddresses.customerId, c.id)))
        .orderBy(desc(customerAddresses.lastUsedAt))
        .limit(5);
      const last = await app.db
        .select()
        .from(orders)
        .where(and(eq(orders.tenantId, auth.tenantId), eq(orders.customerId, c.id)))
        .orderBy(desc(orders.placedAt))
        .limit(3);
      const lastItems = await loadItems(
        app.db,
        last.map((o) => o.id),
      );
      const optRows = last.length
        ? await app.db
            .select({ itemId: orderItemOptions.orderItemId, optionId: orderItemOptions.optionId })
            .from(orderItemOptions)
            .innerJoin(orderItems, eq(orderItems.id, orderItemOptions.orderItemId))
            .where(
              inArray(
                orderItems.orderId,
                last.map((o) => o.id),
              ),
            )
        : [];
      items.push({
        id: c.id,
        name: c.name,
        phoneE164: c.phoneE164,
        orderCount: c.orderCount,
        isBlocked: c.isBlocked,
        notes: c.notes,
        addresses: addrs.map((a) => ({
          id: a.id,
          label: a.label,
          neighborhood: a.neighborhood,
          addressLine: a.addressLine,
          directions: a.directions,
        })),
        lastOrders: last.map((o) => ({
          id: o.id,
          number: o.number,
          placedAt: o.placedAt.toISOString(),
          totalKurus: o.totalKurus,
          items: (lastItems.get(o.id) ?? []).map((i) => ({
            productId: i.productId,
            name: i.name,
            quantity: i.quantity,
            note: i.note,
            optionIds: optRows.filter((x) => x.itemId === i.id && x.optionId).map((x) => x.optionId as string),
          })),
        })),
      });
    }
    return { items };
  });

  // POST /panel/orders/manual — telefon siparişi: kanal manual, verification_method staff; isteğe bağlı new → accepted
  app.post('/orders/manual', { ...staff, schema: { body: manualOrderRequestSchema, response: { 200: cardResponse } } }, async (request) => {
    const auth = tenantAuth(request);
    const body = request.body;
    const branchId = await resolveBranchId(app, auth);
    const [branch] = await app.db.select().from(branches).where(eq(branches.id, branchId));
    if (body.idempotencyKey) {
      const [dup] = await app.db
        .select()
        .from(orders)
        .where(and(eq(orders.tenantId, auth.tenantId), eq(orders.idempotencyKey, body.idempotencyKey)));
      if (dup) return { order: await cardOf(app.db, dup, auth.role) };
    }
    const phone = normalizePhone(body.customerPhone);
    if (!phone) throw fieldError('customerPhone', 'Telefon numarası 10 haneli olmalı (5xx xxx xx xx).');
    if (body.fulfillmentType === 'delivery' && (!body.addressLine || body.addressLine.trim().length < 3)) {
      throw fieldError('addressLine', 'Teslimat adresini yazın.');
    }
    const override = body.fulfillmentType === 'delivery' && body.outOfZoneFeeKurus != null ? { feeKurus: body.outOfZoneFeeKurus } : null;
    const { quote, zoneMatch } = await quoteForBranch(app.db, {
      tenantId: auth.tenantId,
      branch: branch!,
      request: body,
      outOfZoneOverride: override,
    });
    // Telefon siparişinde min sepet uyarıdır, engellemez (04 §4.12 notu)
    const problems = quote.problems.filter((p) => p.code !== 'min_basket_not_met');
    if (problems.length) {
      throw new AppError(422, 'cart_invalid', problems[0]!.message, { problems });
    }
    validatePayment(branch!, body, quote.totalKurus);
    const outOfZone = body.fulfillmentType === 'delivery' && !zoneMatch;
    const now = new Date();
    const eta =
      body.etaMinutes ??
      Math.max(
        5,
        Math.ceil(
          ((zoneMatch && body.fulfillmentType === 'delivery' ? zoneMatch.zone.etaMinutes : 0) + branch!.defaultPrepMinutes + branch!.busyExtraMinutes) / 5,
        ) * 5,
      );

    const order = await app.db.transaction(async (tx) => {
      const customer = await upsertCustomerByPhone(tx, auth.tenantId, phone, body.customerName);
      const neighborhood = zoneMatch?.neighborhood ?? body.neighborhood?.trim() ?? null;
      if (body.fulfillmentType === 'delivery') {
        await rememberAddress(tx, {
          tenantId: auth.tenantId,
          customerId: customer.id,
          neighborhood,
          addressLine: body.addressLine?.trim() ?? null,
          directions: body.directions?.trim() || null,
          lat: body.lat ?? null,
          lng: body.lng ?? null,
        });
      }
      const created = await insertOrderWithItems(
        tx,
        {
          tenantId: auth.tenantId,
          branchId,
          status: 'new',
          channel: 'manual',
          fulfillmentType: body.fulfillmentType,
          quote,
          zone: zoneMatch ? { id: zoneMatch.zone.id, name: zoneMatch.zone.name } : null,
          neighborhood: body.fulfillmentType === 'delivery' ? neighborhood : null,
          addressLine: body.fulfillmentType === 'delivery' ? (body.addressLine?.trim() ?? null) : null,
          directions: body.fulfillmentType === 'delivery' ? body.directions?.trim() || null : null,
          lat: body.fulfillmentType === 'delivery' ? (body.lat ?? null) : null,
          lng: body.fulfillmentType === 'delivery' ? (body.lng ?? null) : null,
          outOfZoneOverride: outOfZone,
          customerId: customer.id,
          customerName: body.customerName.trim(),
          customerPhone: phone,
          paymentMethod: body.paymentMethod,
          mealCardBrand: body.paymentMethod === 'meal_card_on_delivery' ? (body.mealCardBrand ?? null) : null,
          changeForKurus: body.paymentMethod === 'cash_on_delivery' && body.changeForKurus ? body.changeForKurus : null,
          wantsCutlery: body.wantsCutlery,
          note: body.note?.trim() || null,
          verificationMethod: 'staff',
          verifiedAt: now,
          idempotencyKey: body.idempotencyKey ?? null,
          // Bildirim onayı → status_notify_channel + source_meta.notifyConsent (dilim 3 aynı biçimi okur)
          ...phoneOrderNotifyFields(body.notifyWhatsapp),
          createdByUserId: auth.userId,
        },
        { type: 'user', userId: auth.userId },
      );
      if (outOfZone) {
        await audit(tx, {
          ...auditActor(request),
          action: 'order.out_of_zone_override',
          entityType: 'order',
          entityId: created.id,
          data: { feeKurus: body.outOfZoneFeeKurus ?? 0, neighborhood, addressLine: body.addressLine ? '[maskeli]' : null },
        });
      }
      await audit(tx, {
        ...auditActor(request),
        action: 'order.manual_create',
        entityType: 'order',
        entityId: created.id,
        data: { number: created.number, acceptNow: body.acceptNow, notifyWhatsapp: body.notifyWhatsapp },
      });
      if (!body.acceptNow) return created;
      const r = await transitionOrder(tx, {
        orderId: created.id,
        tenantId: auth.tenantId,
        to: 'accepted',
        actor: { type: 'user', userId: auth.userId },
        extra: { etaMinutes: eta, estimatedReadyAt: roundUpTo5Minutes(new Date(now.getTime() + eta * 60_000)) },
      });
      return r.order;
    });
    return { order: await cardOf(app.db, order, auth.role) };
  });

  // -------------------------------------------------------------------------
  // GET /panel/orders/:id — detay çekmecesi (P-05)
  app.get('/orders/:id', { ...readers, schema: { params: idParams, response: { 200: orderDetailExtSchema } } }, async (request) => {
    const auth = tenantAuth(request);
    const order = await loadOrderFor(app.db, auth, request.params.id);
    if (auth.role === 'kitchen' && !KITCHEN_STATUSES.includes(order.status) && order.status !== 'on_the_way' && order.status !== 'delivered') {
      throw notFound('Sipariş bulunamadı.');
    }
    const path = new URL(trackingUrl(app.config.APP_BASE_URL, order.id, app.config.TRACKING_SECRET)).pathname;
    const detail = await buildOrderDetail(app.db, order, { trackingPath: auth.role === 'kitchen' ? null : path });
    return projectForRole(detail, auth.role);
  });

  // POST /panel/orders/:id/ack — cihaz siparişi gördü (order_acks; ilk ack first_acked_at)
  app.post('/orders/:id/ack', { ...readers, schema: { params: idParams, body: ackBody, response: { 200: cardResponse } } }, async (request) => {
    const auth = tenantAuth(request);
    const order = await app.db.transaction(async (tx) => {
      const o = await lockOrder(tx, auth, request.params.id);
      await tx.insert(orderAcks).values({
        tenantId: auth.tenantId,
        orderId: o.id,
        userId: auth.userId,
        deviceLabel: request.body?.deviceLabel ?? null,
      });
      if (o.firstAckedAt) return o;
      const [u] = await tx.update(orders).set({ firstAckedAt: new Date() }).where(eq(orders.id, o.id)).returning();
      await emitOrderUpdated(tx, { order: u!, change: 'ack' });
      return u!;
    });
    return { order: await cardOf(app.db, order, auth.role) };
  });

  // POST /panel/orders/:id/accept {etaMinutes} — new → accepted; bekleyen ret varsa 409 rejection_pending
  app.post(
    '/orders/:id/accept',
    { ...staff, schema: { params: idParams, body: acceptOrderRequestSchema, response: { 200: cardResponse } } },
    async (request) => {
      const auth = tenantAuth(request);
      const { etaMinutes, version } = request.body;
      const now = new Date();
      const r = await app.db.transaction(async (tx) => {
        await lockOrder(tx, auth, request.params.id);
        const res = await transitionOrder(tx, {
          orderId: request.params.id,
          tenantId: auth.tenantId,
          to: 'accepted',
          actor: { type: 'user', userId: auth.userId },
          expectedVersion: version,
          extra: { etaMinutes, estimatedReadyAt: roundUpTo5Minutes(new Date(now.getTime() + etaMinutes * 60_000)) },
          now,
        });
        if (res.changed) {
          await audit(tx, { ...auditActor(request), action: 'order.accept', entityType: 'order', entityId: res.order.id, data: { etaMinutes } });
        }
        return res;
      });
      return { order: await cardOf(app.db, r.order, auth.role) };
    },
  );

  // POST /panel/orders/:id/reject {reason, note} — 30 sn bekleyen ret + order.finalize_rejection (04 §4.7)
  app.post(
    '/orders/:id/reject',
    {
      ...staff,
      schema: { params: idParams, body: panelRejectRequestSchema, response: { 200: rejectOrderResponseSchema } },
    },
    async (request) => {
      const auth = tenantAuth(request);
      const body = request.body;
      const now = new Date();
      const order = await app.db.transaction(async (tx) => {
        const o = await lockOrder(tx, auth, request.params.id);
        if (o.status === 'new' && o.rejectionScheduledAt) throw conflict('rejection_pending', 'Bu sipariş zaten reddediliyor.');
        checkVersion(o, body.version);
        const err = validateTransition(o.status, 'rejected', { reason: body.reason, note: body.note });
        if (err) {
          if (err.code === 'invalid_transition') throw conflict('invalid_transition', 'Yalnız yeni siparişler reddedilebilir.', { from: o.status });
          throw new AppError(400, err.code, err.message);
        }
        const [u] = await tx
          .update(orders)
          .set({
            rejectionScheduledAt: now,
            rejectionReason: body.reason,
            rejectionNote: body.note?.trim() || null,
            rejectionRequestedBy: auth.userId,
            version: o.version + 1,
            updatedAt: now,
          })
          .where(eq(orders.id, o.id))
          .returning();
        await tx.insert(orderEvents).values({
          tenantId: auth.tenantId,
          orderId: o.id,
          type: 'rejection_scheduled',
          actorType: 'user',
          actorUserId: auth.userId,
          reason: body.reason,
          note: body.note?.trim() || null,
        });
        await enqueueJob(tx, {
          queue: 'notify',
          type: 'order.finalize_rejection',
          tenantId: auth.tenantId,
          delayMs: REJECTION_UNDO_WINDOW_MS,
          dedupeKey: finalizeRejectionKey(o.id),
          payload: {
            orderId: o.id,
            tenantId: auth.tenantId,
            scheduledAt: now.toISOString(),
            blockCustomer: body.reason === 'suspected_fake' && body.blockCustomer === true,
          },
        });
        if (body.reason === 'item_unavailable' && body.soldOutProductIds?.length) {
          await tx
            .update(products)
            .set({ soldOutUntil: await soldOutUntilFor(tx, auth.tenantId, o.branchId, now) })
            .where(and(eq(products.tenantId, auth.tenantId), inArray(products.id, body.soldOutProductIds)));
          await audit(tx, {
            ...auditActor(request),
            action: 'menu.sold_out_from_reject',
            entityType: 'order',
            entityId: o.id,
            data: { productIds: body.soldOutProductIds },
          });
        }
        await emitOrderUpdated(tx, { order: u!, change: 'rejection_scheduled' });
        await audit(tx, { ...auditActor(request), action: 'order.reject', entityType: 'order', entityId: o.id, data: { reason: body.reason } });
        return u!;
      });
      return {
        order: await cardOf(app.db, order, auth.role),
        undoDeadline: new Date(now.getTime() + REJECTION_UNDO_WINDOW_MS).toISOString(),
      };
    },
  );

  // POST /panel/orders/:id/undo-reject — bekleyen reddi geri al (iş iptal + alan temizlenir; sipariş new kalır)
  app.post('/orders/:id/undo-reject', { ...staff, schema: { params: idParams, response: { 200: cardResponse } } }, async (request) => {
    const auth = tenantAuth(request);
    const order = await app.db.transaction(async (tx) => {
      const o = await lockOrder(tx, auth, request.params.id);
      if (o.status === 'rejected') throw conflict('rejection_finalized', 'Ret kesinleşti, geri alınamaz.');
      if (o.status !== 'new' || !o.rejectionScheduledAt) throw conflict('no_pending_rejection', 'Bu sipariş için bekleyen bir ret yok.');
      await cancelJobs(tx, { dedupeKey: finalizeRejectionKey(o.id) });
      const [u] = await tx
        .update(orders)
        .set({
          rejectionScheduledAt: null,
          rejectionReason: null,
          rejectionNote: null,
          rejectionRequestedBy: null,
          version: o.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, o.id))
        .returning();
      await tx.insert(orderEvents).values({
        tenantId: auth.tenantId,
        orderId: o.id,
        type: 'rejection_undone',
        actorType: 'user',
        actorUserId: auth.userId,
      });
      await emitOrderUpdated(tx, { order: u!, change: 'rejection_undone' });
      await audit(tx, { ...auditActor(request), action: 'order.undo_reject', entityType: 'order', entityId: o.id });
      return u!;
    });
    return { order: await cardOf(app.db, order, auth.role) };
  });

  // POST /panel/orders/:id/advance {to} — FSM ilerletme (gel-alda "yolda" yok); mutfak yalnız preparing/ready
  app.post(
    '/orders/:id/advance',
    {
      ...readers,
      schema: { params: idParams, body: z.object({ to: z.enum(ADVANCE_TARGETS), version: z.number().int().min(1).optional() }), response: { 200: cardResponse } },
    },
    async (request) => {
      const auth = tenantAuth(request);
      const { to, version } = request.body;
      if (auth.role === 'kitchen' && to !== 'preparing' && to !== 'ready') throw forbidden('Mutfak yalnız hazırlık durumlarını değiştirebilir.');
      const now = new Date();
      const r = await app.db.transaction(async (tx) => {
        const o = await lockOrder(tx, auth, request.params.id);
        if (to === 'on_the_way' && o.fulfillmentType !== 'delivery') {
          throw conflict('invalid_transition', 'Gel-al siparişinde "Yolda" adımı yok.', { from: o.status, to });
        }
        const extra: Partial<typeof orders.$inferInsert> = {};
        if (to === 'delivered' && o.paymentStatus === 'unpaid') {
          extra.paymentStatus = 'paid';
          extra.paidAt = now;
        }
        const res = await transitionOrder(tx, {
          orderId: o.id,
          tenantId: auth.tenantId,
          to,
          actor: { type: 'user', userId: auth.userId },
          expectedVersion: version,
          extra,
          now,
        });
        if (res.changed) await audit(tx, { ...auditActor(request), action: `order.${to}`, entityType: 'order', entityId: o.id });
        return res;
      });
      return { order: await cardOf(app.db, r.order, auth.role) };
    },
  );

  // POST /panel/orders/:id/cancel {reason, note} — onay sonrası işletme iptali (04 §4.9)
  app.post(
    '/orders/:id/cancel',
    { ...staff, schema: { params: idParams, body: panelCancelRequestSchema, response: { 200: cardResponse } } },
    async (request) => {
      const auth = tenantAuth(request);
      const body = request.body;
      const r = await app.db.transaction(async (tx) => {
        const o = await lockOrder(tx, auth, request.params.id);
        if (o.status === 'new' || o.status === 'awaiting_customer') {
          throw conflict('invalid_transition', 'Yeni siparişi iptal etmek yerine reddedin.', { from: o.status });
        }
        const customerRequested = body.reason === 'customer_request';
        const res = await transitionOrder(tx, {
          orderId: o.id,
          tenantId: auth.tenantId,
          to: 'cancelled',
          actor: { type: 'user', userId: auth.userId },
          cancelledBy: customerRequested ? 'customer' : 'tenant',
          reason: body.reason,
          note: body.note,
          expectedVersion: body.version,
        });
        if (customerRequested) {
          await tx
            .update(cancellationRequests)
            .set({ status: 'approved', decidedByUserId: auth.userId, decidedAt: new Date() })
            .where(and(eq(cancellationRequests.orderId, o.id), eq(cancellationRequests.status, 'pending')));
        }
        await audit(tx, {
          ...auditActor(request),
          action: customerRequested ? 'order.cancel_customer_request' : 'order.cancel',
          entityType: 'order',
          entityId: o.id,
          data: { reason: body.reason },
        });
        return res;
      });
      return { order: await cardOf(app.db, r.order, auth.role) };
    },
  );

  // POST /panel/orders/:id/delay {extraMinutes} — gecikme bildirimi (≤2; bütçe dışı müşteri bilgisi)
  app.post(
    '/orders/:id/delay',
    { ...staff, schema: { params: idParams, body: delayOrderRequestSchema, response: { 200: cardResponse } } },
    async (request) => {
      const auth = tenantAuth(request);
      const extraMinutes = request.body.extraMinutes;
      const order = await app.db.transaction(async (tx) => {
        const o = await lockOrder(tx, auth, request.params.id);
        if (!['accepted', 'preparing', 'ready', 'on_the_way'].includes(o.status)) {
          throw conflict('invalid_transition', 'Gecikme yalnız onaylanmış siparişte bildirilebilir.');
        }
        if (o.delayNoticeCount >= MAX_DELAY_NOTICES) {
          throw conflict('delay_limit', 'Bu sipariş için en fazla 2 kez gecikme bildirilebilir. Müşteriyi arayın.');
        }
        const base = o.estimatedReadyAt && o.estimatedReadyAt.getTime() > Date.now() ? o.estimatedReadyAt : new Date();
        const newEta = new Date(base.getTime() + extraMinutes * 60_000);
        const [u] = await tx
          .update(orders)
          .set({
            estimatedReadyAt: newEta,
            etaMinutes: (o.etaMinutes ?? 0) + extraMinutes,
            delayNoticeCount: o.delayNoticeCount + 1,
            version: o.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, o.id))
          .returning();
        await tx.insert(orderEvents).values({
          tenantId: auth.tenantId,
          orderId: o.id,
          type: 'eta_updated',
          actorType: 'user',
          actorUserId: auth.userId,
          data: { extraMinutes, estimatedReadyAt: newEta.toISOString() },
        });
        await enqueueJob(tx, {
          queue: 'notify',
          type: 'order.notify_customer',
          tenantId: auth.tenantId,
          payload: { orderId: o.id, tenantId: auth.tenantId, event: 'delay', extraMinutes, estimatedReadyAt: newEta.toISOString() },
          dedupeKey: `notify_delay:${o.id}:${o.delayNoticeCount + 1}`,
        });
        await emitOrderUpdated(tx, { order: u!, change: 'eta' });
        await audit(tx, { ...auditActor(request), action: 'order.delay', entityType: 'order', entityId: o.id, data: { extraMinutes } });
        return u!;
      });
      return { order: await cardOf(app.db, order, auth.role) };
    },
  );

  // POST /panel/orders/:id/assign-courier {userId|null, onTheWay?}
  app.post(
    '/orders/:id/assign-courier',
    { ...staff, schema: { params: idParams, body: panelAssignCourierRequestSchema, response: { 200: cardResponse } } },
    async (request) => {
      const auth = tenantAuth(request);
      const { userId, onTheWay } = request.body;
      const order = await app.db.transaction(async (tx) => {
        const o = await lockOrder(tx, auth, request.params.id);
        if (FINAL_ORDER_STATUSES.includes(o.status as never) || o.status === 'awaiting_customer' || o.status === 'new') {
          throw conflict('invalid_transition', 'Kurye yalnız onaylanmış açık siparişe atanabilir.');
        }
        if (o.fulfillmentType !== 'delivery') throw conflict('invalid_transition', 'Gel-al siparişine kurye atanmaz.');
        if (userId) {
          const [m] = await tx
            .select({ id: memberships.id })
            .from(memberships)
            .where(
              and(
                eq(memberships.tenantId, auth.tenantId),
                eq(memberships.userId, userId),
                eq(memberships.role, 'courier'),
                isNull(memberships.disabledAt),
              ),
            );
          if (!m) throw notFound('Kurye bulunamadı.');
        }
        let current = o;
        if (o.courierUserId !== userId) {
          const [u] = await tx
            .update(orders)
            .set({ courierUserId: userId, version: o.version + 1, updatedAt: new Date() })
            .where(eq(orders.id, o.id))
            .returning();
          current = u!;
          await tx.insert(orderEvents).values({
            tenantId: auth.tenantId,
            orderId: o.id,
            type: 'courier_assigned',
            actorType: 'user',
            actorUserId: auth.userId,
            data: { courierUserId: userId },
          });
          await emitOrderUpdated(tx, { order: current, change: 'courier' });
          await audit(tx, { ...auditActor(request), action: 'order.assign_courier', entityType: 'order', entityId: o.id, data: { courierUserId: userId } });
        }
        if (onTheWay && current.status !== 'on_the_way') {
          const res = await transitionOrder(tx, {
            orderId: o.id,
            tenantId: auth.tenantId,
            to: 'on_the_way',
            actor: { type: 'user', userId: auth.userId },
          });
          current = res.order;
        }
        return current;
      });
      return { order: await cardOf(app.db, order, auth.role) };
    },
  );

  // POST /panel/orders/:id/verify — "Telefonla doğruladım": awaiting_customer → new (verification_method staff; audit)
  app.post('/orders/:id/verify', { ...staff, schema: { params: idParams, response: { 200: cardResponse } } }, async (request) => {
    const auth = tenantAuth(request);
    const r = await app.db.transaction(async (tx) => {
      const o = await lockOrder(tx, auth, request.params.id);
      if (o.status !== 'awaiting_customer') throw conflict('invalid_transition', 'Bu sipariş doğrulama beklemiyor.');
      const res = await transitionOrder(tx, {
        orderId: o.id,
        tenantId: auth.tenantId,
        to: 'new',
        actor: { type: 'user', userId: auth.userId },
        extra: { verificationMethod: 'staff', verifiedAt: new Date() },
      });
      await audit(tx, { ...auditActor(request), action: 'order.verify_by_phone', entityType: 'order', entityId: o.id });
      return res;
    });
    return { order: await cardOf(app.db, r.order, auth.role) };
  });

  // POST /panel/orders/:id/cancellation-request/:reqId/decide {approve}
  app.post(
    '/orders/:id/cancellation-request/:reqId/decide',
    { ...staff, schema: { params: decideParams, body: decideBody, response: { 200: cardResponse } } },
    async (request) => {
      const auth = tenantAuth(request);
      const order = await app.db.transaction(async (tx) => {
        const o = await lockOrder(tx, auth, request.params.id);
        const [req] = await tx
          .select()
          .from(cancellationRequests)
          .where(
            and(
              eq(cancellationRequests.id, request.params.reqId),
              eq(cancellationRequests.orderId, o.id),
              eq(cancellationRequests.tenantId, auth.tenantId),
            ),
          );
        if (!req) throw notFound('İptal talebi bulunamadı.');
        if (req.status !== 'pending') throw conflict('already_decided', 'Bu talep zaten yanıtlandı.');
        const decidedAt = new Date();
        if (request.body.approve) {
          const res = await transitionOrder(tx, {
            orderId: o.id,
            tenantId: auth.tenantId,
            to: 'cancelled',
            actor: { type: 'user', userId: auth.userId },
            cancelledBy: 'customer',
            reason: 'customer_request',
            note: req.reason,
          });
          await tx
            .update(cancellationRequests)
            .set({ status: 'approved', decidedByUserId: auth.userId, decidedAt })
            .where(eq(cancellationRequests.id, req.id));
          await audit(tx, { ...auditActor(request), action: 'order.cancel_request_approved', entityType: 'order', entityId: o.id });
          return res.order;
        }
        await tx
          .update(cancellationRequests)
          .set({ status: 'rejected', decidedByUserId: auth.userId, decidedAt })
          .where(eq(cancellationRequests.id, req.id));
        const [u] = await tx
          .update(orders)
          .set({ cancelRequestedAt: null, version: o.version + 1, updatedAt: decidedAt })
          .where(eq(orders.id, o.id))
          .returning();
        await tx.insert(orderEvents).values({
          tenantId: auth.tenantId,
          orderId: o.id,
          type: 'cancel_request_rejected',
          actorType: 'user',
          actorUserId: auth.userId,
        });
        await emitOrderUpdated(tx, { order: u!, change: 'cancel_request_rejected' });
        await audit(tx, { ...auditActor(request), action: 'order.cancel_request_rejected', entityType: 'order', entityId: o.id });
        return u!;
      });
      return { order: await cardOf(app.db, order, auth.role) };
    },
  );

  // GET /panel/orders/:id/receipt?type=kitchen|delivery&format=json|html&print=1 (04 §4.14)
  app.get('/orders/:id/receipt', { ...readers, schema: { params: idParams, querystring: receiptQuery } }, async (request, reply) => {
    const auth = tenantAuth(request);
    const q = request.query;
    if (auth.role === 'kitchen' && q.type !== 'kitchen') throw forbidden('Mutfak yalnız mutfak fişi yazdırabilir.');
    const order = await loadOrderFor(app.db, auth, request.params.id);
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, auth.tenantId));
    const [branch] = await app.db.select().from(branches).where(eq(branches.id, order.branchId));
    const printedBefore = await app.db
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.type, 'printed'), sql`${orderEvents.reason} = ${q.type}`))
      .limit(1);
    if (q.print === '1') {
      await app.db.insert(orderEvents).values({
        tenantId: auth.tenantId,
        orderId: order.id,
        type: 'printed',
        actorType: 'user',
        actorUserId: auth.userId,
        reason: q.type,
      });
    }
    const items = (await loadItems(app.db, [order.id])).get(order.id) ?? [];
    // "WhatsApp'tan sipariş verin" satırı için şubenin bağlı numarası
    const [wa] = await app.db
      .select({ displayPhone: waAccounts.displayPhone })
      .from(waAccounts)
      .where(and(eq(waAccounts.tenantId, auth.tenantId), eq(waAccounts.branchId, order.branchId), eq(waAccounts.status, 'connected')))
      .limit(1);
    const receipt = buildReceipt({
      type: q.type,
      order,
      items,
      business: { name: tenant!.name, branchName: branch?.name ?? null, phone: branch?.phone ?? tenant!.phone, timezone: branch?.timezone },
      copy: printedBefore.length > 0,
      trackingUrl: trackingUrl(app.config.APP_BASE_URL, order.id, app.config.TRACKING_SECRET),
      settings: branch?.receiptSettings,
      waPhone: wa?.displayPhone ?? null,
    });
    reply.header('cache-control', 'no-store');
    if (q.format === 'html') {
      // Genişlik: sorgu parametresi (58/80) ya da şubenin fiş ayarı
      const width = q.width === '58' ? 58 : q.width === '80' ? 80 : receipt.layout.widthMm;
      reply.type('text/html; charset=utf-8');
      return renderReceiptHtml(receipt, width);
    }
    return receipt;
  });
};

export default routes;

