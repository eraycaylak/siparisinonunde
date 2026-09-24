// Kontrol paneli (05 A-02): "şu an ne bozuk" ve "iş nasıl gidiyor". Test siparişleri hariç (05 §A.5).

import type { AdminOverview } from '@siparis/core/admin/contracts';
import { LIFECYCLE_STAGES, type LifecycleStage } from '@siparis/core';
import type { Database } from '@siparis/db';
import { sql } from 'drizzle-orm';
import { iso, isoOrNull, rows } from './util';
import { loadWaHealth } from './wa-health';

/** Geç onay eşiği (05 §A.5 "Geç onay oranı": new'de 2 dk'dan uzun). */
const LATE_NEW_SECONDS = 120;

export async function loadOverview(db: Database, now: Date = new Date()): Promise<AdminOverview> {
  const nowIso = now.toISOString();

  const stageRows = await rows<{ stage: LifecycleStage; n: number }>(
    db,
    sql`select lifecycle_stage as stage, count(*)::int as n from tenants group by lifecycle_stage`,
  );
  const tenantsByStage = Object.fromEntries(LIFECYCLE_STAGES.map((s) => [s, 0])) as Record<LifecycleStage, number>;
  for (const r of stageRows) tenantsByStage[r.stage] = Number(r.n);
  const tenantsTotal = Object.values(tenantsByStage).reduce((a, b) => a + b, 0);

  // Bugün = Europe/Istanbul yerel günü
  const [orderStats] = await rows<{ orders_today: number; revenue_today: number; open_new: number; late_new: number; missed_24h: number }>(
    db,
    sql`with day as (
          select (date_trunc('day', ${nowIso}::timestamptz at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul') as start
        )
        select
          count(*) filter (where o.placed_at >= day.start and o.status <> 'awaiting_customer')::int as orders_today,
          coalesce(sum(o.total_kurus) filter (
            where o.placed_at >= day.start and o.status not in ('awaiting_customer', 'rejected', 'cancelled')), 0)::bigint as revenue_today,
          count(*) filter (where o.status = 'new' and o.rejection_scheduled_at is null)::int as open_new,
          count(*) filter (where o.status = 'new' and o.rejection_scheduled_at is null
                             and o.placed_at < ${nowIso}::timestamptz - make_interval(secs => ${LATE_NEW_SECONDS}))::int as late_new,
          count(*) filter (where o.status = 'cancelled' and o.cancel_reason = 'tenant_no_response'
                             and coalesce(o.cancelled_at, o.updated_at) >= ${nowIso}::timestamptz - interval '24 hours')::int as missed_24h
          from orders o, day
         where o.test_kind is null
           and (o.placed_at >= day.start or o.status = 'new'
                or (o.status = 'cancelled' and coalesce(o.cancelled_at, o.updated_at) >= ${nowIso}::timestamptz - interval '24 hours'))`,
  );

  const [jobStats] = await rows<{ failed: number; pending: number; oldest_pending: string | null }>(
    db,
    sql`select count(*) filter (where status = 'failed')::int as failed,
               count(*) filter (where status = 'pending' and run_at <= ${nowIso}::timestamptz)::int as pending,
               min(run_at) filter (where status = 'pending' and run_at <= ${nowIso}::timestamptz) as oldest_pending
          from jobs where status in ('failed', 'pending')`,
  );

  const [tenantStats] = await rows<{ new_7d: number }>(
    db,
    sql`select count(*)::int as new_7d from tenants where created_at >= ${nowIso}::timestamptz - interval '7 days'`,
  );
  const [leadStats] = await rows<{ total: number; fresh: number }>(
    db,
    sql`select count(*)::int as total, count(*) filter (where status = 'new')::int as fresh from leads`,
  );

  const missed = await rows<{ id: string; tenant_id: string; tenant_name: string; number: number; cancelled_at: string | null }>(
    db,
    sql`select o.id, o.tenant_id, t.name as tenant_name, o.number, o.cancelled_at
          from orders o join tenants t on t.id = o.tenant_id
         where o.test_kind is null and o.status = 'cancelled' and o.cancel_reason = 'tenant_no_response'
           and coalesce(o.cancelled_at, o.updated_at) >= ${nowIso}::timestamptz - interval '24 hours'
         order by coalesce(o.cancelled_at, o.updated_at) desc
         limit 10`,
  );

  const failedJobs = await rows<{
    id: string;
    queue: string;
    type: string;
    last_error: string | null;
    tenant_id: string | null;
    tenant_name: string | null;
    updated_at: string;
  }>(
    db,
    sql`select j.id, j.queue, j.type, j.last_error, j.tenant_id, t.name as tenant_name, j.updated_at
          from jobs j left join tenants t on t.id = j.tenant_id
         where j.status = 'failed'
         order by j.updated_at desc
         limit 5`,
  );

  const newLeads = await rows<{ id: string; name: string | null; business_name: string | null; city: string | null; source: string; created_at: string }>(
    db,
    sql`select id, name, business_name, city, source, created_at from leads where status = 'new' order by created_at desc limit 5`,
  );

  const wa = await loadWaHealth(db, { now });
  const waProblems = wa.filter((a) => a.status === 'error' || a.silent);

  const oldest = jobStats?.oldest_pending ? new Date(jobStats.oldest_pending) : null;

  return {
    generatedAt: nowIso,
    tenantsTotal,
    tenantsByStage,
    newTenants7d: Number(tenantStats?.new_7d ?? 0),
    ordersToday: Number(orderStats?.orders_today ?? 0),
    revenueTodayKurus: Number(orderStats?.revenue_today ?? 0),
    openNewOrders: Number(orderStats?.open_new ?? 0),
    lateNewOrders: Number(orderStats?.late_new ?? 0),
    missedOrders24h: Number(orderStats?.missed_24h ?? 0),
    failedJobs: Number(jobStats?.failed ?? 0),
    pendingJobs: Number(jobStats?.pending ?? 0),
    oldestPendingJobAgeSec: oldest ? Math.max(0, Math.round((now.getTime() - oldest.getTime()) / 1000)) : null,
    waErrorAccounts: wa.filter((a) => a.status === 'error').length,
    waSilentAccounts: wa.filter((a) => a.silent).length,
    leadsTotal: Number(leadStats?.total ?? 0),
    leadsNew: Number(leadStats?.fresh ?? 0),
    alerts: {
      missedOrders: missed.map((m) => ({
        orderId: m.id,
        tenantId: m.tenant_id,
        tenantName: m.tenant_name,
        number: Number(m.number),
        cancelledAt: isoOrNull(m.cancelled_at),
      })),
      waProblems: waProblems.slice(0, 10).map((a) => ({
        waAccountId: a.id,
        tenantId: a.tenantId,
        tenantName: a.tenantName,
        status: a.status,
        lastError: a.lastError,
        lastWebhookAt: a.lastWebhookAt,
        silent: a.silent,
      })),
      failedJobs: failedJobs.map((j) => ({
        id: j.id,
        queue: j.queue,
        type: j.type,
        lastError: j.last_error ? j.last_error.slice(0, 300) : null,
        tenantId: j.tenant_id,
        tenantName: j.tenant_name,
        updatedAt: iso(j.updated_at),
      })),
      newLeads: newLeads.map((l) => ({
        id: l.id,
        name: l.name,
        businessName: l.business_name,
        city: l.city,
        source: l.source,
        createdAt: iso(l.created_at),
      })),
    },
  };
}
