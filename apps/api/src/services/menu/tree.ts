// Panel menü ağacı ve satır → DTO dönüşümleri (14 §6.3 GET /panel/menu).

import type { PanelMenuResponse, PanelOptionGroup, PanelProduct } from '@siparis/core/menu/contracts';
import { categories, optionGroups, options, productOptionGroups, products, type Database } from '@siparis/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

export type ProductRow = typeof products.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type OptionGroupRow = typeof optionGroups.$inferSelect;
export type OptionRow = typeof options.$inferSelect;

export function toPanelProduct(p: ProductRow, optionGroupIds: string[], now: Date, showPrices = true): PanelProduct {
  const soldOut = Boolean(p.soldOutUntil && p.soldOutUntil > now);
  return {
    id: p.id,
    categoryId: p.categoryId,
    name: p.name,
    description: p.description,
    ...(showPrices ? { priceKurus: p.priceKurus } : {}),
    imageUrl: p.imageUrl,
    isActive: p.isActive,
    soldOut,
    soldOutUntil: soldOut && p.soldOutUntil ? p.soldOutUntil.toISOString() : null,
    waRestricted: p.waRestricted,
    sort: p.sort,
    optionGroupIds,
    version: p.version,
  };
}

export function toPanelOptionGroup(g: OptionGroupRow, opts: OptionRow[], productCount: number, showPrices = true): PanelOptionGroup {
  return {
    id: g.id,
    name: g.name,
    internalName: g.internalName,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    sort: g.sort,
    productCount,
    options: opts
      .filter((o) => o.groupId === g.id && !o.deletedAt)
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'tr'))
      .map((o) => ({
        id: o.id,
        groupId: o.groupId,
        name: o.name,
        ...(showPrices ? { priceDeltaKurus: o.priceDeltaKurus } : {}),
        isActive: o.isActive,
        sort: o.sort,
      })),
  };
}

/** Ürünün bağlı (silinmemiş) seçenek grubu kimlikleri, sıralı. */
export async function productGroupIds(db: Database, tenantId: string, productId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: productOptionGroups.groupId })
    .from(productOptionGroups)
    .innerJoin(optionGroups, eq(optionGroups.id, productOptionGroups.groupId))
    .where(and(eq(productOptionGroups.tenantId, tenantId), eq(productOptionGroups.productId, productId), isNull(optionGroups.deletedAt)))
    .orderBy(asc(productOptionGroups.sort));
  return rows.map((r) => r.groupId);
}

export async function loadOptionGroupDto(db: Database, tenantId: string, groupId: string, showPrices = true): Promise<PanelOptionGroup | null> {
  const [g] = await db
    .select()
    .from(optionGroups)
    .where(and(eq(optionGroups.id, groupId), eq(optionGroups.tenantId, tenantId), isNull(optionGroups.deletedAt)));
  if (!g) return null;
  const [opts, links] = await Promise.all([
    db.select().from(options).where(and(eq(options.tenantId, tenantId), eq(options.groupId, groupId), isNull(options.deletedAt))),
    db
      .select({ productId: productOptionGroups.productId })
      .from(productOptionGroups)
      .innerJoin(products, eq(products.id, productOptionGroups.productId))
      .where(and(eq(productOptionGroups.tenantId, tenantId), eq(productOptionGroups.groupId, groupId), isNull(products.deletedAt))),
  ]);
  return toPanelOptionGroup(g, opts, links.length, showPrices);
}

export async function loadPanelMenu(
  db: Database,
  tenantId: string,
  opts: { now?: Date; showPrices: boolean; canEdit: boolean },
): Promise<PanelMenuResponse> {
  const now = opts.now ?? new Date();
  const [catRows, prodRows, groupRows] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(and(eq(categories.tenantId, tenantId), isNull(categories.deletedAt)))
      .orderBy(asc(categories.sort), asc(categories.createdAt)),
    db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), isNull(products.deletedAt)))
      .orderBy(asc(products.sort), asc(products.createdAt)),
    db
      .select()
      .from(optionGroups)
      .where(and(eq(optionGroups.tenantId, tenantId), isNull(optionGroups.deletedAt)))
      .orderBy(asc(optionGroups.sort), asc(optionGroups.createdAt)),
  ]);
  const groupIds = groupRows.map((g) => g.id);
  const productIds = new Set(prodRows.map((p) => p.id));
  const [optRows, linkRows] = await Promise.all([
    groupIds.length
      ? db
          .select()
          .from(options)
          .where(and(eq(options.tenantId, tenantId), inArray(options.groupId, groupIds), isNull(options.deletedAt)))
      : Promise.resolve([] as OptionRow[]),
    db
      .select()
      .from(productOptionGroups)
      .where(eq(productOptionGroups.tenantId, tenantId))
      .orderBy(asc(productOptionGroups.sort)),
  ]);
  const liveGroups = new Set(groupIds);
  const groupsByProduct = new Map<string, string[]>();
  const productCountByGroup = new Map<string, number>();
  for (const l of linkRows) {
    if (!liveGroups.has(l.groupId) || !productIds.has(l.productId)) continue;
    const list = groupsByProduct.get(l.productId) ?? [];
    list.push(l.groupId);
    groupsByProduct.set(l.productId, list);
    productCountByGroup.set(l.groupId, (productCountByGroup.get(l.groupId) ?? 0) + 1);
  }
  const productCountByCategory = new Map<string, number>();
  for (const p of prodRows) productCountByCategory.set(p.categoryId, (productCountByCategory.get(p.categoryId) ?? 0) + 1);

  return {
    categories: catRows.map((c) => ({
      id: c.id,
      name: c.name,
      sort: c.sort,
      isActive: c.isActive,
      productCount: productCountByCategory.get(c.id) ?? 0,
    })),
    products: prodRows.map((p) => toPanelProduct(p, groupsByProduct.get(p.id) ?? [], now, opts.showPrices)),
    optionGroups: groupRows.map((g) => toPanelOptionGroup(g, optRows, productCountByGroup.get(g.id) ?? 0, opts.showPrices)),
    canEdit: opts.canEdit,
    showPrices: opts.showPrices,
  };
}
