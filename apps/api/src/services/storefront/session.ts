// Storefront oturumu (14 §6.2 POST /store/:slug/session): Akış A link token'ı ve "Son siparişin" kartı (03 §3.4).

import { maskPhone } from '@siparis/core';
import type { StoreSessionView } from '@siparis/core/menu/contracts';
import { customers, options, orderItemOptions, orderItems, orders, products, storefrontLinkTokens, type Database } from '@siparis/db';
import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { sha256Hex } from '../../lib/tokens';

export type LinkTokenRow = typeof storefrontLinkTokens.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;

/** Ham token → aynı tenant'ta süresi geçmemiş kayıt (yoksa null). */
export async function findValidLinkToken(db: Database, tenantId: string, rawToken: string, now: Date): Promise<LinkTokenRow | null> {
  if (!rawToken || rawToken.length < 8 || rawToken.length > 400) return null;
  const [row] = await db
    .select()
    .from(storefrontLinkTokens)
    .where(
      and(
        eq(storefrontLinkTokens.tokenHash, sha256Hex(rawToken)),
        eq(storefrontLinkTokens.tenantId, tenantId),
        gt(storefrontLinkTokens.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Takas: exchanged_at = now, first_opened_at yoksa now. */
export async function markLinkTokenExchanged(db: Database, row: LinkTokenRow, now: Date): Promise<void> {
  await db
    .update(storefrontLinkTokens)
    .set({ exchangedAt: now, ...(row.firstOpenedAt ? {} : { firstOpenedAt: now }) })
    .where(eq(storefrontLinkTokens.id, row.id));
}

export async function findTenantCustomer(db: Database, tenantId: string, customerId: string | null | undefined): Promise<CustomerRow | null> {
  if (!customerId) return null;
  const [c] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
    .limit(1);
  return c ?? null;
}

export function customerDto(c: CustomerRow): NonNullable<StoreSessionView['customer']> {
  return { name: c.name?.trim() || null, phoneMasked: c.phoneE164 ? maskPhone(c.phoneE164) : null };
}

/**
 * Müşterinin bu tenant'taki son `delivered` (test olmayan) siparişi; yalnız hâlâ satışta olabilecek ürünler
 * (aktif, silinmemiş, kısıtsız) ve hâlâ aktif seçenekler. Toplam güncel fiyatlarla hesaplanır (03 §3.4).
 */
export async function loadLastOrder(db: Database, tenantId: string, customerId: string): Promise<StoreSessionView['lastOrder']> {
  const [order] = await db
    .select({ id: orders.id, placedAt: orders.placedAt })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, customerId), eq(orders.status, 'delivered'), isNull(orders.testKind)))
    .orderBy(desc(orders.placedAt))
    .limit(1);
  if (!order) return null;

  const items = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.tenantId, tenantId), eq(orderItems.orderId, order.id)))
    .orderBy(asc(orderItems.sort), asc(orderItems.createdAt));
  const productIds = [...new Set(items.map((i) => i.productId).filter((x): x is string => Boolean(x)))];
  if (!productIds.length) return null;

  const [productRows, itemOptionRows] = await Promise.all([
    db
      .select({ id: products.id, name: products.name, priceKurus: products.priceKurus })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          inArray(products.id, productIds),
          eq(products.isActive, true),
          eq(products.waRestricted, false),
          isNull(products.deletedAt),
        ),
      ),
    db
      .select({ orderItemId: orderItemOptions.orderItemId, optionId: orderItemOptions.optionId })
      .from(orderItemOptions)
      .where(and(eq(orderItemOptions.tenantId, tenantId), inArray(orderItemOptions.orderItemId, items.map((i) => i.id)))),
  ]);
  const productById = new Map(productRows.map((p) => [p.id, p]));
  const optionIds = [...new Set(itemOptionRows.map((o) => o.optionId).filter((x): x is string => Boolean(x)))];
  const activeOptions = optionIds.length
    ? await db
        .select({ id: options.id, priceDeltaKurus: options.priceDeltaKurus })
        .from(options)
        .where(and(eq(options.tenantId, tenantId), inArray(options.id, optionIds), eq(options.isActive, true), isNull(options.deletedAt)))
    : [];
  const optionDelta = new Map(activeOptions.map((o) => [o.id, o.priceDeltaKurus]));

  const out: NonNullable<StoreSessionView['lastOrder']>['items'] = [];
  let totalKurus = 0;
  for (const item of items) {
    const product = item.productId ? productById.get(item.productId) : undefined;
    if (!product) continue;
    const chosen = itemOptionRows
      .filter((o) => o.orderItemId === item.id && o.optionId && optionDelta.has(o.optionId))
      .map((o) => o.optionId as string);
    const unit = product.priceKurus + chosen.reduce((s, id) => s + (optionDelta.get(id) ?? 0), 0);
    totalKurus += Math.max(0, unit) * item.quantity;
    out.push({ productId: product.id, name: product.name, quantity: item.quantity, optionIds: chosen });
  }
  if (!out.length) return null;
  return { items: out, totalKurus, createdAt: order.placedAt.toISOString() };
}
