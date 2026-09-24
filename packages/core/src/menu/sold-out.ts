// "Bugün tükendi" bitişi (04 §6.4, 03 S-02): ürün bir sonraki iş gününün ilk açılışında yeniden satışa girer.
// Takvim gece yarısı değil: gece yarısını aşan (10.00–02.00) ya da bölünmüş (11–14 / 17–23) çalışma saatinde
// "bugün" aynı hizmet gününün sonuna kadar sürer.

import { DEFAULT_TIMEZONE, endOfLocalDay, localDateString, scheduleIntervals, type ScheduleInput } from '../hours';

/**
 * İş günü: açıkken içinde bulunulan aralığın başladığı yerel gün; kapalıyken bugün (yerel). Sonuç, iş gününden
 * sonraki bir yerel günde başlayan ilk açılış aralığının başlangıcıdır. Saat tanımı yoksa ya da şube kesintisiz
 * açıksa (7/24; birleşik tek aralık) yerel gün sonu (Europe/Istanbul gece yarısı) kullanılır.
 */
export function soldOutUntilNextBusinessDay(input: ScheduleInput | null | undefined, now: Date = new Date()): Date {
  const tz = input?.timezone || DEFAULT_TIMEZONE;
  const fallback = endOfLocalDay(now, tz);
  if (!input || (!input.hours.length && !input.specialDays?.length)) return fallback;
  const intervals = scheduleIntervals(input, now, 15);
  const current = intervals.find((iv) => iv.start <= now && now < iv.end);
  const businessDate = current ? localDateString(current.start, tz) : localDateString(now, tz);
  const next = intervals.find((iv) => iv.start > now && localDateString(iv.start, tz) > businessDate);
  return next ? next.start : fallback;
}
