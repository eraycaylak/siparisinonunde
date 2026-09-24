import { describe, expect, it } from 'vitest';
import {
  computeOrderingState,
  endOfLocalDay,
  formatClockTR,
  formatNextOpenTR,
  isOpenAt,
  localDateString,
  zonedTimeToUtc,
  type OpeningHourRow,
} from '../src/hours';

const everyDay = (opensAt: string, closesAt: string): OpeningHourRow[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt, closesAt }));

// İstanbul = UTC+3
const ist = (local: string) => new Date(`${local}+03:00`);

describe('hours', () => {
  it('yerel saat → UTC', () => {
    expect(zonedTimeToUtc('2026-09-24', '10:00').toISOString()).toBe('2026-09-24T07:00:00.000Z');
    expect(localDateString(new Date('2026-09-24T22:30:00Z'))).toBe('2026-09-25');
    expect(formatClockTR(new Date('2026-09-24T17:35:00Z'))).toBe('20.35');
  });

  it('normal gün: açık / kapalı / nextOpenAt / closesAt', () => {
    const hours = everyDay('10:00', '23:30');
    const open = computeOrderingState({ hours }, ist('2026-09-24T12:00:00'));
    expect(open.state).toBe('open');
    expect(open.closesAt?.toISOString()).toBe(ist('2026-09-24T23:30:00').toISOString());

    const early = computeOrderingState({ hours }, ist('2026-09-24T09:00:00'));
    expect(early.state).toBe('closed');
    expect(early.nextOpenAt?.toISOString()).toBe(ist('2026-09-24T10:00:00').toISOString());

    const late = computeOrderingState({ hours }, ist('2026-09-24T23:45:00'));
    expect(late.state).toBe('closed');
    expect(late.nextOpenAt?.toISOString()).toBe(ist('2026-09-25T10:00:00').toISOString());
  });

  it('gece yarısını aşan aralık', () => {
    // Perşembe (4) 18:00–02:00
    const hours: OpeningHourRow[] = [{ weekday: 4, opensAt: '18:00', closesAt: '02:00' }];
    // 2026-09-24 Perşembe
    expect(computeOrderingState({ hours }, ist('2026-09-24T23:00:00')).state).toBe('open');
    const afterMidnight = computeOrderingState({ hours }, ist('2026-09-25T01:30:00'));
    expect(afterMidnight.state).toBe('open');
    expect(afterMidnight.closesAt?.toISOString()).toBe(ist('2026-09-25T02:00:00').toISOString());
    const closed = computeOrderingState({ hours }, ist('2026-09-25T02:30:00'));
    expect(closed.state).toBe('closed');
    expect(closed.nextOpenAt?.toISOString()).toBe(ist('2026-10-01T18:00:00').toISOString());
  });

  it('kapanış 00:00 ve 24 saat', () => {
    expect(isOpenAt({ hours: everyDay('10:00', '00:00') }, ist('2026-09-24T23:59:00'))).toBe(true);
    expect(isOpenAt({ hours: everyDay('10:00', '00:00') }, ist('2026-09-25T00:00:00'))).toBe(false);
    expect(isOpenAt({ hours: everyDay('00:00', '00:00') }, ist('2026-09-24T04:00:00'))).toBe(true);
  });

  it('özel gün: kapalı ve farklı saat', () => {
    const hours = everyDay('10:00', '23:30');
    const closedDay = computeOrderingState(
      { hours, specialDays: [{ date: '2026-09-24', isClosed: true }] },
      ist('2026-09-24T12:00:00'),
    );
    expect(closedDay.state).toBe('closed');
    expect(closedDay.nextOpenAt?.toISOString()).toBe(ist('2026-09-25T10:00:00').toISOString());

    const shortDay = { hours, specialDays: [{ date: '2026-09-24', isClosed: false, opensAt: '14:00', closesAt: '18:00' }] };
    expect(computeOrderingState(shortDay, ist('2026-09-24T12:00:00')).nextOpenAt?.toISOString()).toBe(
      ist('2026-09-24T14:00:00').toISOString(),
    );
    expect(computeOrderingState(shortDay, ist('2026-09-24T15:00:00')).state).toBe('open');
    expect(computeOrderingState(shortDay, ist('2026-09-24T19:00:00')).state).toBe('closed');
  });

  it('paused_until ve busy', () => {
    const hours = everyDay('10:00', '23:30');
    const now = ist('2026-09-24T12:00:00');
    const paused = computeOrderingState({ hours, pausedUntil: ist('2026-09-24T12:30:00') }, now);
    expect(paused.state).toBe('paused');
    expect(paused.nextOpenAt?.toISOString()).toBe(ist('2026-09-24T12:30:00').toISOString());

    // Duraklatma kapanıştan sonra bitiyorsa bir sonraki açılış
    const pausedLate = computeOrderingState({ hours, pausedUntil: ist('2026-09-24T23:50:00') }, now);
    expect(pausedLate.nextOpenAt?.toISOString()).toBe(ist('2026-09-25T10:00:00').toISOString());

    // Süresi geçmiş duraklatma yok sayılır
    expect(computeOrderingState({ hours, pausedUntil: ist('2026-09-24T11:00:00') }, now).state).toBe('open');

    const busy = computeOrderingState({ hours, busyExtraMinutes: 15 }, now);
    expect(busy.state).toBe('busy');
    expect(busy.busyExtraMinutes).toBe(15);
    // Kapalıyken busy değil closed
    expect(computeOrderingState({ hours, busyExtraMinutes: 15 }, ist('2026-09-24T08:00:00')).state).toBe('closed');
  });

  it('saat tanımı yoksa kapalı ve nextOpenAt null', () => {
    const r = computeOrderingState({ hours: [] }, ist('2026-09-24T12:00:00'));
    expect(r.state).toBe('closed');
    expect(r.nextOpenAt).toBeNull();
  });

  it('açılış metni ve gün sonu', () => {
    const now = ist('2026-09-24T23:45:00');
    expect(formatNextOpenTR(ist('2026-09-25T10:00:00'), now)).toBe('Yarın 10.00');
    expect(formatNextOpenTR(ist('2026-09-24T23:50:00'), now)).toBe('Bugün 23.50');
    expect(formatNextOpenTR(ist('2026-09-28T10:00:00'), now)).toBe('Pazartesi 10.00');
    expect(endOfLocalDay(ist('2026-09-24T12:00:00')).toISOString()).toBe(ist('2026-09-25T00:00:00').toISOString());
  });
});
