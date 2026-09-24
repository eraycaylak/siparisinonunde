// Sipariş kaydı (storefront Akış A/B ve telefon siparişi Akış E ortak): müşteri upsert, adres kaydı,
// sipariş + kalem snapshot'ları + numara + recordOrderCreated — hepsi çağıranın transaction'ında.

import type {
  FulfillmentType,
  MealCardBrand,
  OrderChannel,
  OrderStatus,
  PaymentMethod,
  QuoteResult,
  TestKind,
  VerificationMethod,
} from '@siparis/core';
import { customerAddresses, customers, orderItemOptions, orderItems, orders, type Database } from '@siparis/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { OrderRow } from './summary';
import { createOrderNumber, recordOrderCreated, type TransitionActor } from './transition';

export type CustomerRow = typeof customers.$inferSelect;

/** (tenant, telefon) ile müşteri bulur ya da oluşturur; mevcut ad korunur (yalnız boşsa doldurulur). */
export async function upsertCustomerByPhone(tx: Database, tenantId: string, phoneE164: string, name: string | null): Promise<CustomerRow> {
  const rows = (await tx.execute(sql`
    insert into customers (tenant_id, phone_e164, name)
    values (${tenantId}::uuid, ${phoneE164}, ${name})
    on conflict (tenant_id, phone_e164) where phone_e164 is not null
    do update set name = coalesce(customers.name, excluded.name), updated_at = now()
    returning id`)) as unknown as { id: string }[];
  const id = rows[0]!.id;
  const [c] = await tx.select().from(customers).where(eq(customers.id, id));
  return c!;
}

/**
 * Akış A: token'daki müşteriyi kullanır. Telefonu yoksa ve numara başka bir kayıtta değilse telefonu işler;
 * adı boşsa doldurur. Numara başka kayıttaysa o kayda dokunulmaz (birleştirme dilim 3'ün işi).
 */
export async function attachCustomerFromLink(
  tx: Database,
  tenantId: string,
  customerId: string,
  phoneE164: string,
  name: string | null,
): Promise<CustomerRow | undefined> {
  const [c] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
  if (!c) return undefined;
  const patch: Partial<typeof customers.$inferInsert> = {};
  if (!c.name && name) patch.name = name;
  if (!c.phoneE164) {
    const [other] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.phoneE164, phoneE164)));
    if (!other) patch.phoneE164 = phoneE164;
  }
  if (Object.keys(patch).length) {
    const [u] = await tx.update(customers).set(patch).where(eq(customers.id, c.id)).returning();
    return u;
  }
  return c;
}

/** Adres kaydı: aynı mahalle + adres satırı varsa son kullanım güncellenir, yoksa eklenir (en çok 5 tutulur). */
export async function rememberAddress(
  tx: Database,
  input: {
    tenantId: string;
    customerId: string;
    neighborhood: string | null;
    addressLine: string | null;
    directions: string | null;
    lat?: number | null;
    lng?: number | null;
  },
): Promise<void> {
  if (!input.addressLine && !input.neighborhood) return;
  const existing = await tx
    .select()
    .from(customerAddresses)
    .where(and(eq(customerAddresses.tenantId, input.tenantId), eq(customerAddresses.customerId, input.customerId)))
    .orderBy(desc(customerAddresses.lastUsedAt));
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
  const same = existing.find((a) => norm(a.neighborhood) === norm(input.neighborhood) && norm(a.addressLine) === norm(input.addressLine));
  const now = new Date();
  if (same) {
    await tx
      .update(customerAddresses)
      .set({
        lastUsedAt: now,
        directions: input.directions ?? same.directions,
        lat: input.lat ?? same.lat,
        lng: input.lng ?? same.lng,
      })
      .where(eq(customerAddresses.id, same.id));
    return;
  }
  await tx.insert(customerAddresses).values({
    tenantId: input.tenantId,
    customerId: input.customerId,
    label: existing.length ? null : 'Ev',
    neighborhood: input.neighborhood,
    addressLine: input.addressLine,
    directions: input.directions,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    lastUsedAt: now,
  });
  // En çok 5 adres (03 §5.5): en eski kullanılanlar silinir
  if (existing.length >= 5) {
    const drop = existing.slice(4).map((a) => a.id);
    for (const id of drop) await tx.delete(customerAddresses).where(eq(customerAddresses.id, id));
  }
}

export interface InsertOrderInput {
  tenantId: string;
  branchId: string;
  status: Extract<OrderStatus, 'new' | 'awaiting_customer'>;
  channel: OrderChannel;
  fulfillmentType: FulfillmentType;
  quote: QuoteResult;
  zone: { id: string; name: string } | null;
  neighborhood: string | null;
  addressLine: string | null;
  directions: string | null;
  lat: number | null;
  lng: number | null;
  outOfZoneOverride?: boolean;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  paymentMethod: PaymentMethod;
  mealCardBrand: MealCardBrand | null;
  changeForKurus: number | null;
  wantsCutlery: boolean;
  note: string | null;
  verificationMethod: VerificationMethod | null;
  verifiedAt: Date | null;
  conversationId?: string | null;
  linkTokenId?: string | null;
  idempotencyKey?: string | null;
  confirmationIp?: string | null;
  confirmationUserAgent?: string | null;
  sourceMeta?: Record<string, unknown> | null;
  statusNotifyChannel: 'whatsapp' | 'sms' | 'none';
  createdByUserId?: string | null;
  testKind?: TestKind | null;
}

/** Sipariş + kalemler + seçenek snapshot'ları + numara; ardından recordOrderCreated (olaylar ve kancalar). */
export async function insertOrderWithItems(tx: Database, input: InsertOrderInput, actor: TransitionActor): Promise<OrderRow> {
  const q = input.quote;
  const number = await createOrderNumber(tx, input.tenantId);
  const [order] = await tx
    .insert(orders)
    .values({
      tenantId: input.tenantId,
      branchId: input.branchId,
      number,
      status: input.status,
      channel: input.channel,
      fulfillmentType: input.fulfillmentType,
      testKind: input.testKind ?? null,
      customerId: input.customerId,
      conversationId: input.conversationId ?? null,
      linkTokenId: input.linkTokenId ?? null,
      verificationMethod: input.verificationMethod,
      verifiedAt: input.verifiedAt,
      statusNotifyChannel: input.statusNotifyChannel,
      zoneId: input.zone?.id ?? null,
      zoneName: input.zone?.name ?? null,
      neighborhood: input.neighborhood,
      addressLine: input.addressLine,
      directions: input.directions,
      lat: input.lat,
      lng: input.lng,
      outOfZoneOverride: input.outOfZoneOverride ?? false,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      subtotalKurus: q.subtotalKurus,
      deliveryFeeKurus: q.deliveryFeeKurus,
      totalKurus: q.totalKurus,
      minOrderKurus: q.minOrderKurus,
      paymentMethod: input.paymentMethod,
      mealCardBrand: input.mealCardBrand,
      changeForKurus: input.changeForKurus,
      wantsCutlery: input.wantsCutlery,
      note: input.note,
      idempotencyKey: input.idempotencyKey ?? null,
      confirmationIp: input.confirmationIp ?? null,
      confirmationUserAgent: input.confirmationUserAgent?.slice(0, 300) ?? null,
      sourceMeta: input.sourceMeta ?? null,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning();
  const o = order!;

  let sort = 0;
  for (const line of q.lines) {
    const [item] = await tx
      .insert(orderItems)
      .values({
        tenantId: input.tenantId,
        orderId: o.id,
        productId: line.productId,
        name: line.name,
        categoryName: line.categoryName,
        unitPriceKurus: line.unitPriceKurus,
        optionsUnitKurus: line.optionsUnitKurus,
        quantity: line.quantity,
        lineTotalKurus: line.lineTotalKurus,
        note: line.note,
        sort: sort++,
      })
      .returning({ id: orderItems.id });
    if (line.options.length) {
      await tx.insert(orderItemOptions).values(
        line.options.map((opt) => ({
          tenantId: input.tenantId,
          orderItemId: item!.id,
          optionId: opt.optionId,
          groupName: opt.groupName,
          optionName: opt.optionName,
          priceDeltaKurus: opt.priceDeltaKurus,
        })),
      );
    }
  }

  await recordOrderCreated(tx, { order: o, actor });
  return o;
}
