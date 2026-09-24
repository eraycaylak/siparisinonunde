// Fiyat bağlamı: ürünleri/seçenekleri ve teslimat bölgelerini DB'den yükler; core quoteCart + resolveZone ile
// sepeti sunucuda fiyatlar (CLAUDE.md kural 3: istemci tutarı yok sayılır). Storefront quote, sipariş oluşturma
// ve telefon siparişi aynı fonksiyonu kullanır (03 §5.4).

import {
  isValidLatLng,
  matchNeighborhood,
  quoteCart,
  resolveZone,
  type CartItemInput,
  type FulfillmentType,
  type PricingProduct,
  type QuoteResult,
  type ZoneMatch,
} from '@siparis/core';
import { categories, deliveryZones, optionGroups, options, productOptionGroups, products, type Database } from '@siparis/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { BranchRow } from './store-context';

export type ZoneRow = typeof deliveryZones.$inferSelect;

export interface LoadedProduct extends PricingProduct {
  categoryId: string;
  categorySort: number;
  sort: number;
  description: string | null;
  imageUrl: string | null;
}

/**
 * Tenant ürünlerini seçenek gruplarıyla yükler. `productIds` verilirse yalnız onlar.
 * Silinmiş ürün/kategori yüklenmez; pasif kategori ürünü satılamaz (isActive=false).
 */
export async function loadPricingProducts(db: Database, tenantId: string, productIds?: readonly string[]): Promise<Map<string, LoadedProduct>> {
  const map = new Map<string, LoadedProduct>();
  if (productIds && productIds.length === 0) return map;
  const where = [eq(products.tenantId, tenantId), isNull(products.deletedAt), isNull(categories.deletedAt)];
  if (productIds) where.push(inArray(products.id, [...new Set(productIds)]));
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      priceKurus: products.priceKurus,
      imageUrl: products.imageUrl,
      isActive: products.isActive,
      soldOutUntil: products.soldOutUntil,
      waRestricted: products.waRestricted,
      sort: products.sort,
      categoryId: categories.id,
      categoryName: categories.name,
      categoryActive: categories.isActive,
      categorySort: categories.sort,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(...where));
  if (!rows.length) return map;

  const ids = rows.map((r) => r.id);
  const links = await db
    .select({ productId: productOptionGroups.productId, groupId: productOptionGroups.groupId, sort: productOptionGroups.sort })
    .from(productOptionGroups)
    .where(and(eq(productOptionGroups.tenantId, tenantId), inArray(productOptionGroups.productId, ids)))
    .orderBy(asc(productOptionGroups.sort));
  const groupIds = [...new Set(links.map((l) => l.groupId))];
  const groups = groupIds.length
    ? await db
        .select()
        .from(optionGroups)
        .where(and(eq(optionGroups.tenantId, tenantId), inArray(optionGroups.id, groupIds), isNull(optionGroups.deletedAt)))
    : [];
  const opts = groupIds.length
    ? await db
        .select()
        .from(options)
        .where(and(eq(options.tenantId, tenantId), inArray(options.groupId, groupIds), isNull(options.deletedAt)))
        .orderBy(asc(options.sort))
    : [];
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const optionsByGroup = new Map<string, typeof opts>();
  for (const o of opts) {
    const list = optionsByGroup.get(o.groupId) ?? [];
    list.push(o);
    optionsByGroup.set(o.groupId, list);
  }

  for (const r of rows) {
    const productLinks = links.filter((l) => l.productId === r.id);
    map.set(r.id, {
      id: r.id,
      name: r.name,
      description: r.description,
      imageUrl: r.imageUrl,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      categorySort: r.categorySort,
      sort: r.sort,
      priceKurus: r.priceKurus,
      isActive: r.isActive && r.categoryActive,
      soldOutUntil: r.soldOutUntil,
      waRestricted: r.waRestricted,
      optionGroups: productLinks
        .map((l) => groupById.get(l.groupId))
        .filter((g): g is NonNullable<typeof g> => Boolean(g))
        .map((g) => ({
          id: g.id,
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          options: (optionsByGroup.get(g.id) ?? []).map((o) => ({
            id: o.id,
            name: o.name,
            priceDeltaKurus: o.priceDeltaKurus,
            isActive: o.isActive,
          })),
        })),
    });
  }
  return map;
}

/** Şubenin aktif teslimat bölgeleri (sıra ile). */
export async function loadZones(db: Database, tenantId: string, branchId: string): Promise<ZoneRow[]> {
  return db
    .select()
    .from(deliveryZones)
    .where(and(eq(deliveryZones.tenantId, tenantId), eq(deliveryZones.branchId, branchId), isNull(deliveryZones.deletedAt)))
    .orderBy(asc(deliveryZones.sort), asc(deliveryZones.createdAt));
}

export interface ZoneQueryInput {
  zoneId?: string | null;
  neighborhood?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Adres → bölge. Önce mahalle/konum ile core.resolveZone; bulunamazsa ve istemci konumsuz bir poligon/yarıçap
 * bölgesini seçtiyse o bölge kabul edilir (mahalle bölgesi her zaman mahalle eşleşmesi ister).
 */
export function resolveOrderZone(zones: readonly ZoneRow[], branch: Pick<BranchRow, 'lat' | 'lng'>, q: ZoneQueryInput): ZoneMatch<ZoneRow> | null {
  const active = zones.filter((z) => z.isActive && !z.deletedAt);
  const center = branch.lat != null && branch.lng != null ? { lat: branch.lat, lng: branch.lng } : null;
  if (q.zoneId) {
    const chosen = active.find((z) => z.id === q.zoneId);
    if (chosen?.kind === 'neighborhoods') {
      const name = matchNeighborhood(q.neighborhood, chosen.neighborhoods);
      if (name) return { zone: chosen, neighborhood: name, via: 'neighborhoods' };
    }
  }
  const match = resolveZone(active, { neighborhood: q.neighborhood, lat: q.lat, lng: q.lng }, { center });
  if (match) return match;
  if (q.zoneId && !isValidLatLng({ lat: q.lat ?? undefined, lng: q.lng ?? undefined })) {
    const chosen = active.find((z) => z.id === q.zoneId);
    if (chosen && chosen.kind !== 'neighborhoods') return { zone: chosen, neighborhood: null, via: chosen.kind };
  }
  return null;
}

export interface QuoteForBranchInput extends ZoneQueryInput {
  items: CartItemInput[];
  fulfillmentType: FulfillmentType;
}

export interface BranchQuote {
  quote: QuoteResult;
  zoneMatch: ZoneMatch<ZoneRow> | null;
  products: Map<string, LoadedProduct>;
}

/** Sepeti şube bağlamında fiyatlar (bölge çözümü dahil). */
export async function quoteForBranch(
  db: Database,
  input: {
    tenantId: string;
    branch: BranchRow;
    request: QuoteForBranchInput;
    now?: Date;
    /** Telefon siparişinde bölge dışı istisnası (00 §4). */
    outOfZoneOverride?: { feeKurus: number } | null;
  },
): Promise<BranchQuote> {
  const { branch, request } = input;
  const productMap = await loadPricingProducts(
    db,
    input.tenantId,
    request.items.map((i) => i.productId),
  );
  let zoneMatch: ZoneMatch<ZoneRow> | null = null;
  if (request.fulfillmentType === 'delivery') {
    const zones = await loadZones(db, input.tenantId, branch.id);
    zoneMatch = resolveOrderZone(zones, branch, request);
  }
  const quote = quoteCart(
    {
      items: request.items,
      fulfillmentType: request.fulfillmentType,
      zone: zoneMatch
        ? {
            id: zoneMatch.zone.id,
            name: zoneMatch.zone.name,
            feeKurus: zoneMatch.zone.feeKurus,
            minOrderKurus: zoneMatch.zone.minOrderKurus,
            etaMinutes: zoneMatch.zone.etaMinutes,
          }
        : null,
    },
    {
      products: productMap,
      now: input.now,
      acceptsDelivery: branch.acceptsDelivery,
      acceptsPickup: branch.acceptsPickup,
      pickupMinOrderKurus: branch.pickupMinOrderKurus,
      outOfZoneOverride: input.outOfZoneOverride ?? null,
    },
  );
  return { quote, zoneMatch, products: productMap };
}

/** quoteResponseSchema biçimi (14 §6.2). */
export function toQuoteResponse(q: QuoteResult) {
  return {
    lines: q.lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      quantity: l.quantity,
      unitPriceKurus: l.unitPriceKurus,
      optionsUnitKurus: l.optionsUnitKurus,
      lineTotalKurus: l.lineTotalKurus,
      options: l.options.map((o) => ({ ...o })),
      note: l.note,
    })),
    subtotalKurus: q.subtotalKurus,
    deliveryFeeKurus: q.deliveryFeeKurus,
    totalKurus: q.totalKurus,
    minOrderKurus: q.minOrderKurus,
    meetsMinimum: q.meetsMinimum,
    zone: q.zone
      ? { id: q.zone.id, name: q.zone.name, feeKurus: q.zone.feeKurus, minOrderKurus: q.zone.minOrderKurus, etaMinutes: q.zone.etaMinutes }
      : null,
    problems: q.problems.map((p) => ({ ...p })),
  };
}
