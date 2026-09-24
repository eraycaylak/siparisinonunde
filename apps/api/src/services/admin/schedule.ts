// Şube çalışma saatleri → ordering_state (core/hours). Admin görünümleri için toplu yükleme.

import { computeOrderingState, isOpenAt, localDateString, type OrderingStateResult, type ScheduleInput } from '@siparis/core';
import { branches, openingHours, specialDays, type Database } from '@siparis/db';
import { and, gte, inArray } from 'drizzle-orm';

type BranchRow = typeof branches.$inferSelect;

export async function loadSchedules(
  db: Database,
  branchRows: Pick<BranchRow, 'id' | 'timezone' | 'pausedUntil' | 'busyExtraMinutes'>[],
  now: Date = new Date(),
): Promise<Map<string, ScheduleInput>> {
  const out = new Map<string, ScheduleInput>();
  if (!branchRows.length) return out;
  const ids = branchRows.map((b) => b.id);
  const hours = await db
    .select({ branchId: openingHours.branchId, weekday: openingHours.weekday, opensAt: openingHours.opensAt, closesAt: openingHours.closesAt })
    .from(openingHours)
    .where(inArray(openingHours.branchId, ids));
  // Dünden itibaren özel günler (gece yarısını aşan aralıklar için)
  const from = localDateString(new Date(now.getTime() - 86400000));
  const specials = await db
    .select({
      branchId: specialDays.branchId,
      date: specialDays.date,
      isClosed: specialDays.isClosed,
      opensAt: specialDays.opensAt,
      closesAt: specialDays.closesAt,
    })
    .from(specialDays)
    .where(and(inArray(specialDays.branchId, ids), gte(specialDays.date, from)));
  for (const b of branchRows) {
    out.set(b.id, {
      timezone: b.timezone,
      hours: hours.filter((h) => h.branchId === b.id),
      specialDays: specials.filter((s) => s.branchId === b.id),
      pausedUntil: b.pausedUntil,
      busyExtraMinutes: b.busyExtraMinutes,
    });
  }
  return out;
}

const CLOSED: OrderingStateResult = {
  state: 'closed',
  isOpenBySchedule: false,
  nextOpenAt: null,
  closesAt: null,
  pausedUntil: null,
  busyExtraMinutes: 0,
};

export function stateOf(schedule: ScheduleInput | undefined, now: Date = new Date()): OrderingStateResult {
  if (!schedule) return CLOSED;
  try {
    return computeOrderingState(schedule, now);
  } catch {
    return CLOSED;
  }
}

/** Şube hem şimdi hem `windowMs` önce çalışma saatindeyse true ("açık saatte" sessizlik ölçümü). */
export function openThroughout(schedule: ScheduleInput | undefined, windowMs: number, now: Date = new Date()): boolean {
  if (!schedule) return false;
  try {
    return isOpenAt(schedule, now) && isOpenAt(schedule, new Date(now.getTime() - windowMs)) && isOpenAt(schedule, new Date(now.getTime() - windowMs / 2));
  } catch {
    return false;
  }
}
