// Müşteriler / CRM (04 §8) ve KVKK talepleri (08 §2.10): liste (maskeli telefon), profil, not/kara liste,
// sipariş geçmişi, veri dışa aktarma ve silme/anonimleştirme. Test siparişleri hariç.

import { maskPhone, turkishLower, type FulfillmentType, type PaymentMethod } from '@siparis/core';
import type { CustomerDetail, CustomerListItem, CustomerOrderItem, CustomerPatch } from '@siparis/core/settings/contracts';
import {
  cancellationRequests,
  conversations,
  customerAddresses,
  customerErasures,
  customers,
  messages,
  orderEvents,
  orderItemOptions,
  orderItems,
  orders,
  otpVerifications,
  reviews,
  storefrontLinkTokens,
  tenants,
  type Database,
} from '@siparis/db';
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQLWrapper } from 'drizzle-orm';
import { audit } from '../../lib/audit';
import { AppError, conflict, notFound } from '../../lib/errors';
import { isoOrNull, validationError } from '../settings/common';

type CustomerRow = typeof customers.$inferSelect;

export const ERASED_CUSTOMER_NAME = 'Silinmiş müşteri';
export const ANONYMOUS_ORDER_NAME = 'Anonim müşteri';
const OPEN_STATUSES = ['awaiting_customer', 'new', 'accepted', 'preparing', 'ready', 'on_the_way'] as const;

/** Sayfalama imleci: [grup (0 = siparişi olan, 1 = olmayan)] | an (mikrosaniye hassasiyetli UTC metin) | id */
function encodeCursor(at: string, id: string, group = 0): string {
  return Buffer.from(`${group}|${at}|${id}`).toString('base64url');
}

const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function decodeCursor(cursor: string | undefined): { group: number; at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [g, at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!id || !at || (g !== '0' && g !== '1') || !CURSOR_TS.test(at) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { group: Number(g), at, id };
  } catch {
    return null;
  }
}

/** timestamptz → mikrosaniyeli UTC metin (JS Date milisaniyede keser; imleçte kayıp olmasın). */
const tsText = (col: SQLWrapper | string) =>
  sql<string>`to_char(${typeof col === 'string' ? sql.raw(col) : col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

type ListRow = {
  id: string;
  name: string | null;
  phone_e164: string | null;
  wa_bsuid: string | null;
  is_blocked: boolean;
  notes: string | null;
  order_count: number;
  last_order_at: Date | string | null;
  sort_at: string;
  grp: number | string;
  total: string | number | null;
  delivered: string | number | null;
};

const toDate = (v: Date | string | null): Date | null => (v == null ? null : v instanceof Date ? v : new Date(v));

export async function listCustomers(
  db: Database,
  tenantId: string,
  opts: { q?: string; cursor?: string; limit?: number },
): Promise<{ items: CustomerListItem[]; nextCursor?: string }> {
  const limit = opts.limit ?? 30;
  const conds = [sql`c.tenant_id = ${tenantId}`, sql`not exists (select 1 from customer_erasures e where e.customer_id = c.id)`];
  const q = opts.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    const parts = [sql`c.name ilike ${`%${escapeLike(q)}%`}`, sql`lower(c.name) like ${`%${escapeLike(turkishLower(q))}%`}`];
    if (digits.length >= 3) {
      const d = digits.replace(/^0+/, '').replace(/^90(?=5)/, '');
      parts.push(sql`c.phone_e164 like ${`%${escapeLike(d)}%`}`);
    }
    conds.push(sql`(${sql.join(parts, sql` or `)})`);
  }
  const cur = decodeCursor(opts.cursor);
  if (cur) {
    conds.push(sql`(
      (case when c.last_order_at is null then 1 else 0 end) > ${cur.group}
      or ((case when c.last_order_at is null then 1 else 0 end) = ${cur.group}
          and (coalesce(c.last_order_at, c.created_at), c.id) < (${cur.at}::timestamptz, ${cur.id}::uuid)))`);
  }

  // Siparişi olanlar son siparişe göre önce, sonra yeni kayıtlar
  const rows = (await db.execute<ListRow>(sql`
    select c.id, c.name, c.phone_e164, c.wa_bsuid, c.is_blocked, c.notes, c.order_count, c.last_order_at,
           (case when c.last_order_at is null then 1 else 0 end) as grp,
           ${tsText('coalesce(c.last_order_at, c.created_at)')} as sort_at,
           s.total, s.delivered
      from customers c
      left join lateral (
        select sum(o.total_kurus) as total, count(*) as delivered
          from orders o
         where o.tenant_id = c.tenant_id and o.customer_id = c.id and o.status = 'delivered' and o.test_kind is null
      ) s on true
     where ${sql.join(conds, sql` and `)}
     order by grp, sort_at desc, c.id desc
     limit ${limit + 1}`)) as unknown as ListRow[];

  const page = rows.slice(0, limit);
  const items = page.map((r) => {
    const total = Number(r.total ?? 0);
    const delivered = Number(r.delivered ?? 0);
    return {
      id: r.id,
      name: r.name,
      phoneMasked: r.phone_e164 ? maskPhone(r.phone_e164) : null,
      orderCount: Number(r.order_count ?? 0),
      lastOrderAt: isoOrNull(toDate(r.last_order_at)),
      totalSpentKurus: total,
      avgBasketKurus: delivered ? Math.round(total / delivered) : 0,
      isBlocked: r.is_blocked,
      hasNotes: Boolean(r.notes),
      hasWhatsapp: Boolean(r.wa_bsuid),
    };
  });
  const last = page[page.length - 1];
  return rows.length > limit && last ? { items, nextCursor: encodeCursor(last.sort_at, last.id, Number(last.grp)) } : { items };
}

/** Tenant kapsamlı müşteri; anonimleştirilmiş ya da başka tenant'ın → 404. */
export async function findCustomer(db: Database, tenantId: string, id: string): Promise<CustomerRow> {
  const [row] = await db
    .select({ c: customers, erased: customerErasures.customerId })
    .from(customers)
    .leftJoin(customerErasures, eq(customerErasures.customerId, customers.id))
    .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)));
  if (!row || row.erased) throw notFound('Müşteri bulunamadı.');
  return row.c;
}

function mode<T extends string>(values: (T | null)[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
}

export async function customerDetail(db: Database, c: CustomerRow): Promise<CustomerDetail> {
  const own = and(eq(orders.tenantId, c.tenantId), eq(orders.customerId, c.id), isNull(orders.testKind));
  const rows = await db
    .select({ status: orders.status, totalKurus: orders.totalKurus, placedAt: orders.placedAt, fulfillmentType: orders.fulfillmentType, paymentMethod: orders.paymentMethod })
    .from(orders)
    .where(own);
  const delivered = rows.filter((r) => r.status === 'delivered');
  const total = delivered.reduce((s, r) => s + r.totalKurus, 0);
  const times = rows.map((r) => r.placedAt.getTime());
  const top = await db
    .select({ name: orderItems.name, quantity: sql<number>`sum(${orderItems.quantity})::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(own, inArray(orders.status, ['delivered', 'accepted', 'preparing', 'ready', 'on_the_way'])))
    .groupBy(orderItems.name)
    .orderBy(desc(sql`sum(${orderItems.quantity})`), asc(orderItems.name))
    .limit(3);
  const addresses = await db
    .select()
    .from(customerAddresses)
    .where(and(eq(customerAddresses.tenantId, c.tenantId), eq(customerAddresses.customerId, c.id)))
    .orderBy(desc(sql`coalesce(${customerAddresses.lastUsedAt}, ${customerAddresses.createdAt})`));
  return {
    id: c.id,
    name: c.name ?? null,
    phone: c.phoneE164 ?? null,
    phoneMasked: c.phoneE164 ? maskPhone(c.phoneE164) : null,
    waUsername: c.waUsername ?? null,
    hasWhatsapp: Boolean(c.waBsuid),
    notes: c.notes ?? null,
    isBlocked: c.isBlocked,
    orderCount: rows.length ? rows.filter((r) => r.status !== 'awaiting_customer').length : c.orderCount,
    firstOrderAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastOrderAt: times.length ? new Date(Math.max(...times)).toISOString() : isoOrNull(c.lastOrderAt),
    totalSpentKurus: total,
    avgBasketKurus: delivered.length ? Math.round(total / delivered.length) : 0,
    preferredFulfillment: mode<FulfillmentType>(delivered.map((r) => r.fulfillmentType)),
    preferredPaymentMethod: mode<PaymentMethod>(delivered.map((r) => r.paymentMethod)),
    topProducts: top.map((t) => ({ name: t.name, quantity: Number(t.quantity) })),
    addresses: addresses.map((a) => ({
      id: a.id,
      label: a.label ?? null,
      neighborhood: a.neighborhood ?? null,
      addressLine: a.addressLine ?? null,
      directions: a.directions ?? null,
      lastUsedAt: isoOrNull(a.lastUsedAt),
    })),
    openOrderCount: rows.filter((r) => (OPEN_STATUSES as readonly string[]).includes(r.status)).length,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function patchCustomer(tx: Database, c: CustomerRow, body: CustomerPatch): Promise<{ row: CustomerRow; changes: Record<string, unknown> }> {
  const patch: Partial<typeof customers.$inferInsert> = {};
  const changes: Record<string, unknown> = {};
  if (body.notes !== undefined) {
    const notes = body.notes ? body.notes : null;
    if (notes !== c.notes) {
      patch.notes = notes;
      changes.notes = true;
    }
  }
  if (body.isBlocked !== undefined && body.isBlocked !== c.isBlocked) {
    if (body.isBlocked && !body.blockReason) throw validationError('Kara liste sebebini yazın.', 'blockReason');
    patch.isBlocked = body.isBlocked;
    changes.isBlocked = body.isBlocked;
    if (body.blockReason) changes.blockReason = body.blockReason;
  }
  if (!Object.keys(patch).length) return { row: c, changes };
  const [row] = await tx
    .update(customers)
    .set({ ...patch, version: c.version + 1 })
    .where(eq(customers.id, c.id))
    .returning();
  return { row: row!, changes };
}

export async function customerOrders(
  db: Database,
  c: CustomerRow,
  opts: { cursor?: string; limit?: number },
): Promise<{ items: CustomerOrderItem[]; nextCursor?: string }> {
  const limit = opts.limit ?? 20;
  const conds = [eq(orders.tenantId, c.tenantId), eq(orders.customerId, c.id), isNull(orders.testKind)];
  const cur = decodeCursor(opts.cursor);
  if (cur) conds.push(sql`(${orders.placedAt}, ${orders.id}) < (${cur.at}::timestamptz, ${cur.id}::uuid)`);
  const rows = (
    await db
      .select({ o: orders, placedAtText: tsText(orders.placedAt) })
      .from(orders)
      .where(and(...conds))
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(limit + 1)
  ).map((r) => ({ ...r.o, placedAtText: r.placedAtText }));
  const page = rows.slice(0, limit);
  const items = page.length
    ? await db
        .select({ orderId: orderItems.orderId, name: orderItems.name, quantity: orderItems.quantity })
        .from(orderItems)
        .where(inArray(orderItems.orderId, page.map((o) => o.id)))
        .orderBy(asc(orderItems.sort))
    : [];
  const out = page.map((o) => {
    const its = items.filter((i) => i.orderId === o.id);
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      channel: o.channel,
      fulfillmentType: o.fulfillmentType,
      totalKurus: o.totalKurus,
      itemCount: its.reduce((s, i) => s + i.quantity, 0),
      placedAt: o.placedAt.toISOString(),
      items: its.map((i) => ({ name: i.name, quantity: i.quantity })),
    };
  });
  const last = page[page.length - 1];
  return rows.length > limit && last ? { items: out, nextCursor: encodeCursor(last.placedAtText, last.id) } : { items: out };
}

/**
 * KVKK kapsamındaki siparişler: bu müşteri kaydına bağlı olanlar + aynı telefonla verilmiş olanlar. Akış A/B'de sipariş
 * WhatsApp kimliğiyle (BSUID) açılmış ayrı bir müşteri kaydına bağlanabilir; kişinin telefonu siparişte kalır.
 */
function subjectOrdersWhere(c: CustomerRow) {
  const byRecord = eq(orders.customerId, c.id);
  return and(eq(orders.tenantId, c.tenantId), c.phoneE164 ? or(byRecord, eq(orders.customerPhone, c.phoneE164)) : byRecord);
}

/** KVKK dışa aktarma (08 §2.10): kimlik, iletişim, adresler, siparişler, değerlendirmeler, mesajlar. */
export async function exportCustomer(db: Database, c: CustomerRow) {
  const [tenant] = await db.select({ name: tenants.name, legalName: tenants.legalName }).from(tenants).where(eq(tenants.id, c.tenantId));
  const addresses = await db.select().from(customerAddresses).where(and(eq(customerAddresses.tenantId, c.tenantId), eq(customerAddresses.customerId, c.id)));
  const orderRows = await db
    .select()
    .from(orders)
    .where(and(subjectOrdersWhere(c), isNull(orders.testKind)))
    .orderBy(asc(orders.placedAt));
  const ids = orderRows.map((o) => o.id);
  const itemRows = ids.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids)).orderBy(asc(orderItems.sort)) : [];
  const optRows = itemRows.length
    ? await db.select().from(orderItemOptions).where(inArray(orderItemOptions.orderItemId, itemRows.map((i) => i.id)))
    : [];
  const reviewRows = ids.length ? await db.select().from(reviews).where(and(eq(reviews.tenantId, c.tenantId), inArray(reviews.orderId, ids))) : [];
  const convRows = await db.select().from(conversations).where(and(eq(conversations.tenantId, c.tenantId), eq(conversations.customerId, c.id)));
  const msgRows = convRows.length
    ? await db
        .select({ conversationId: messages.conversationId, direction: messages.direction, kind: messages.kind, body: messages.body, createdAt: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.tenantId, c.tenantId), inArray(messages.conversationId, convRows.map((x) => x.id))))
        .orderBy(asc(messages.createdAt))
        .limit(5000)
    : [];
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  return {
    format: 'siparisinonunde.kvkk_export.v1',
    exportedAt: new Date().toISOString(),
    controller: { name: tenant?.name ?? null, legalName: tenant?.legalName ?? null },
    customer: {
      id: c.id,
      name: c.name ?? null,
      phone: c.phoneE164 ?? null,
      whatsappUsername: c.waUsername ?? null,
      whatsappLinked: Boolean(c.waBsuid),
      notes: c.notes ?? null,
      isBlocked: c.isBlocked,
      orderCount: c.orderCount,
      firstSeenAt: c.createdAt.toISOString(),
      lastOrderAt: iso(c.lastOrderAt),
    },
    addresses: addresses.map((a) => ({
      label: a.label,
      neighborhood: a.neighborhood,
      addressLine: a.addressLine,
      directions: a.directions,
      lat: a.lat,
      lng: a.lng,
      lastUsedAt: iso(a.lastUsedAt),
    })),
    orders: orderRows.map((o) => ({
      number: o.number,
      status: o.status,
      channel: o.channel,
      fulfillmentType: o.fulfillmentType,
      placedAt: o.placedAt.toISOString(),
      deliveredAt: iso(o.deliveredAt),
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      neighborhood: o.neighborhood,
      addressLine: o.addressLine,
      directions: o.directions,
      note: o.note,
      paymentMethod: o.paymentMethod,
      subtotalKurus: o.subtotalKurus,
      deliveryFeeKurus: o.deliveryFeeKurus,
      discountKurus: o.discountKurus,
      totalKurus: o.totalKurus,
      items: itemRows
        .filter((i) => i.orderId === o.id)
        .map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unitPriceKurus: i.unitPriceKurus,
          lineTotalKurus: i.lineTotalKurus,
          note: i.note,
          options: optRows.filter((x) => x.orderItemId === i.id).map((x) => ({ group: x.groupName, option: x.optionName, priceDeltaKurus: x.priceDeltaKurus })),
        })),
    })),
    reviews: reviewRows.map((r) => ({ orderNumber: orderRows.find((o) => o.id === r.orderId)?.number ?? null, rating: r.rating, comment: r.comment, createdAt: r.createdAt.toISOString() })),
    messages: msgRows.map((m) => ({ direction: m.direction, kind: m.kind, body: m.body, createdAt: m.createdAt.toISOString() })),
  };
}

/**
 * KVKK silme/anonimleştirme (08 §2.10, §2.8): açık siparişi varsa 409. Müşteri kimlik/iletişim alanları, adresler,
 * sohbet içerikleri silinir; siparişlerde ad/telefon/adres anonimleşir, tutarlar (mali kayıt) korunur.
 * `actorUserId` null = sistem (saklama işi, retention.customer_inactive); `customer_erasures.erased_by_user_id` boş kalır.
 */
export async function eraseCustomer(
  tx: Database,
  c: CustomerRow,
  actorUserId: string | null,
): Promise<{ orderCount: number; messageCount: number }> {
  const [open] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(subjectOrdersWhere(c), inArray(orders.status, [...OPEN_STATUSES])));
  if (Number(open?.n ?? 0) > 0) {
    throw conflict('open_orders', 'Müşterinin açık siparişi var. Sipariş tamamlanınca tekrar deneyin.');
  }
  await tx
    .update(customers)
    .set({ name: ERASED_CUSTOMER_NAME, phoneE164: null, waBsuid: null, waUsername: null, notes: null, isBlocked: false, lastInboundAt: null, version: c.version + 1 })
    .where(eq(customers.id, c.id));
  await tx.delete(customerAddresses).where(and(eq(customerAddresses.tenantId, c.tenantId), eq(customerAddresses.customerId, c.id)));
  const anonymized = await tx
    .update(orders)
    .set({
      customerName: ANONYMOUS_ORDER_NAME,
      customerPhone: null,
      addressLine: null,
      directions: null,
      lat: null,
      lng: null,
      note: null,
      cancelNote: null,
      confirmationIp: null,
      confirmationUserAgent: null,
    })
    .where(subjectOrdersWhere(c))
    .returning({ id: orders.id });
  const orderIds = anonymized.map((o) => o.id);
  if (orderIds.length) {
    await tx.update(reviews).set({ comment: null }).where(and(eq(reviews.tenantId, c.tenantId), inArray(reviews.orderId, orderIds)));
    await tx.delete(otpVerifications).where(and(eq(otpVerifications.tenantId, c.tenantId), inArray(otpVerifications.orderId, orderIds)));
    // Müşterinin yazdığı serbest metinler (ürün notu, iptal gerekçesi, zaman çizelgesindeki müşteri notları)
    await tx.update(orderItems).set({ note: null }).where(and(eq(orderItems.tenantId, c.tenantId), inArray(orderItems.orderId, orderIds)));
    await tx
      .update(cancellationRequests)
      .set({ reason: null })
      .where(and(eq(cancellationRequests.tenantId, c.tenantId), inArray(cancellationRequests.orderId, orderIds)));
    await tx
      .update(orderEvents)
      .set({ note: null })
      .where(and(eq(orderEvents.tenantId, c.tenantId), inArray(orderEvents.orderId, orderIds), eq(orderEvents.actorType, 'customer')));
  }
  const convs = await tx.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.tenantId, c.tenantId), eq(conversations.customerId, c.id)));
  let messageCount = 0;
  if (convs.length) {
    const cleared = await tx
      .update(messages)
      .set({ body: null, payload: null })
      .where(and(eq(messages.tenantId, c.tenantId), inArray(messages.conversationId, convs.map((x) => x.id))))
      .returning({ id: messages.id });
    messageCount = cleared.length;
    // Sohbet satırı (bot durumu, sayaçlar) kalır; son mesaj önizlemesi de içeriktir → silinir. Panel sohbet listesi
    // silinmiş müşterinin sohbetini göstermez (routes/panel/conversations.ts).
    await tx
      .update(conversations)
      .set({ lastMessagePreview: null, unreadCount: 0, updatedAt: new Date() })
      .where(and(eq(conversations.tenantId, c.tenantId), inArray(conversations.id, convs.map((x) => x.id))));
  }
  await tx.delete(storefrontLinkTokens).where(and(eq(storefrontLinkTokens.tenantId, c.tenantId), eq(storefrontLinkTokens.customerId, c.id)));
  await forgetSharedRoute(tx, c);
  await tx.insert(customerErasures).values({ customerId: c.id, tenantId: c.tenantId, erasedByUserId: actorUserId });
  return { orderCount: orderIds.length, messageCount };
}

/**
 * Ortak numara (00 §12a madde 8): silinen müşterinin yönlendirme kaydından bu işletme çıkarılır (güncel dükkan ve son
 * dükkanlar). Kayıtta başka dükkan kalmazsa kayıt da silinir. Diğer işletmelerin verisine dokunulmaz.
 */
async function forgetSharedRoute(tx: Database, c: CustomerRow): Promise<void> {
  if (!c.waBsuid && !c.phoneE164) return;
  const key = c.waBsuid && c.phoneE164
    ? sql`(wa_bsuid = ${c.waBsuid} or phone_e164 = ${c.phoneE164})`
    : c.waBsuid
      ? sql`wa_bsuid = ${c.waBsuid}`
      : sql`phone_e164 = ${c.phoneE164}`;
  await tx.execute(sql`
    update shared_wa_routes
       set recent_tenant_ids = array_remove(recent_tenant_ids, ${c.tenantId}::uuid),
           current_tenant_id = case when current_tenant_id = ${c.tenantId}::uuid then null else current_tenant_id end,
           last_routed_at = case when current_tenant_id = ${c.tenantId}::uuid then null else last_routed_at end,
           updated_at = now()
     where ${key}`);
  await tx.execute(sql`delete from shared_wa_routes where ${key} and current_tenant_id is null and cardinality(recent_tenant_ids) = 0`);
}

// ---------------------------------------------------------------------------
// Hareketsiz müşteri anonimleştirme (08 §2.8 satır 6, retention.customer_inactive)

/**
 * Hareketsizlik süresi (ay). 08 §2.8 satır 6'daki işletme ayarı (6–24 ay arası kısaltma) için henüz tenant kolonu yok;
 * ayar eklenince süre buradan değil tenant ayarından okunur.
 */
export const CUSTOMER_INACTIVE_MONTHS = 24;

/**
 * Hareketsiz müşteri koşulu (`c` = customers). Son etkinlik = kayıt, son sipariş (müşteri kaydındaki `last_order_at` ve
 * KVKK kapsamındaki siparişlerin `created_at`'i: bu kayda bağlı ya da aynı telefonla verilmiş) ve son gelen mesaj
 * (müşteri ve sohbet `last_inbound_at`) anlarının en büyüğü. Silinmiş müşteri ve açık (final olmayan) siparişi olan
 * müşteri hariç. Telefon eşleşmesi ayrı NOT EXISTS: planlayıcı iki koşulu da hash anti-join ile çözebilir.
 */
function inactiveCustomerWhere(months: number) {
  const cutoff = sql`now() - make_interval(months => ${months})`;
  const open = sql.raw(OPEN_STATUSES.map((s) => `'${s}'`).join(', '));
  return sql`not exists (select 1 from customer_erasures e where e.customer_id = c.id)
    and greatest(c.created_at, c.last_order_at, c.last_inbound_at) < ${cutoff}
    and not exists (
      select 1 from orders o
       where o.tenant_id = c.tenant_id and o.customer_id = c.id
         and (o.created_at >= ${cutoff} or o.status in (${open})))
    and (c.phone_e164 is null or not exists (
      select 1 from orders o
       where o.tenant_id = c.tenant_id and o.customer_phone = c.phone_e164
         and (o.created_at >= ${cutoff} or o.status in (${open}))))
    and not exists (
      select 1 from conversations v
       where v.tenant_id = c.tenant_id and v.customer_id = c.id and v.last_inbound_at >= ${cutoff})`;
}

/** Anonimleştirilecek müşterisi olan tenant'lar. */
export async function tenantsWithInactiveCustomers(db: Database, months = CUSTOMER_INACTIVE_MONTHS): Promise<string[]> {
  const rows = (await db.execute<{ tenant_id: string }>(
    sql`select distinct c.tenant_id from customers c where ${inactiveCustomerWhere(months)} order by c.tenant_id`,
  )) as unknown as { tenant_id: string }[];
  return rows.map((r) => r.tenant_id);
}

/** Tenant'ın hareketsiz müşterileri (id sırasıyla, `afterId`'den sonra; sayfa sayfa). */
export async function inactiveCustomerIds(
  db: Database,
  tenantId: string,
  opts: { months?: number; afterId?: string | null; limit?: number } = {},
): Promise<string[]> {
  const after = opts.afterId ? sql`and c.id > ${opts.afterId}::uuid` : sql``;
  const rows = (await db.execute<{ id: string }>(sql`
    select c.id from customers c
     where c.tenant_id = ${tenantId} ${after} and ${inactiveCustomerWhere(opts.months ?? CUSTOMER_INACTIVE_MONTHS)}
     order by c.id
     limit ${opts.limit ?? 200}`)) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * Tek hareketsiz müşteriyi elle silmeyle aynı anlamda anonimleştirir (eraseCustomer, aktör sistem) ve `customer.erase`
 * denetim kaydı yazar. Satır kilitlenir ve koşul yeniden denetlenir: bu arada silinen, yeniden etkinleşen ya da açık
 * siparişi olan müşteri atlanır ('skipped').
 */
export async function eraseInactiveCustomer(
  db: Database,
  tenantId: string,
  customerId: string,
  months = CUSTOMER_INACTIVE_MONTHS,
): Promise<'erased' | 'skipped'> {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
      .for('update');
    if (!c) return 'skipped';
    const still = (await tx.execute(
      sql`select 1 from customers c where c.id = ${customerId} and ${inactiveCustomerWhere(months)}`,
    )) as unknown as unknown[];
    if (!still.length) return 'skipped';
    let r: { orderCount: number; messageCount: number };
    try {
      r = await eraseCustomer(tx, c, null);
    } catch (err) {
      // Açık sipariş denetimi yazmadan önce yapılır: atlamak güvenli
      if (err instanceof AppError && err.code === 'open_orders') return 'skipped';
      throw err;
    }
    await audit(tx, {
      tenantId,
      actorUserId: null,
      action: 'customer.erase',
      entityType: 'customer',
      entityId: c.id,
      data: { ...r, actorType: 'system', job: 'retention.customer_inactive', inactiveMonths: months },
    });
    return 'erased';
  });
}
