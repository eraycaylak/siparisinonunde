// Şube ayarları (04 §7.3–§7.10): bilgiler, ödeme, durum mesajları, alarm politikası, fiş; saatler, özel günler,
// sipariş alma durumu (duraklat/yoğun) ve branch.state SSE olayı.

import {
  computeOrderingState,
  endOfLocalDay,
  localDateString,
  normalizePhone,
  type OrderingStateResult,
  type ScheduleInput,
} from '@siparis/core';
import {
  DEFAULT_RECEIPT_SETTINGS,
  LOCKED_STATUS_MESSAGES,
  type BranchPatch,
  type BranchSettings,
  type BranchState,
  type HoursPut,
  type SpecialDayDto,
} from '@siparis/core/settings/contracts';
import { validateAlarmPolicy, validateWeeklyHours, isValidDateString } from '@siparis/core/settings/validation';
import {
  DEFAULT_ALARM_POLICY,
  DEFAULT_STATUS_MESSAGES,
  branches,
  openingHours,
  specialDays,
  type AlarmPolicy,
  type Database,
  type ReceiptSettings,
  type StatusMessagesSetting,
} from '@siparis/db';
import { and, asc, eq, gte } from 'drizzle-orm';
import { appendBranchEvent } from '../../lib/events';
import { conflict, notFound } from '../../lib/errors';
import { assertNoIssues, isoOrNull, isUniqueViolation, validationError } from './common';

export type BranchRow = typeof branches.$inferSelect;
export type SpecialDayRow = typeof specialDays.$inferSelect;

function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export async function loadHours(db: Database, branchId: string) {
  return db
    .select({ weekday: openingHours.weekday, opensAt: openingHours.opensAt, closesAt: openingHours.closesAt })
    .from(openingHours)
    .where(eq(openingHours.branchId, branchId))
    .orderBy(asc(openingHours.weekday), asc(openingHours.opensAt));
}

/** Bugünden (dün dahil) itibaren özel günler. */
export async function loadSpecialDays(db: Database, branch: Pick<BranchRow, 'id' | 'timezone'>, now = new Date(), fromDaysAgo = 1) {
  const from = addDaysStr(localDateString(now, branch.timezone), -fromDaysAgo);
  return db
    .select()
    .from(specialDays)
    .where(and(eq(specialDays.branchId, branch.id), gte(specialDays.date, from)))
    .orderBy(asc(specialDays.date));
}

export async function scheduleInputFor(db: Database, branch: BranchRow, now = new Date()): Promise<ScheduleInput> {
  const [hours, days] = await Promise.all([loadHours(db, branch.id), loadSpecialDays(db, branch, now)]);
  return {
    timezone: branch.timezone,
    hours,
    specialDays: days.map((d) => ({ date: d.date, isClosed: d.isClosed, opensAt: d.opensAt, closesAt: d.closesAt })),
    pausedUntil: branch.pausedUntil,
    busyExtraMinutes: branch.busyExtraMinutes,
  };
}

export function toBranchState(r: OrderingStateResult): BranchState {
  return {
    orderingState: r.state,
    pausedUntil: isoOrNull(r.pausedUntil),
    busyExtraMinutes: r.busyExtraMinutes,
    nextOpenAt: isoOrNull(r.nextOpenAt),
    closesAt: isoOrNull(r.closesAt),
    isOpenBySchedule: r.isOpenBySchedule,
  };
}

export async function computeBranchState(db: Database, branch: BranchRow, now = new Date()): Promise<{ state: BranchState; raw: OrderingStateResult }> {
  const raw = computeOrderingState(await scheduleInputFor(db, branch, now), now);
  return { state: toBranchState(raw), raw };
}

/** Durumu hesaplayıp 'branch.state' olayını (14 §7.1, BranchStatePayload) aynı transaction'da yazar. */
export async function emitBranchState(tx: Database, branch: BranchRow, now = new Date()): Promise<BranchState> {
  const { state } = await computeBranchState(tx, branch, now);
  await appendBranchEvent(tx, {
    tenantId: branch.tenantId,
    branchId: branch.id,
    type: 'branch.state',
    payload: {
      orderingState: state.orderingState,
      pausedUntil: state.pausedUntil,
      busyExtraMinutes: state.busyExtraMinutes,
      nextOpenAt: state.nextOpenAt,
    },
  });
  return state;
}

export function toSpecialDayDto(d: SpecialDayRow): SpecialDayDto {
  return { id: d.id, date: d.date, isClosed: d.isClosed, opensAt: d.opensAt ?? null, closesAt: d.closesAt ?? null, note: d.note ?? null };
}

export function statusMessagesOf(b: BranchRow): StatusMessagesSetting {
  return { ...DEFAULT_STATUS_MESSAGES, ...(b.statusMessages ?? {}) };
}

export function alarmPolicyOf(b: BranchRow): AlarmPolicy {
  return { ...DEFAULT_ALARM_POLICY, ...(b.alarmPolicy ?? {}) };
}

export function receiptSettingsOf(b: BranchRow) {
  return { ...DEFAULT_RECEIPT_SETTINGS, ...((b.receiptSettings ?? {}) as Record<string, unknown>) } as typeof DEFAULT_RECEIPT_SETTINGS;
}

export async function loadBranchSettings(db: Database, branch: BranchRow, now = new Date()): Promise<BranchSettings> {
  const [hours, days] = await Promise.all([loadHours(db, branch.id), loadSpecialDays(db, branch, now, 0)]);
  const raw = computeOrderingState(
    {
      timezone: branch.timezone,
      hours,
      specialDays: days.map((d) => ({ date: d.date, isClosed: d.isClosed, opensAt: d.opensAt, closesAt: d.closesAt })),
      pausedUntil: branch.pausedUntil,
      busyExtraMinutes: branch.busyExtraMinutes,
    },
    now,
  );
  return {
    id: branch.id,
    name: branch.name,
    phone: branch.phone ?? null,
    addressLine: branch.addressLine ?? null,
    neighborhood: branch.neighborhood ?? null,
    district: branch.district,
    city: branch.city,
    lat: branch.lat ?? null,
    lng: branch.lng ?? null,
    timezone: branch.timezone,
    acceptsDelivery: branch.acceptsDelivery,
    acceptsPickup: branch.acceptsPickup,
    pickupMinOrderKurus: branch.pickupMinOrderKurus,
    defaultPrepMinutes: branch.defaultPrepMinutes,
    usePreparingStep: branch.usePreparingStep,
    paymentMethods: branch.paymentMethods,
    mealCardBrands: branch.mealCardBrands,
    statusMessages: statusMessagesOf(branch),
    alarmPolicy: alarmPolicyOf(branch),
    receiptSettings: receiptSettingsOf(branch),
    state: toBranchState(raw),
    hours,
    specialDays: days.map(toSpecialDayDto),
  };
}

export async function lockBranch(tx: Database, tenantId: string, branchId: string): Promise<BranchRow> {
  const [b] = await tx
    .select()
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)))
    .for('update');
  if (!b) throw notFound('Şube bulunamadı.');
  return b;
}

/** PATCH /panel/branches/:id — birleşik değerler üzerinde kurallar (00 §10 alarm, 04 §7.6–§7.8). */
export async function patchBranch(tx: Database, current: BranchRow, body: BranchPatch): Promise<{ row: BranchRow; changedKeys: string[] }> {
  const patch: Partial<typeof branches.$inferInsert> = {};
  const simple = [
    'name',
    'phone',
    'addressLine',
    'neighborhood',
    'district',
    'city',
    'acceptsDelivery',
    'acceptsPickup',
    'pickupMinOrderKurus',
    'defaultPrepMinutes',
    'usePreparingStep',
  ] as const;
  for (const k of simple) {
    if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k];
  }
  if (body.phone !== undefined && body.phone) {
    const p = normalizePhone(body.phone);
    if (!p) throw validationError('Geçerli bir telefon numarası girin.', 'phone');
    patch.phone = p;
  }

  // Konum: ikisi birlikte
  if (body.lat !== undefined || body.lng !== undefined) {
    const lat = body.lat !== undefined ? body.lat : current.lat;
    const lng = body.lng !== undefined ? body.lng : current.lng;
    if ((lat == null) !== (lng == null)) throw validationError('Konum için enlem ve boylam birlikte girilmeli.', 'lat');
    patch.lat = lat ?? null;
    patch.lng = lng ?? null;
  }

  const acceptsDelivery = patch.acceptsDelivery ?? current.acceptsDelivery;
  const acceptsPickup = patch.acceptsPickup ?? current.acceptsPickup;
  if (!acceptsDelivery && !acceptsPickup) throw validationError('Paket servis ya da gel-al seçeneklerinden en az biri açık olmalı.', 'acceptsDelivery');

  if (body.paymentMethods !== undefined) {
    const methods = [...new Set(body.paymentMethods)];
    if (methods.length === 0) throw validationError('En az bir ödeme yöntemi açık olmalı.', 'paymentMethods');
    patch.paymentMethods = methods;
  }
  if (body.mealCardBrands !== undefined) patch.mealCardBrands = [...new Set(body.mealCardBrands)];
  const methods = patch.paymentMethods ?? current.paymentMethods;
  const brands = patch.mealCardBrands ?? current.mealCardBrands;
  if ((body.paymentMethods !== undefined || body.mealCardBrands !== undefined) && methods.includes('meal_card_on_delivery') && brands.length === 0) {
    throw validationError('Yemek kartı açıkken en az bir kart markası seçin.', 'mealCardBrands');
  }

  if (body.statusMessages) {
    for (const key of LOCKED_STATUS_MESSAGES) {
      if (body.statusMessages[key] === false) {
        throw validationError(
          key === 'received' ? '"Alındı" mesajı kapatılamaz.' : '"Onaylandı" mesajı kapatılamaz.',
          `statusMessages.${key}`,
        );
      }
    }
    patch.statusMessages = { ...statusMessagesOf(current), ...body.statusMessages };
  }

  if (body.alarmPolicy) {
    const { panel_alarm_enabled, repeat_alarm_enabled, ...rest } = body.alarmPolicy;
    if (panel_alarm_enabled === false) throw validationError('Panel sesi ve bildirim (t=0) kapatılamaz.', 'alarmPolicy.panel_alarm_enabled');
    if (repeat_alarm_enabled === false) throw validationError('60 sn ses tekrarı kapatılamaz.', 'alarmPolicy.repeat_alarm_enabled');
    const merged: AlarmPolicy = { ...alarmPolicyOf(current), ...rest };
    assertNoIssues(validateAlarmPolicy(merged));
    patch.alarmPolicy = merged;
  }

  if (body.receiptSettings) {
    patch.receiptSettings = { ...receiptSettingsOf(current), ...body.receiptSettings } as ReceiptSettings;
  }

  const changedKeys = Object.keys(patch).filter(
    (k) => JSON.stringify((current as Record<string, unknown>)[k] ?? null) !== JSON.stringify((patch as Record<string, unknown>)[k] ?? null),
  );
  if (changedKeys.length === 0) return { row: current, changedKeys };
  const [row] = await tx
    .update(branches)
    .set({ ...patch, version: current.version + 1 })
    .where(eq(branches.id, current.id))
    .returning();
  return { row: row!, changedKeys };
}

/** PUT /panel/branches/:id/hours — haftanın tamamını değiştirir; listede olmayan gün kapalıdır. */
export async function replaceHours(tx: Database, branch: BranchRow, body: HoursPut) {
  assertNoIssues(validateWeeklyHours(body.days));
  await tx.delete(openingHours).where(eq(openingHours.branchId, branch.id));
  const rows = body.days.flatMap((d) =>
    d.intervals.map((iv) => ({ tenantId: branch.tenantId, branchId: branch.id, weekday: d.weekday, opensAt: iv.opensAt, closesAt: iv.closesAt })),
  );
  if (rows.length) await tx.insert(openingHours).values(rows);
  return loadHours(tx, branch.id);
}

function specialDayProblem(isClosed: boolean, opensAt?: string | null, closesAt?: string | null): string | null {
  if (!isClosed && (!opensAt || !closesAt)) return 'Özel saat için açılış ve kapanış saatini girin.';
  return null;
}

export interface SpecialDayInput {
  date: string;
  endDate?: string;
  isClosed: boolean;
  opensAt?: string | null;
  closesAt?: string | null;
  note?: string | null;
}

export async function createSpecialDays(tx: Database, branch: BranchRow, input: SpecialDayInput): Promise<SpecialDayRow[]> {
  if (!isValidDateString(input.date)) throw validationError('Geçerli bir tarih girin.', 'date');
  const end = input.endDate ?? input.date;
  if (!isValidDateString(end)) throw validationError('Geçerli bir bitiş tarihi girin.', 'endDate');
  if (end < input.date) throw validationError('Bitiş tarihi başlangıçtan önce olamaz.', 'endDate');
  const problem = specialDayProblem(input.isClosed, input.opensAt, input.closesAt);
  if (problem) throw validationError(problem, 'opensAt');
  const dates: string[] = [];
  for (let d = input.date; d <= end; d = addDaysStr(d, 1)) {
    dates.push(d);
    if (dates.length > 60) throw validationError('Tek seferde en fazla 60 gün girilebilir.', 'endDate');
  }
  try {
    return await tx
      .insert(specialDays)
      .values(
        dates.map((date) => ({
          tenantId: branch.tenantId,
          branchId: branch.id,
          date,
          isClosed: input.isClosed,
          opensAt: input.isClosed ? null : (input.opensAt ?? null),
          closesAt: input.isClosed ? null : (input.closesAt ?? null),
          note: input.note ?? null,
        })),
      )
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('special_day_exists', 'Bu tarih için zaten bir özel gün kaydı var.', { issues: [{ path: 'date', message: 'Bu tarih zaten kayıtlı.' }] });
    throw err;
  }
}

export async function findSpecialDay(tx: Database, branch: BranchRow, id: string): Promise<SpecialDayRow> {
  const [d] = await tx
    .select()
    .from(specialDays)
    .where(and(eq(specialDays.id, id), eq(specialDays.branchId, branch.id), eq(specialDays.tenantId, branch.tenantId)));
  if (!d) throw notFound('Özel gün bulunamadı.');
  return d;
}

export async function updateSpecialDay(
  tx: Database,
  day: SpecialDayRow,
  body: { isClosed?: boolean; opensAt?: string | null; closesAt?: string | null; note?: string | null },
): Promise<SpecialDayRow> {
  const isClosed = body.isClosed ?? day.isClosed;
  const opensAt = body.opensAt !== undefined ? body.opensAt : day.opensAt;
  const closesAt = body.closesAt !== undefined ? body.closesAt : day.closesAt;
  const problem = specialDayProblem(isClosed, opensAt, closesAt);
  if (problem) throw validationError(problem, 'opensAt');
  const [row] = await tx
    .update(specialDays)
    .set({
      isClosed,
      opensAt: isClosed ? null : opensAt,
      closesAt: isClosed ? null : closesAt,
      note: body.note !== undefined ? body.note : day.note,
    })
    .where(eq(specialDays.id, day.id))
    .returning();
  return row!;
}

/** Duraklatma: dakika | null (yeniden aç) | 'until_close' (mevcut aralığın kapanışı) | 'end_of_day'. */
export async function pauseBranch(
  tx: Database,
  branch: BranchRow,
  minutes: number | 'until_close' | 'end_of_day' | null,
  reason: string | null,
  now = new Date(),
): Promise<BranchRow> {
  let pausedUntil: Date | null = null;
  if (typeof minutes === 'number') {
    pausedUntil = new Date(now.getTime() + minutes * 60_000);
  } else if (minutes === 'until_close') {
    const r = computeOrderingState({ ...(await scheduleInputFor(tx, branch, now)), pausedUntil: null }, now);
    // Kapanış yoksa (şu an kapalı) gün sonuna kadar; 7/24 açık şubede en çok 24 saat.
    const cap = new Date(now.getTime() + 24 * 3_600_000);
    pausedUntil = r.closesAt ? (r.closesAt < cap ? r.closesAt : cap) : endOfLocalDay(now, branch.timezone);
  } else if (minutes === 'end_of_day') {
    pausedUntil = endOfLocalDay(now, branch.timezone);
  }
  const [row] = await tx
    .update(branches)
    .set({ pausedUntil, pauseReason: pausedUntil ? reason : null, version: branch.version + 1 })
    .where(eq(branches.id, branch.id))
    .returning();
  return row!;
}

export async function setBusy(tx: Database, branch: BranchRow, extraMinutes: number): Promise<BranchRow> {
  const [row] = await tx
    .update(branches)
    .set({ busyExtraMinutes: extraMinutes, version: branch.version + 1 })
    .where(eq(branches.id, branch.id))
    .returning();
  return row!;
}
