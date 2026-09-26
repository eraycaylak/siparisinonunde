// Storefront vitrin verisi (14 §6.2 GET /store/:slug): işletme, şube durumu, bölgeler, menü, künye.
// Kurallar: yalnız aktif ve silinmemiş kayıtlar; wa_restricted ürünler listelenmez (00 §6.10);
// sold_out_until > now → soldOut; zorunlu grubu karşılanamayan ürün de tükendi sayılır (04 §6.3).

import { computeOrderingState, DEFAULT_TIMEZONE, isValidSlug, localDateString, sharedPrefillText, type LifecycleStage, type OrderingState } from '@siparis/core';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import {
  branches,
  categories,
  deliveryZones,
  openingHours,
  optionGroups,
  options,
  productOptionGroups,
  products,
  specialDays,
  tenants,
  waAccounts,
  type Database,
} from '@siparis/db';
import { and, asc, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { whatsappLinkFor } from '../messaging/shared';

/** Online sipariş kapalı sayılan yaşam döngüsü aşamaları (05 §dunning: askı ve kapanış). */
export const ORDERING_BLOCKED_STAGES: readonly LifecycleStage[] = ['suspended', 'churned'];

export type TenantRow = typeof tenants.$inferSelect;
export type BranchRow = typeof branches.$inferSelect;

export function normalizeSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase();
  return isValidSlug(slug) ? slug : null;
}

export async function findTenantBySlug(db: Database, rawSlug: string): Promise<TenantRow | null> {
  const slug = normalizeSlug(rawSlug);
  if (!slug) return null;
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return t ?? null;
}

/** Storefront'un gösterdiği şube: varsayılan şube, yoksa ilk oluşturulan (Faz 1: tek şube). */
export async function storefrontBranch(db: Database, tenantId: string): Promise<BranchRow | null> {
  const [b] = await db
    .select()
    .from(branches)
    .where(eq(branches.tenantId, tenantId))
    .orderBy(desc(branches.isDefault), asc(branches.createdAt))
    .limit(1);
  return b ?? null;
}

export interface BranchOrderingInfo {
  state: OrderingState;
  nextOpenAt: Date | null;
  closesAt: Date | null;
  pausedUntil: Date | null;
  busyExtraMinutes: number;
  /** Tenant düzeyinde online sipariş açık mı (ordering_enabled ve askı/kapanış değil). */
  orderingEnabled: boolean;
}

/** Şubenin sipariş alma durumu (core computeOrderingState + tenant kill-switch'i). */
export async function branchOrderingInfo(db: Database, tenant: TenantRow, branch: BranchRow, now: Date): Promise<BranchOrderingInfo> {
  const tz = branch.timezone || DEFAULT_TIMEZONE;
  const yesterday = localDateString(new Date(now.getTime() - 86_400_000), tz);
  const [hours, specials] = await Promise.all([
    db
      .select({ weekday: openingHours.weekday, opensAt: openingHours.opensAt, closesAt: openingHours.closesAt })
      .from(openingHours)
      .where(eq(openingHours.branchId, branch.id)),
    db
      .select({
        date: specialDays.date,
        isClosed: specialDays.isClosed,
        opensAt: specialDays.opensAt,
        closesAt: specialDays.closesAt,
      })
      .from(specialDays)
      .where(and(eq(specialDays.branchId, branch.id), gte(specialDays.date, yesterday))),
  ]);
  const result = computeOrderingState(
    { timezone: tz, hours, specialDays: specials, pausedUntil: branch.pausedUntil, busyExtraMinutes: branch.busyExtraMinutes },
    now,
  );
  // Canlıya geçmemiş işletme (web_live_at boş) sipariş almaz (04 §3.4.4)
  const orderingEnabled = tenant.orderingEnabled && !ORDERING_BLOCKED_STAGES.includes(tenant.lifecycleStage) && tenant.webLiveAt != null;
  if (!orderingEnabled) {
    // İşletme düzeyinde kapalı: "paused" gibi davran, açılış zamanı bilinmez
    return { state: 'paused', nextOpenAt: null, closesAt: null, pausedUntil: null, busyExtraMinutes: 0, orderingEnabled: false };
  }
  return {
    state: result.state,
    nextOpenAt: result.nextOpenAt,
    closesAt: result.closesAt,
    pausedUntil: result.pausedUntil,
    busyExtraMinutes: result.state === 'busy' ? result.busyExtraMinutes : 0,
    orderingEnabled: true,
  };
}

function branchAddress(b: BranchRow): string | null {
  const parts = [b.addressLine, b.neighborhood ? `${b.neighborhood} Mah.` : null, [b.district, b.city].filter(Boolean).join(' / ')]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Vitrin için tam veri; slug bulunamazsa null. */
export async function loadStorefront(db: Database, rawSlug: string, now: Date = new Date()): Promise<StorefrontView | null> {
  const tenant = await findTenantBySlug(db, rawSlug);
  if (!tenant) return null;
  const branch = await storefrontBranch(db, tenant.id);
  if (!branch) return null;

  const [ordering, zoneRows, catRows, prodRows, waRows] = await Promise.all([
    branchOrderingInfo(db, tenant, branch, now),
    db
      .select()
      .from(deliveryZones)
      .where(and(eq(deliveryZones.tenantId, tenant.id), eq(deliveryZones.branchId, branch.id), eq(deliveryZones.isActive, true), isNull(deliveryZones.deletedAt)))
      .orderBy(asc(deliveryZones.sort), asc(deliveryZones.name)),
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.tenantId, tenant.id), eq(categories.isActive, true), isNull(categories.deletedAt)))
      .orderBy(asc(categories.sort), asc(categories.name)),
    db
      .select()
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenant.id),
          eq(products.isActive, true),
          eq(products.waRestricted, false),
          isNull(products.deletedAt),
        ),
      )
      .orderBy(asc(products.sort), asc(products.name)),
    db
      .select({ displayPhone: waAccounts.displayPhone, provider: waAccounts.provider })
      .from(waAccounts)
      .where(and(eq(waAccounts.tenantId, tenant.id), eq(waAccounts.branchId, branch.id), eq(waAccounts.status, 'connected')))
      .limit(1),
  ]);

  const productIds = prodRows.map((p) => p.id);
  const links = productIds.length
    ? await db
        .select({ productId: productOptionGroups.productId, groupId: productOptionGroups.groupId, sort: productOptionGroups.sort })
        .from(productOptionGroups)
        .where(and(eq(productOptionGroups.tenantId, tenant.id), inArray(productOptionGroups.productId, productIds)))
        .orderBy(asc(productOptionGroups.sort))
    : [];
  const groupIds = [...new Set(links.map((l) => l.groupId))];
  const [groupRows, optionRows] = groupIds.length
    ? await Promise.all([
        db
          .select()
          .from(optionGroups)
          .where(and(eq(optionGroups.tenantId, tenant.id), inArray(optionGroups.id, groupIds), isNull(optionGroups.deletedAt))),
        db
          .select()
          .from(options)
          .where(and(eq(options.tenantId, tenant.id), inArray(options.groupId, groupIds), eq(options.isActive, true), isNull(options.deletedAt)))
          .orderBy(asc(options.sort), asc(options.name)),
      ])
    : [[], []];

  const optionsByGroup = new Map<string, { id: string; name: string; priceDeltaKurus: number }[]>();
  for (const o of optionRows) {
    const list = optionsByGroup.get(o.groupId) ?? [];
    list.push({ id: o.id, name: o.name, priceDeltaKurus: o.priceDeltaKurus });
    optionsByGroup.set(o.groupId, list);
  }
  const groupById = new Map(groupRows.map((g) => [g.id, g]));
  const linksByProduct = new Map<string, string[]>();
  for (const l of links) {
    const list = linksByProduct.get(l.productId) ?? [];
    list.push(l.groupId);
    linksByProduct.set(l.productId, list);
  }

  const productsByCategory = new Map<string, StorefrontView['categories'][number]['products']>();
  for (const p of prodRows) {
    let unsatisfiable = false;
    const groups: StorefrontView['categories'][number]['products'][number]['optionGroups'] = [];
    for (const gid of linksByProduct.get(p.id) ?? []) {
      const g = groupById.get(gid);
      if (!g) continue;
      const opts = optionsByGroup.get(gid) ?? [];
      if (opts.length < g.minSelect) unsatisfiable = true;
      if (!opts.length) continue;
      groups.push({ id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, options: opts });
    }
    const soldOut = Boolean(p.soldOutUntil && p.soldOutUntil > now) || unsatisfiable;
    const list = productsByCategory.get(p.categoryId) ?? [];
    list.push({
      id: p.id,
      name: p.name,
      description: p.description,
      priceKurus: p.priceKurus,
      imageUrl: p.imageUrl,
      soldOut,
      optionGroups: groups,
    });
    productsByCategory.set(p.categoryId, list);
  }

  const categoriesOut = catRows
    .map((c) => ({ id: c.id, name: c.name, products: productsByCategory.get(c.id) ?? [] }))
    .filter((c) => c.products.length > 0);

  // Canlıya geçmeden (künye onaylanmadan) kayıttaki telefonlar işletme telefonu olarak yayımlanmaz
  const live = tenant.webLiveAt != null;
  const pub = <T,>(v: T | null | undefined): T | null => (live ? (v ?? null) : null);
  // WhatsApp: ortak numarada platform numarası + dükkan kodlu ön-dolu bağlantı (00 §12a madde 8), kendi numarada wa.me
  const wa = waRows[0]?.displayPhone ? waRows[0] : null;
  const sharedWa = wa?.provider === 'shared' && tenant.waCode ? { code: tenant.waCode, prefill: sharedPrefillText(tenant.name, tenant.waCode) } : null;

  return {
    tenant: {
      name: tenant.name,
      slug: tenant.slug,
      brandColor: tenant.brandColor,
      logoUrl: tenant.logoUrl,
      coverUrl: tenant.coverUrl,
      phone: pub(tenant.phone ?? branch.phone),
      whatsappPhone: pub(wa?.displayPhone),
      whatsappLink: pub(wa ? whatsappLinkFor(wa, tenant) : null),
      whatsappMode: pub(wa ? (wa.provider === 'shared' ? 'shared' : 'own') : null),
      whatsappCode: pub(sharedWa?.code),
      whatsappPrefillText: pub(sharedWa?.prefill),
    },
    branch: {
      id: branch.id,
      name: branch.name,
      address: branchAddress(branch),
      lat: branch.lat,
      lng: branch.lng,
      orderingState: ordering.state,
      nextOpenAt: ordering.nextOpenAt?.toISOString() ?? null,
      closesAt: ordering.closesAt?.toISOString() ?? null,
      pausedUntil: ordering.pausedUntil?.toISOString() ?? null,
      acceptsDelivery: branch.acceptsDelivery,
      acceptsPickup: branch.acceptsPickup,
      paymentMethods: branch.paymentMethods,
      mealCardBrands: branch.mealCardBrands,
      prepMinutes: branch.defaultPrepMinutes,
      busyExtraMinutes: ordering.busyExtraMinutes,
      phone: pub(branch.phone ?? tenant.phone),
      pickupMinOrderKurus: branch.pickupMinOrderKurus,
    },
    orderingEnabled: ordering.orderingEnabled,
    live,
    zones: zoneRows.map((z) => ({
      id: z.id,
      name: z.name,
      kind: z.kind,
      neighborhoods: z.neighborhoods,
      feeKurus: z.feeKurus,
      minOrderKurus: z.minOrderKurus,
      etaMinutes: z.etaMinutes,
    })),
    categories: categoriesOut,
    legal: {
      legalName: tenant.legalName,
      taxNo: tenant.taxNo,
      taxOffice: tenant.taxOffice,
      address: tenant.address,
      phone: pub(tenant.phone),
      email: tenant.email,
    },
  };
}
