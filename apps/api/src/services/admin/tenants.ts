// İşletme listesi ve 360° detay (05 A-03, A-04). Son müşteri kişisel verisi dönmez (05 §A.1 #9).

import type { AdminNote, AdminOrderRow, AdminTenantDetail, AdminTenantListItem } from '@siparis/core/admin/contracts';
import { LIFECYCLE_TRANSITIONS, lifecycleTransitionPermission } from '@siparis/core/admin/lifecycle';
import { adminCan } from '@siparis/core/admin/permissions';
import {
  LIFECYCLE_STAGES,
  formatPhone,
  normalizePhone,
  type LifecycleStage,
  type PlanCode,
  type PlatformRole,
  type SuspensionReason,
  type WaAccountStatus,
  sharedWaLink,
  type WaMode,
} from '@siparis/core';
import { adminNotes, branches, memberships, orders, sessions, subscriptions, tenants, users, waAccounts, type Database } from '@siparis/db';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { loadSchedules, stateOf } from './schedule';
import { cursorOrder, cursorWhere, decodeCursor, iso, isoOrNull, paginate, rows } from './util';
import { loadWaHealth } from './wa-health';

type OrderRow = typeof orders.$inferSelect;

export function toAdminOrderRow(o: OrderRow): AdminOrderRow {
  return {
    id: o.id,
    number: o.number,
    branchId: o.branchId,
    status: o.status,
    channel: o.channel,
    fulfillmentType: o.fulfillmentType,
    totalKurus: o.totalKurus,
    testKind: o.testKind ?? null,
    placedAt: iso(o.placedAt),
    acceptedAt: isoOrNull(o.acceptedAt),
    approvalSeconds: o.acceptedAt ? Math.max(0, Math.round((o.acceptedAt.getTime() - o.placedAt.getTime()) / 1000)) : null,
    rejectionReason: o.rejectionReason ?? null,
    cancelReason: o.cancelReason ?? null,
    cancelledBy: o.cancelledBy ?? null,
  };
}

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => `\\${m}`);
}

interface ListRow {
  id: string;
  name: string;
  slug: string;
  lifecycle_stage: LifecycleStage;
  plan_code: PlanCode;
  suspension_reason: SuspensionReason | null;
  ordering_enabled: boolean;
  is_demo: boolean;
  trial_ends_at: string | null;
  live_at: string | null;
  created_at: string;
  city: string | null;
  district: string | null;
  last_order_at: string | null;
  orders_7d: number;
  wa_status: WaAccountStatus | null;
  wa_mode: WaMode;
  wa_code: string | null;
}

export async function listTenants(
  db: Database,
  opts: { q?: string; stage?: LifecycleStage; cursor?: string; limit?: number },
): Promise<{ items: AdminTenantListItem[]; nextCursor?: string }> {
  const limit = opts.limit ?? 30;
  const cursor = decodeCursor(opts.cursor);
  const conds = [sql`true`];
  if (opts.stage) conds.push(sql`t.lifecycle_stage = ${opts.stage}`);
  const q = opts.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    const phone = normalizePhone(q);
    conds.push(sql`(t.name ilike ${like} or t.slug ilike ${like}${
      phone
        ? sql` or t.phone = ${phone} or exists (select 1 from memberships m join users u on u.id = m.user_id
                where m.tenant_id = t.id and m.role = 'owner' and u.phone = ${phone})`
        : sql``
    })`);
  }
  if (cursor) conds.push(cursorWhere(sql`t.created_at`, sql`t.id`, cursor));

  const list = await rows<ListRow>(
    db,
    sql`select t.id, t.name, t.slug, t.lifecycle_stage, t.plan_code, t.suspension_reason, t.ordering_enabled, t.is_demo,
               t.trial_ends_at, t.live_at, t.created_at, t.wa_mode, t.wa_code, b.city, b.district,
               (select max(o.placed_at) from orders o where o.tenant_id = t.id and o.test_kind is null) as last_order_at,
               (select count(*)::int from orders o
                 where o.tenant_id = t.id and o.test_kind is null and o.status <> 'awaiting_customer'
                   and o.placed_at >= now() - interval '7 days') as orders_7d,
               (select case when bool_or(w.status = 'error') then 'error'
                            when bool_or(w.status = 'disconnected') then 'disconnected'
                            when bool_or(w.status = 'connected') then 'connected' end
                  from wa_accounts w where w.tenant_id = t.id) as wa_status
          from tenants t
          left join lateral (select city, district from branches where tenant_id = t.id order by created_at limit 1) b on true
         where ${sql.join(conds, sql` and `)}
         order by date_trunc('milliseconds', t.created_at) desc, t.id desc
         limit ${limit + 1}`,
  );

  const mapped: AdminTenantListItem[] = list.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    lifecycleStage: r.lifecycle_stage,
    planCode: r.plan_code,
    suspensionReason: r.suspension_reason,
    orderingEnabled: r.ordering_enabled,
    isDemo: r.is_demo,
    city: r.city,
    district: r.district,
    trialEndsAt: isoOrNull(r.trial_ends_at),
    liveAt: isoOrNull(r.live_at),
    createdAt: iso(r.created_at),
    lastOrderAt: isoOrNull(r.last_order_at),
    orders7d: Number(r.orders_7d ?? 0),
    waStatus: r.wa_status,
    waMode: r.wa_mode,
    waCode: r.wa_code,
  }));
  return paginate(mapped, limit, (t) => ({ at: t.createdAt, id: t.id }));
}

export async function listTenantOrders(
  db: Database,
  tenantId: string,
  opts: { cursor?: string; limit?: number; status?: OrderRow['status'] },
): Promise<{ items: AdminOrderRow[]; nextCursor?: string }> {
  const limit = opts.limit ?? 30;
  const cursor = decodeCursor(opts.cursor);
  const conds = [eq(orders.tenantId, tenantId)];
  if (opts.status) conds.push(eq(orders.status, opts.status));
  if (cursor) conds.push(cursorWhere(orders.placedAt, orders.id, cursor));
  const list = await db
    .select()
    .from(orders)
    .where(and(...conds))
    .orderBy(...cursorOrder(orders.placedAt, orders.id))
    .limit(limit + 1);
  return paginate(list.map(toAdminOrderRow), limit, (o) => ({ at: o.placedAt, id: o.id }));
}

export async function loadNotes(db: Database, tenantId: string, limit = 100): Promise<AdminNote[]> {
  const list = await db
    .select({
      id: adminNotes.id,
      tenantId: adminNotes.tenantId,
      body: adminNotes.body,
      tags: adminNotes.tags,
      authorUserId: adminNotes.authorUserId,
      authorName: users.name,
      createdAt: adminNotes.createdAt,
    })
    .from(adminNotes)
    .leftJoin(users, eq(users.id, adminNotes.authorUserId))
    .where(eq(adminNotes.tenantId, tenantId))
    .orderBy(desc(adminNotes.createdAt), desc(adminNotes.id))
    .limit(limit);
  return list.map((n) => ({ ...n, authorName: n.authorName ?? null, createdAt: iso(n.createdAt) }));
}

/** Rolün bu aşamadan yapabileceği geçişler (arayüz için; karar yine API'de). */
export function allowedTransitions(
  role: PlatformRole | null,
  from: LifecycleStage,
  suspensionReason: SuspensionReason | null,
): LifecycleStage[] {
  return LIFECYCLE_STAGES.filter((to) => {
    if (!LIFECYCLE_TRANSITIONS[from].includes(to)) return false;
    const perm = lifecycleTransitionPermission(from, to);
    if (!adminCan(role, perm)) return false;
    // F yalnız ödeme kaynaklı askıyı kaldırır
    if (perm === 'tenants:unsuspend' && role === 'finance' && suspensionReason !== 'payment') return false;
    return true;
  });
}

export async function loadTenantDetail(db: Database, tenantId: string, viewerRole: PlatformRole | null): Promise<AdminTenantDetail | null> {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) return null;
  const now = new Date();

  const sub = await currentSubscription(db, tenantId);

  const branchRows = await db.select().from(branches).where(eq(branches.tenantId, tenantId)).orderBy(asc(branches.createdAt));
  const schedules = await loadSchedules(db, branchRows, now);

  const memberRows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: memberships.role,
      branchId: memberships.branchId,
      lastLoginAt: users.lastLoginAt,
      disabledAt: memberships.disabledAt,
      userDisabledAt: users.disabledAt,
      totp: users.totpSecretEnc,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId))
    .orderBy(asc(memberships.createdAt));

  const recent = await db
    .select()
    .from(orders)
    .where(eq(orders.tenantId, tenantId))
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(20);

  const [stats] = await rows<{
    orders_total: number;
    orders_7d: number;
    last_order_at: string | null;
    delivered_30d: number;
    revenue_30d: number;
    missed_30d: number;
  }>(
    db,
    sql`select count(*) filter (where status <> 'awaiting_customer')::int as orders_total,
               count(*) filter (where status <> 'awaiting_customer' and placed_at >= now() - interval '7 days')::int as orders_7d,
               max(placed_at) as last_order_at,
               count(*) filter (where status = 'delivered' and placed_at >= now() - interval '30 days')::int as delivered_30d,
               coalesce(sum(total_kurus) filter (where status = 'delivered' and placed_at >= now() - interval '30 days'), 0)::int as revenue_30d,
               count(*) filter (where status = 'cancelled' and cancel_reason = 'tenant_no_response'
                                  and placed_at >= now() - interval '30 days')::int as missed_30d
          from orders where tenant_id = ${tenantId} and test_kind is null`,
  );

  const impersonator = alias(users, 'impersonator');
  const imps = await db
    .select({ sessionId: sessions.id, impersonatorName: impersonator.name, expiresAt: sessions.expiresAt })
    .from(sessions)
    .leftJoin(impersonator, eq(impersonator.id, sessions.impersonatorUserId))
    .where(and(eq(sessions.tenantId, tenantId), eq(sessions.kind, 'impersonation'), gt(sessions.expiresAt, now)))
    .orderBy(desc(sessions.createdAt));

  // Ortak numarada QR bağlantısı (satırın gösterim numarası = platform numarası; syncSharedWaAccounts)
  const [sharedAcc] =
    t.waMode === 'shared'
      ? await db
          .select({ displayPhone: waAccounts.displayPhone })
          .from(waAccounts)
          .where(and(eq(waAccounts.tenantId, tenantId), eq(waAccounts.provider, 'shared')))
          .limit(1)
      : [];

  return {
    tenant: {
      id: t.id,
      name: t.name,
      slug: t.slug,
      legalName: t.legalName ?? null,
      taxNo: t.taxNo ?? null,
      taxOffice: t.taxOffice ?? null,
      phone: t.phone ?? null,
      email: t.email ?? null,
      address: t.address ?? null,
      lifecycleStage: t.lifecycleStage,
      suspensionReason: t.suspensionReason ?? null,
      orderingEnabled: t.orderingEnabled,
      smsFallbackEnabled: t.smsFallbackEnabled,
      botEnabled: t.botEnabled,
      planCode: t.planCode,
      trialEndsAt: isoOrNull(t.trialEndsAt),
      liveAt: isoOrNull(t.liveAt),
      webLiveAt: isoOrNull(t.webLiveAt),
      isDemo: t.isDemo,
      waMode: t.waMode,
      waCode: t.waCode ?? null,
      sharedWaLink: sharedAcc?.displayPhone && t.waCode ? sharedWaLink(sharedAcc.displayPhone, t.name, t.waCode) : null,
      createdAt: iso(t.createdAt),
      updatedAt: iso(t.updatedAt),
    },
    subscription: sub
      ? {
          id: sub.id,
          planCode: sub.planCode,
          status: sub.status,
          trialEndsAt: isoOrNull(sub.trialEndsAt),
          currentPeriodEnd: isoOrNull(sub.currentPeriodEnd),
          founderDiscountBp: sub.founderDiscountBp ?? null,
          notes: sub.notes ?? null,
          updatedAt: iso(sub.updatedAt),
        }
      : null,
    branches: branchRows.map((b) => {
      const st = stateOf(schedules.get(b.id), now);
      return {
        id: b.id,
        name: b.name,
        city: b.city,
        district: b.district,
        neighborhood: b.neighborhood ?? null,
        phone: b.phone ?? null,
        orderingState: st.state,
        isOpenBySchedule: st.isOpenBySchedule,
        pausedUntil: isoOrNull(b.pausedUntil && b.pausedUntil > now ? b.pausedUntil : null),
        busyExtraMinutes: b.busyExtraMinutes,
        acceptsDelivery: b.acceptsDelivery,
        acceptsPickup: b.acceptsPickup,
      };
    }),
    members: memberRows.map((m) => ({
      userId: m.userId,
      name: m.name,
      email: m.email ?? null,
      phone: m.phone ? formatPhone(m.phone) : null,
      role: m.role,
      branchId: m.branchId ?? null,
      lastLoginAt: isoOrNull(m.lastLoginAt),
      disabled: Boolean(m.disabledAt || m.userDisabledAt),
      hasTotp: Boolean(m.totp),
    })),
    waAccounts: await loadWaHealth(db, { tenantId, now }),
    recentOrders: recent.map(toAdminOrderRow),
    stats: {
      ordersTotal: Number(stats?.orders_total ?? 0),
      orders7d: Number(stats?.orders_7d ?? 0),
      lastOrderAt: isoOrNull(stats?.last_order_at ?? null),
      delivered30d: Number(stats?.delivered_30d ?? 0),
      revenue30dKurus: Number(stats?.revenue_30d ?? 0),
      missed30d: Number(stats?.missed_30d ?? 0),
    },
    notes: await loadNotes(db, tenantId, 20),
    activeImpersonations: imps.map((i) => ({ sessionId: i.sessionId, impersonatorName: i.impersonatorName ?? null, expiresAt: iso(i.expiresAt) })),
    allowedLifecycleTransitions: allowedTransitions(viewerRole, t.lifecycleStage, t.suspensionReason ?? null),
  };
}

/** Güncel abonelik satırı: iptal edilmemiş olan, yoksa en yenisi. */
export async function currentSubscription(tx: Database, tenantId: string) {
  const [sub] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .orderBy(sql`case when ${subscriptions.status} = 'cancelled' then 1 else 0 end`, desc(subscriptions.createdAt))
    .limit(1);
  return sub;
}
