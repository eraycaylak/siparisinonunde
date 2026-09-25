// Panel varlığı ve "panel çevrimdışı" dedektörü (06 §7.7, 04 §4.17; 00 §10 "Sipariş kaçmaz").
//
// - touchBranchPresence: sipariş ekranının SSE akışı açıkken bağlanınca ve dakikada bir çağrılır (ucuz UPSERT,
//   20 sn'den sık yazmaz). Yalnız yeni siparişi duyan roller sayılır (sahip, yönetici, kasiyer); mutfak yeni sipariş
//   alarmını görmez, destek oturumu (impersonation) işletmenin cihazı değildir, kurye akış açamaz.
// - detectOfflinePanels (cron.panel_presence, dakikada bir): şu an sipariş alan şubede (çalışma saati içinde,
//   duraklatılmamış, ordering_enabled, web canlı) sipariş ekranı 5 dk'dır görülmüyorsa ya da şube açılalı ≥ 10 dk
//   olduğu hâlde açılıştan beri hiç görülmediyse sahibine platform.alert (`panel_offline`) gider. Şube başına 60 dk'da
//   en çok bir uyarı (offline_alerted_at). Aday/kurulumdaki/salt-okunur/askıdaki/kapanmış ve demo işletmelerde çalışmaz.

import { acceptsOrders, computeOrderingState, localDateString, scheduleIntervals, type LifecycleStage, type ScheduleInput, type TenantRole } from '@siparis/core';
import { branchPanelPresence, branches, openingHours, specialDays, tenants, type Database } from '@siparis/db';
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray, or } from 'drizzle-orm';
import { enqueueJob } from '../../lib/jobs';

/** SSE açıkken varlık yenileme aralığı. */
export const PANEL_PRESENCE_TOUCH_MS = 60_000;
/** Bu süredir görülmeyen sipariş ekranı çevrimdışı sayılır. */
export const PANEL_OFFLINE_AFTER_MS = 5 * 60_000;
/** Açılıştan beri hiç görülmemiş şubede uyarıdan önceki pay (personel paneli açsın). */
export const PANEL_NEVER_SEEN_GRACE_MS = 10 * 60_000;
/** Şube başına en sık uyarı aralığı. */
export const PANEL_OFFLINE_ALERT_EVERY_MS = 60 * 60_000;
/** Aynı şubeye bu süreden sık yazılmaz (çok sekme/cihaz). */
const PRESENCE_WRITE_THROTTLE_MS = 20_000;

/** Varlığı sayılan roller: yeni sipariş alarmını duyan panel kullanıcıları. */
export const PRESENCE_ROLES: readonly TenantRole[] = ['owner', 'manager', 'cashier'];

/** Dedektörün hiç çalışmadığı yaşam döngüsü aşamaları (canlı sipariş almayan ya da kurulumdaki işletmeler). */
const SKIPPED_STAGES: LifecycleStage[] = ['lead', 'onboarding', 'read_only', 'suspended', 'churned'];

/** Sipariş ekranı görüldü (UPSERT; son yazımdan 20 sn geçmediyse dokunmaz). */
export async function touchBranchPresence(db: Database, input: { tenantId: string; branchId: string }, now: Date = new Date()): Promise<void> {
  const throttleBefore = new Date(now.getTime() - PRESENCE_WRITE_THROTTLE_MS);
  await db
    .insert(branchPanelPresence)
    .values({ branchId: input.branchId, tenantId: input.tenantId, lastSeenAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: branchPanelPresence.branchId,
      set: { lastSeenAt: now, updatedAt: now },
      setWhere: and(
        eq(branchPanelPresence.tenantId, input.tenantId),
        or(isNull(branchPanelPresence.lastSeenAt), lt(branchPanelPresence.lastSeenAt, throttleBefore)),
      ),
    });
}

export interface PanelOfflineAlert {
  tenantId: string;
  branchId: string;
  /** Uyarıdaki dakika (son görülmeden ya da açılıştan beri) */
  minutes: number;
}

type Row = {
  branchId: string;
  tenantId: string;
  timezone: string;
  pausedUntil: Date | null;
  busyExtraMinutes: number;
  lastSeenAt: Date | null;
};

/**
 * Şu an sipariş alan ve sipariş ekranı görülmeyen şubeleri bulur, her birine (60 dk'da en çok 1) platform.alert
 * `panel_offline` işini kuyruğa atar. Uyarı atılan şubeleri döner.
 */
export async function detectOfflinePanels(db: Database, now: Date = new Date()): Promise<PanelOfflineAlert[]> {
  const staleBefore = new Date(now.getTime() - PANEL_OFFLINE_AFTER_MS);
  const alertBefore = new Date(now.getTime() - PANEL_OFFLINE_ALERT_EVERY_MS);

  const rows: Row[] = await db
    .select({
      branchId: branches.id,
      tenantId: branches.tenantId,
      timezone: branches.timezone,
      pausedUntil: branches.pausedUntil,
      busyExtraMinutes: branches.busyExtraMinutes,
      lastSeenAt: branchPanelPresence.lastSeenAt,
    })
    .from(branches)
    .innerJoin(tenants, eq(tenants.id, branches.tenantId))
    .leftJoin(branchPanelPresence, eq(branchPanelPresence.branchId, branches.id))
    .where(
      and(
        eq(tenants.orderingEnabled, true),
        isNotNull(tenants.webLiveAt),
        eq(tenants.isDemo, false),
        notInArray(tenants.lifecycleStage, SKIPPED_STAGES),
        or(isNull(branches.pausedUntil), lte(branches.pausedUntil, now)),
        or(isNull(branchPanelPresence.lastSeenAt), lt(branchPanelPresence.lastSeenAt, staleBefore)),
        or(isNull(branchPanelPresence.offlineAlertedAt), lt(branchPanelPresence.offlineAlertedAt, alertBefore)),
      ),
    );
  if (!rows.length) return [];

  const ids = rows.map((r) => r.branchId);
  const hours = await db
    .select({ branchId: openingHours.branchId, weekday: openingHours.weekday, opensAt: openingHours.opensAt, closesAt: openingHours.closesAt })
    .from(openingHours)
    .where(inArray(openingHours.branchId, ids));
  // Dünden bugüne özel günler (gece yarısını aşan aralıklar için bir gün öncesi de gerekir)
  const fromDate = localDateString(new Date(now.getTime() - 2 * 86_400_000), 'UTC');
  const days = await db
    .select({ branchId: specialDays.branchId, date: specialDays.date, isClosed: specialDays.isClosed, opensAt: specialDays.opensAt, closesAt: specialDays.closesAt })
    .from(specialDays)
    .where(and(inArray(specialDays.branchId, ids), gte(specialDays.date, fromDate)));

  const alerts: PanelOfflineAlert[] = [];
  for (const row of rows) {
    const input: ScheduleInput = {
      timezone: row.timezone || 'Europe/Istanbul',
      hours: hours.filter((h) => h.branchId === row.branchId),
      specialDays: days.filter((d) => d.branchId === row.branchId),
      pausedUntil: row.pausedUntil,
      busyExtraMinutes: row.busyExtraMinutes,
    };
    if (!acceptsOrders(computeOrderingState(input, now).state)) continue;
    const current = scheduleIntervals(input, now, 1).find((iv) => iv.start <= now && now < iv.end);
    if (!current) continue;
    // Sipariş almaya başladığı an: açılış ya da (daha geçse) biten duraklatma
    const since = row.pausedUntil && row.pausedUntil > current.start && row.pausedUntil <= now ? row.pausedUntil : current.start;

    let minutes: number;
    if (row.lastSeenAt && row.lastSeenAt >= since) {
      // Açılıştan sonra görülmüş, 5 dk'dır görülmüyor (sorgu süzdü)
      minutes = Math.floor((now.getTime() - row.lastSeenAt.getTime()) / 60_000);
    } else {
      const openFor = now.getTime() - since.getTime();
      if (openFor < PANEL_NEVER_SEEN_GRACE_MS) continue;
      minutes = Math.floor(openFor / 60_000);
    }

    const claimed = await db.transaction(async (tx) => {
      // Tekillik: yalnız son uyarıdan 60 dk geçtiyse ve hâlâ görülmüyorsa (bu arada panel açıldıysa dokunulmaz)
      const [claim] = await tx
        .insert(branchPanelPresence)
        .values({ branchId: row.branchId, tenantId: row.tenantId, lastSeenAt: null, offlineAlertedAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: branchPanelPresence.branchId,
          set: { offlineAlertedAt: now, updatedAt: now },
          setWhere: and(
            or(isNull(branchPanelPresence.offlineAlertedAt), lt(branchPanelPresence.offlineAlertedAt, alertBefore)),
            or(isNull(branchPanelPresence.lastSeenAt), lt(branchPanelPresence.lastSeenAt, staleBefore)),
          ),
        })
        .returning({ branchId: branchPanelPresence.branchId });
      if (!claim) return false;
      await enqueueJob(tx, {
        queue: 'notify',
        type: 'platform.alert',
        tenantId: row.tenantId,
        dedupeKey: `platform_alert:panel_offline:${row.branchId}:${Math.floor(now.getTime() / PANEL_OFFLINE_ALERT_EVERY_MS)}`,
        payload: { tenantId: row.tenantId, branchId: row.branchId, kind: 'panel_offline', minutes },
      });
      return true;
    });
    if (claimed) alerts.push({ tenantId: row.tenantId, branchId: row.branchId, minutes });
  }
  return alerts;
}
