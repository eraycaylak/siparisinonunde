// Mesajlaşma için ortak yükleyiciler: işletme/şube, sipariş alma durumu, bölge özeti, menü linki (Akış A token),
// sipariş kalemleri, takip linki, açık sipariş.

import {
  computeOrderingState,
  formatClockTR,
  formatNextOpenTR,
  formatTLShort,
  localDateString,
  weekdayOf,
  type MessageItem,
  type OrderingStateResult,
} from '@siparis/core';
import {
  branches,
  deliveryZones,
  openingHours,
  orderItemOptions,
  orderItems,
  orders,
  specialDays,
  storefrontLinkTokens,
  tenants,
  type Database,
} from '@siparis/db';
import { and, asc, desc, eq, gte, inArray, isNull, ne, or } from 'drizzle-orm';
import type { Config } from '../../config';
import { randomToken, sha256Hex } from '../../lib/tokens';
import { trackingUrl } from '../../lib/tracking';

export type TenantRow = typeof tenants.$inferSelect;
export type BranchRow = typeof branches.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;

/** Akış A menü linki ömrü (DILIM-KURALLARI: 2 sa). */
export const MENU_LINK_TTL_MS = 2 * 60 * 60_000;

export const OPEN_CUSTOMER_ORDER_STATUSES = ['new', 'accepted', 'preparing', 'ready', 'on_the_way'] as const;

export async function loadTenant(db: Database, tenantId: string): Promise<TenantRow | undefined> {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  return t;
}

export async function loadBranch(db: Database, tenantId: string, branchId: string): Promise<BranchRow | undefined> {
  const [b] = await db.select().from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)));
  return b;
}

/** Askı / salt-okunur / sipariş kapalı → WhatsApp'tan online sipariş alınamaz (M33). */
export function tenantUnavailable(t: TenantRow): boolean {
  if (!t.orderingEnabled) return true;
  if (t.suspensionReason) return true;
  return t.lifecycleStage === 'suspended' || t.lifecycleStage === 'read_only' || t.lifecycleStage === 'churned';
}

export interface BranchSchedule extends OrderingStateResult {
  /** "22.30" (açıkken kapanış saati) */
  kapanis: string | null;
  /** "Yarın 10.00" (kapalı/duraklatılmışken) */
  acilis: string | null;
  /** Bugünün ilk açılış saati "10.00" */
  bugunAcilis: string | null;
}

export async function branchSchedule(db: Database, branch: BranchRow, now: Date): Promise<BranchSchedule> {
  const tz = branch.timezone || 'Europe/Istanbul';
  const [hours, days] = await Promise.all([
    db
      .select({ weekday: openingHours.weekday, opensAt: openingHours.opensAt, closesAt: openingHours.closesAt })
      .from(openingHours)
      .where(eq(openingHours.branchId, branch.id)),
    db
      .select({ date: specialDays.date, isClosed: specialDays.isClosed, opensAt: specialDays.opensAt, closesAt: specialDays.closesAt })
      .from(specialDays)
      .where(and(eq(specialDays.branchId, branch.id), gte(specialDays.date, localDateString(new Date(now.getTime() - 86_400_000), tz)))),
  ]);
  const state = computeOrderingState(
    { timezone: tz, hours, specialDays: days, pausedUntil: branch.pausedUntil, busyExtraMinutes: branch.busyExtraMinutes },
    now,
  );
  const weekday = weekdayOf(localDateString(now, tz));
  const today = hours.filter((h) => h.weekday === weekday).sort((a, b) => a.opensAt.localeCompare(b.opensAt))[0];
  const is24h = (h: { opensAt: string; closesAt: string } | undefined) => !!h && h.opensAt === h.closesAt;
  return {
    ...state,
    kapanis: state.closesAt && !is24h(today) ? formatClockTR(state.closesAt, tz) : null,
    acilis: state.nextOpenAt ? formatNextOpenTR(state.nextOpenAt, now, tz) : null,
    bugunAcilis: today ? today.opensAt.replace(':', '.') : null,
  };
}

export interface ZoneSummary {
  /** "30–45 dk" */
  etaAralik: string | null;
  /** "150 TL" (en düşük minimum sepet) */
  minSepet: string | null;
  ucretAralik: string | null;
  minAralik: string | null;
}

function range(values: number[], fmt: (n: number) => string): string | null {
  if (!values.length) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
}

export async function zoneSummary(db: Database, branch: BranchRow): Promise<ZoneSummary> {
  const zones = await db
    .select({ eta: deliveryZones.etaMinutes, fee: deliveryZones.feeKurus, min: deliveryZones.minOrderKurus })
    .from(deliveryZones)
    .where(and(eq(deliveryZones.branchId, branch.id), eq(deliveryZones.isActive, true), isNull(deliveryZones.deletedAt)));
  const extra = Math.max(0, branch.busyExtraMinutes ?? 0);
  const etas = zones.map((z) => z.eta + extra);
  const etaAralik = etas.length ? `${range(etas, (n) => String(n))} dk` : null;
  const minVals = zones.map((z) => z.min).filter((n) => n > 0);
  return {
    etaAralik,
    minSepet: minVals.length ? formatTLShort(Math.min(...minVals)) : null,
    ucretAralik: range(
      zones.map((z) => z.fee),
      (n) => (n === 0 ? 'ücretsiz' : formatTLShort(n)),
    ),
    minAralik: range(
      zones.map((z) => z.min),
      (n) => formatTLShort(n),
    ),
  };
}

/**
 * Akış A "Menüyü aç" linki: 32 bayt rastgele base64url token, storefront_link_tokens'a sha256 hash +
 * konuşma + müşteri + 2 sa. URL: ${APP_BASE_URL}/s/<slug>?l=<token>
 */
export async function createMenuLink(
  tx: Database,
  config: Config,
  input: { tenantId: string; slug: string; branchId: string; conversationId: string; customerId: string; now: Date },
): Promise<string> {
  const token = randomToken(32);
  await tx.insert(storefrontLinkTokens).values({
    tenantId: input.tenantId,
    branchId: input.branchId,
    tokenHash: sha256Hex(token),
    conversationId: input.conversationId,
    customerId: input.customerId,
    expiresAt: new Date(input.now.getTime() + MENU_LINK_TTL_MS),
    createdAt: input.now,
  });
  return `${config.APP_BASE_URL.replace(/\/$/, '')}/s/${encodeURIComponent(input.slug)}?l=${token}`;
}

/** Token'sız storefront adresi (ret/iptal mesajlarındaki "Menüyü aç"). */
export function storefrontUrl(config: Config, slug: string): string {
  return `${config.APP_BASE_URL.replace(/\/$/, '')}/s/${encodeURIComponent(slug)}`;
}

export function orderTrackingUrl(config: Config, orderId: string): string {
  return trackingUrl(config.APP_BASE_URL, orderId, config.TRACKING_SECRET);
}

/** Mesajlardaki {kalemler} için sipariş kalemleri (seçenek adlarıyla). */
export async function orderMessageItems(db: Database, orderId: string): Promise<MessageItem[]> {
  const items = await db
    .select({ id: orderItems.id, name: orderItems.name, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.sort), asc(orderItems.createdAt));
  if (!items.length) return [];
  const opts = await db
    .select({ itemId: orderItemOptions.orderItemId, name: orderItemOptions.optionName })
    .from(orderItemOptions)
    .where(
      inArray(
        orderItemOptions.orderItemId,
        items.map((i) => i.id),
      ),
    );
  return items.map((i) => ({
    name: i.name,
    quantity: i.quantity,
    options: opts.filter((o) => o.itemId === i.id).map((o) => o.name),
  }));
}

/** Müşterinin en yeni açık siparişi (awaiting_customer ve canary hariç). */
export async function findActiveOrder(db: Database, tenantId: string, customerId: string): Promise<OrderRow | undefined> {
  const [o] = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.customerId, customerId),
        inArray(orders.status, [...OPEN_CUSTOMER_ORDER_STATUSES]),
        or(isNull(orders.testKind), ne(orders.testKind, 'canary')),
      ),
    )
    .orderBy(desc(orders.placedAt))
    .limit(1);
  return o;
}

/** Son teslim edilmiş sipariş (M02). */
export async function findLastDeliveredOrder(db: Database, tenantId: string, customerId: string): Promise<OrderRow | undefined> {
  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, customerId), eq(orders.status, 'delivered')))
    .orderBy(desc(orders.placedAt))
    .limit(1);
  return o;
}

/** "21 Eylül" */
export function formatDayMonthTR(d: Date, tz = 'Europe/Istanbul'): string {
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', timeZone: tz }).format(d);
}

/** Kısa kalem özeti: "2× Lahmacun, 1× Ayran ve 2 ürün daha" */
export function shortItems(items: MessageItem[], max = 3): string {
  const shown = items.slice(0, max).map((i) => `${i.quantity}× ${i.name}`);
  const rest = items.length - max;
  return rest > 0 ? `${shown.join(', ')} ve ${rest} ürün daha` : shown.join(', ');
}

/** Şube kısa adresi: "Aşağınohutlu Mah. …" ya da işletme adı. */
export function branchShortAddress(b: BranchRow): string {
  return [b.addressLine, b.neighborhood].filter(Boolean).join(', ') || b.name;
}

/** İletişim telefonu: şube, yoksa işletme. */
export function contactPhone(t: TenantRow, b: BranchRow | undefined): string | null {
  return b?.phone ?? t.phone ?? null;
}
