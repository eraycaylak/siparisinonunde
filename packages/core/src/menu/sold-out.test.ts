import { describe, expect, it } from 'vitest';
import type { ScheduleInput } from '../hours';
import { soldOutUntilNextBusinessDay } from './sold-out';

// Europe/Istanbul = UTC+3. 2026-09-24 Perşembe (weekday 4).
const at = (iso: string) => new Date(iso);
const every = (opensAt: string, closesAt: string) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt, closesAt }));

describe('soldOutUntilNextBusinessDay', () => {
  it('normal gün: ertesi günün ilk açılışı', () => {
    const s: ScheduleInput = { hours: every('10:00', '23:30') };
    expect(soldOutUntilNextBusinessDay(s, at('2026-09-24T12:00:00Z')).toISOString()).toBe('2026-09-25T07:00:00.000Z');
  });

  it('gece yarısını aşan saat: 01.00 hâlâ aynı iş günü, gece yarısında sıfırlanmaz', () => {
    const s: ScheduleInput = { hours: every('10:00', '02:00') };
    // 25 Eylül 01.00 yerel (24'ün hizmet günü) → 25 Eylül 10.00
    expect(soldOutUntilNextBusinessDay(s, at('2026-09-24T22:00:00Z')).toISOString()).toBe('2026-09-25T07:00:00.000Z');
    // 24 Eylül 23.00 yerel → 25 Eylül 10.00
    expect(soldOutUntilNextBusinessDay(s, at('2026-09-24T20:00:00Z')).toISOString()).toBe('2026-09-25T07:00:00.000Z');
  });

  it('bölünmüş saat: öğlen işaretlenen akşam servisinde de tükenmiş kalır', () => {
    const s: ScheduleInput = {
      hours: [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
        { weekday, opensAt: '11:00', closesAt: '14:00' },
        { weekday, opensAt: '17:00', closesAt: '23:00' },
      ]),
    };
    expect(soldOutUntilNextBusinessDay(s, at('2026-09-24T09:00:00Z')).toISOString()).toBe('2026-09-25T08:00:00.000Z');
    // Aradaki kapalı saatte (15.00) işaretlenirse de ertesi gün
    expect(soldOutUntilNextBusinessDay(s, at('2026-09-24T12:00:00Z')).toISOString()).toBe('2026-09-25T08:00:00.000Z');
  });

  it('açılıştan önce işaretlenirse bugünün hizmeti boyunca; ertesi gün kapalıysa sonraki açılış', () => {
    // Cuma (5) kapalı
    const s: ScheduleInput = { hours: every('10:00', '22:00').filter((h) => h.weekday !== 5) };
    // Perşembe 08.00 yerel → Cuma kapalı → Cumartesi 10.00
    expect(soldOutUntilNextBusinessDay(s, at('2026-09-24T05:00:00Z')).toISOString()).toBe('2026-09-26T07:00:00.000Z');
  });

  it('özel gün (kapalı) dikkate alınır', () => {
    const s: ScheduleInput = { hours: every('10:00', '22:00'), specialDays: [{ date: '2026-09-25', isClosed: true }] };
    expect(soldOutUntilNextBusinessDay(s, at('2026-09-24T12:00:00Z')).toISOString()).toBe('2026-09-26T07:00:00.000Z');
  });

  it('7/24 ya da saat yoksa yerel gece yarısı', () => {
    expect(soldOutUntilNextBusinessDay({ hours: every('00:00', '00:00') }, at('2026-09-24T12:00:00Z')).toISOString()).toBe(
      '2026-09-24T21:00:00.000Z',
    );
    expect(soldOutUntilNextBusinessDay({ hours: [] }, at('2026-09-24T12:00:00Z')).toISOString()).toBe('2026-09-24T21:00:00.000Z');
    expect(soldOutUntilNextBusinessDay(null, at('2026-09-24T12:00:00Z')).toISOString()).toBe('2026-09-24T21:00:00.000Z');
  });
});
