// WhatsApp sağlık görünümü (05 A-06): hesap durumu, son webhook, son 24 sa mesaj sayıları, sessizlik.

import type { AdminWaAccount } from '@siparis/core/admin/contracts';
import { maskPhone, type WaAccountStatus, type WaProvider } from '@siparis/core';
import { branches, tenants, waAccounts, type Database } from '@siparis/db';
import { eq, sql } from 'drizzle-orm';
import { loadSchedules, openThroughout, stateOf } from './schedule';
import { isoOrNull, rows } from './util';

/** "Sessizlik": açık saatte bu süredir webhook yok (görev tanımı: 2 sa). */
export const WA_SILENCE_MS = 2 * 60 * 60 * 1000;

const HEALTH_ORDER = { red: 0, yellow: 1, green: 2 } as const;

export async function loadWaHealth(db: Database, opts: { tenantId?: string; now?: Date } = {}): Promise<AdminWaAccount[]> {
  const now = opts.now ?? new Date();
  const base = db
    .select({
      id: waAccounts.id,
      tenantId: waAccounts.tenantId,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      branchId: waAccounts.branchId,
      branchName: branches.name,
      provider: waAccounts.provider,
      displayPhone: waAccounts.displayPhone,
      status: waAccounts.status,
      lastWebhookAt: waAccounts.lastWebhookAt,
      lastError: waAccounts.lastError,
      timezone: branches.timezone,
      pausedUntil: branches.pausedUntil,
      busyExtraMinutes: branches.busyExtraMinutes,
    })
    .from(waAccounts)
    .innerJoin(tenants, eq(tenants.id, waAccounts.tenantId))
    .innerJoin(branches, eq(branches.id, waAccounts.branchId));
  const accounts = opts.tenantId ? await base.where(eq(waAccounts.tenantId, opts.tenantId)) : await base;
  if (!accounts.length) return [];

  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const counts = await rows<{ wa_account_id: string; inbound: number; outbound: number; failed: number }>(
    db,
    sql`select c.wa_account_id,
               count(*) filter (where m.direction = 'in')::int as inbound,
               count(*) filter (where m.direction = 'out')::int as outbound,
               count(*) filter (where m.status = 'failed')::int as failed
          from messages m
          join conversations c on c.id = m.conversation_id
         where m.created_at >= ${since}::timestamptz
           ${opts.tenantId ? sql`and m.tenant_id = ${opts.tenantId}` : sql``}
         group by c.wa_account_id`,
  );
  const byAccount = new Map(counts.map((c) => [c.wa_account_id, c]));

  const schedules = await loadSchedules(
    db,
    accounts.map((a) => ({ id: a.branchId, timezone: a.timezone, pausedUntil: a.pausedUntil, busyExtraMinutes: a.busyExtraMinutes })),
    now,
  );

  const items: AdminWaAccount[] = accounts.map((a) => {
    const c = byAccount.get(a.id);
    const schedule = schedules.get(a.branchId);
    const branchOpen = stateOf(schedule, now).isOpenBySchedule;
    const quietSince = a.lastWebhookAt ? now.getTime() - a.lastWebhookAt.getTime() : Number.POSITIVE_INFINITY;
    // Ortak numarada webhook platformundur; tek dükkana mesaj gelmemesi bağlantı sorunu değildir (sessizlik sayılmaz)
    const silent = a.provider !== 'shared' && a.status === 'connected' && quietSince > WA_SILENCE_MS && openThroughout(schedule, WA_SILENCE_MS, now);
    const failed24h = c?.failed ?? 0;
    const health: AdminWaAccount['health'] =
      a.status === 'error' ? 'red' : silent || a.status === 'disconnected' || failed24h > 0 ? 'yellow' : 'green';
    return {
      id: a.id,
      tenantId: a.tenantId,
      tenantName: a.tenantName,
      tenantSlug: a.tenantSlug,
      branchId: a.branchId,
      branchName: a.branchName,
      provider: a.provider as WaProvider,
      displayPhoneMasked: a.displayPhone ? maskPhone(a.displayPhone) : null,
      status: a.status as WaAccountStatus,
      lastWebhookAt: isoOrNull(a.lastWebhookAt),
      lastError: a.lastError ?? null,
      inbound24h: c?.inbound ?? 0,
      outbound24h: c?.outbound ?? 0,
      failed24h,
      silent,
      branchOpen,
      health,
    };
  });

  // Kırmızılar üstte (05 A-06), sonra sessizler, sonra ada göre
  items.sort(
    (x, y) =>
      HEALTH_ORDER[x.health] - HEALTH_ORDER[y.health] ||
      Number(y.silent) - Number(x.silent) ||
      x.tenantName.localeCompare(y.tenantName, 'tr'),
  );
  return items;
}
