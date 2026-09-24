// Çalışma saatleri ve şube sipariş durumu (00 §7 ordering_state). Saat dilimi: Europe/Istanbul.
// Öncelik (07 §3.5): paused > special_days > opening_hours; busy yalnız açıkken.

import type { OrderingState } from './enums';

export const DEFAULT_TIMEZONE = 'Europe/Istanbul';

/** weekday: 0 = Pazar … 6 = Cumartesi. closesAt <= opensAt ⇒ gece yarısını aşar; eşitse 24 saat. */
export interface OpeningHourRow {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface SpecialDayRow {
  /** Yerel tarih 'YYYY-MM-DD'. */
  date: string;
  isClosed: boolean;
  opensAt?: string | null;
  closesAt?: string | null;
  note?: string | null;
}

export interface ScheduleInput {
  timezone?: string | null;
  hours: readonly OpeningHourRow[];
  specialDays?: readonly SpecialDayRow[] | null;
  pausedUntil?: Date | string | null;
  busyExtraMinutes?: number | null;
}

export interface OrderingStateResult {
  state: OrderingState;
  /** Çalışma saatine göre şu an açık mı (duraklatma hariç). */
  isOpenBySchedule: boolean;
  /** Kapalı/duraklatılmışsa bir sonraki sipariş alma anı (14 gün içinde yoksa null). */
  nextOpenAt: Date | null;
  /** Açıksa mevcut aralığın bitişi. */
  closesAt: Date | null;
  pausedUntil: Date | null;
  busyExtraMinutes: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidHHMM(value: string | null | undefined): value is string {
  return typeof value === 'string' && HHMM.test(value);
}

function parseHHMM(value: string): [number, number] {
  const m = HHMM.exec(value);
  if (!m) throw new Error(`Geçersiz saat: ${value}`);
  return [Number(m[1]), Number(m[2])];
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(date: Date, tz: string = DEFAULT_TIMEZONE): LocalParts {
  const out: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour === 24 ? 0 : out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

function tzOffsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Yerel tarih + saat → UTC an. */
export function zonedTimeToUtc(dateStr: string, time: string, tz: string = DEFAULT_TIMEZONE): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const [hh, mm] = parseHHMM(time);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let t = guess - off1;
  const off2 = tzOffsetMs(new Date(t), tz);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Anın yerel tarihi 'YYYY-MM-DD'. */
export function localDateString(date: Date, tz: string = DEFAULT_TIMEZONE): string {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Anın yerel saati 'HH:MM'. */
export function localTimeString(date: Date, tz: string = DEFAULT_TIMEZONE): string {
  const p = localParts(date, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Mesajlardaki saat biçimi (03 §9.1): "20.35". */
export function formatClockTR(date: Date, tz: string = DEFAULT_TIMEZONE): string {
  const p = localParts(date, tz);
  return `${pad(p.hour)}.${pad(p.minute)}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Yerel tarihin haftanın günü (0 = Pazar). */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Yerel gün sonu (ertesi gün 00:00) — "bugün tükendi", "bugün kapalı" için. */
export function endOfLocalDay(now: Date, tz: string = DEFAULT_TIMEZONE): Date {
  return zonedTimeToUtc(addDays(localDateString(now, tz), 1), '00:00', tz);
}

function intervalFor(dateStr: string, opensAt: string, closesAt: string, tz: string): Interval | null {
  if (!isValidHHMM(opensAt) || !isValidHHMM(closesAt)) return null;
  const start = zonedTimeToUtc(dateStr, opensAt, tz);
  let end: Date;
  if (closesAt === opensAt) {
    end = zonedTimeToUtc(addDays(dateStr, 1), opensAt, tz);
  } else if (closesAt < opensAt) {
    end = zonedTimeToUtc(addDays(dateStr, 1), closesAt, tz);
  } else {
    end = zonedTimeToUtc(dateStr, closesAt, tz);
  }
  return { start, end };
}

/** Yerel bir günün kendi açılış aralıkları (özel gün kuralı uygulanmış). */
export function intervalsForDate(input: ScheduleInput, dateStr: string): Interval[] {
  const tz = input.timezone || DEFAULT_TIMEZONE;
  const special = input.specialDays?.find((s) => s.date === dateStr);
  if (special) {
    if (special.isClosed) return [];
    if (special.opensAt && special.closesAt) {
      const iv = intervalFor(dateStr, special.opensAt, special.closesAt, tz);
      return iv ? [iv] : [];
    }
    // Saat verilmemiş açık özel gün → normal saatler
  }
  const wd = weekdayOf(dateStr);
  return input.hours
    .filter((h) => h.weekday === wd)
    .map((h) => intervalFor(dateStr, h.opensAt, h.closesAt, tz))
    .filter((x): x is Interval => x !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** `from` gününden (bir gün öncesi dahil) itibaren `days` günlük aralıklar, birleştirilmiş ve sıralı. */
export function scheduleIntervals(input: ScheduleInput, from: Date, days = 15): Interval[] {
  const tz = input.timezone || DEFAULT_TIMEZONE;
  const today = localDateString(from, tz);
  const all: Interval[] = [];
  for (let i = -1; i < days; i++) all.push(...intervalsForDate(input, addDays(today, i)));
  all.sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const iv of all) {
    const last = merged[merged.length - 1];
    if (last && iv.start.getTime() <= last.end.getTime()) {
      if (iv.end.getTime() > last.end.getTime()) last.end = iv.end;
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }
  return merged;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Çalışma saatine göre `at` anında açık mı. */
export function isOpenAt(input: ScheduleInput, at: Date): boolean {
  return scheduleIntervals(input, at, 2).some((iv) => iv.start <= at && at < iv.end);
}

/** Şube sipariş durumunu hesaplar (`closed` saklanmaz, burada hesaplanır). */
export function computeOrderingState(input: ScheduleInput, now: Date = new Date()): OrderingStateResult {
  const intervals = scheduleIntervals(input, now, 15);
  const findCurrent = (at: Date) => intervals.find((iv) => iv.start <= at && at < iv.end) ?? null;
  const findNextStart = (at: Date) => intervals.find((iv) => iv.start > at)?.start ?? null;

  const current = findCurrent(now);
  const pausedUntilRaw = toDate(input.pausedUntil);
  const pausedUntil = pausedUntilRaw && pausedUntilRaw > now ? pausedUntilRaw : null;
  const busyExtraMinutes = Math.max(0, input.busyExtraMinutes ?? 0);

  if (pausedUntil) {
    const resumeOpen = findCurrent(pausedUntil) ? pausedUntil : findNextStart(pausedUntil);
    return {
      state: 'paused',
      isOpenBySchedule: current !== null,
      nextOpenAt: resumeOpen,
      closesAt: current?.end ?? null,
      pausedUntil,
      busyExtraMinutes,
    };
  }
  if (!current) {
    return {
      state: 'closed',
      isOpenBySchedule: false,
      nextOpenAt: findNextStart(now),
      closesAt: null,
      pausedUntil: null,
      busyExtraMinutes,
    };
  }
  return {
    state: busyExtraMinutes > 0 ? 'busy' : 'open',
    isOpenBySchedule: true,
    nextOpenAt: null,
    closesAt: current.end,
    pausedUntil: null,
    busyExtraMinutes,
  };
}

/** Sipariş alınabilir mi (open veya busy). */
export function acceptsOrders(state: OrderingState): boolean {
  return state === 'open' || state === 'busy';
}

const WEEKDAY_NAMES_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'] as const;

export function weekdayNameTR(weekday: number): string {
  return WEEKDAY_NAMES_TR[weekday] ?? '';
}

/** Mesajlardaki {acilis} biçimi: "Bugün 11.00", "Yarın 11.00", "Pazartesi 11.00" (7 gün içinde) ya da "12.10 11.00". */
export function formatNextOpenTR(at: Date, now: Date = new Date(), tz: string = DEFAULT_TIMEZONE): string {
  const today = localDateString(now, tz);
  const day = localDateString(at, tz);
  const clock = formatClockTR(at, tz);
  if (day === today) return `Bugün ${clock}`;
  if (day === addDays(today, 1)) return `Yarın ${clock}`;
  for (let i = 2; i < 7; i++) {
    if (day === addDays(today, i)) return `${weekdayNameTR(weekdayOf(day))} ${clock}`;
  }
  const [, m, d] = day.split('-');
  return `${d}.${m} ${clock}`;
}
