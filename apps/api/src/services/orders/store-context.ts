// Storefront bağlamı: slug → işletme + varsayılan şube, şubenin anlık sipariş alma durumu (00 §7 ordering_state).

import { computeOrderingState, localDateString, type OrderingStateResult } from '@siparis/core';
import { branches, openingHours, specialDays, tenants, type Database } from '@siparis/db';
import { and, asc, desc, eq, gte } from 'drizzle-orm';

export type TenantRow = typeof tenants.$inferSelect;
export type BranchRow = typeof branches.$inferSelect;

/** Sipariş almayı kapatan yaşam döngüsü aşamaları (00 §9: askı, kapanış). */
const CLOSED_STAGES = new Set<TenantRow['lifecycleStage']>(['suspended', 'churned']);

export async function loadDefaultBranch(db: Database, tenantId: string): Promise<BranchRow | undefined> {
  const [b] = await db
    .select()
    .from(branches)
    .where(eq(branches.tenantId, tenantId))
    .orderBy(desc(branches.isDefault), asc(branches.createdAt))
    .limit(1);
  return b;
}

/** Slug ile işletme ve varsayılan şube (yoksa undefined). */
export async function loadStoreBySlug(db: Database, slug: string): Promise<{ tenant: TenantRow; branch: BranchRow } | undefined> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug.toLowerCase()));
  if (!tenant) return undefined;
  const branch = await loadDefaultBranch(db, tenant.id);
  if (!branch) return undefined;
  return { tenant, branch };
}

/** Şubenin çalışma saatleri + özel günleri + duraklatma/yoğunluk → ordering_state. */
export async function computeBranchOrderingState(db: Database, branch: BranchRow, now: Date = new Date()): Promise<OrderingStateResult> {
  const tz = branch.timezone || 'Europe/Istanbul';
  const hours = await db
    .select({ weekday: openingHours.weekday, opensAt: openingHours.opensAt, closesAt: openingHours.closesAt })
    .from(openingHours)
    .where(eq(openingHours.branchId, branch.id));
  const yesterday = localDateString(new Date(now.getTime() - 86_400_000), tz);
  const days = await db
    .select({ date: specialDays.date, isClosed: specialDays.isClosed, opensAt: specialDays.opensAt, closesAt: specialDays.closesAt })
    .from(specialDays)
    .where(and(eq(specialDays.branchId, branch.id), gte(specialDays.date, yesterday)));
  return computeOrderingState(
    {
      timezone: tz,
      hours,
      specialDays: days,
      pausedUntil: branch.pausedUntil,
      busyExtraMinutes: branch.busyExtraMinutes,
    },
    now,
  );
}

/**
 * İşletme genelinde online sipariş kapalı mı: kill-switch, askı/kapanış ya da henüz "Canlıya geç" denmemiş
 * (web_live_at boş; künye tamamlanmadan storefront yayına alınmaz — 04 §3.4.4, 6563 s. K. m.3).
 */
export function tenantOrderingBlocked(tenant: TenantRow): boolean {
  return !tenant.orderingEnabled || CLOSED_STAGES.has(tenant.lifecycleStage) || !tenant.webLiveAt;
}
