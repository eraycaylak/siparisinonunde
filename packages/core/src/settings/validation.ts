// İşletme ayarları için saf doğrulama yardımcıları (dilim 4). API ve panel formu aynı kuralları kullanır.
// Saatler (04 §7.3), teslimat bölgesi geometrisi (04 §7.5), alarm politikası sınırları (00 §10).

import { isValidHHMM, weekdayNameTR } from '../hours';
import type { GeoJsonPolygon } from '../zones';
import { neighborhoodKey } from '../zones';

export interface ValidationIssue {
  /** Alan yolu ("days.0.intervals.1", "polygon", "neighborhoods.2"). */
  path: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Sınırlar

/** 00 §10: otomatik iptal 10–30 dk; müşteri bilgisi iptalden en az 5 dk önce. */
export const ALARM_LIMITS = {
  autoCancelMin: 10,
  autoCancelMax: 30,
  customerNoticeMin: 5,
  /** customer_notice_minutes ≤ auto_cancel_minutes − noticeGap */
  noticeGap: 5,
} as const;

/** 04 §7.7: varsayılan hazırlık süresi 5–120 dk. */
export const PREP_MINUTES_LIMITS = { min: 5, max: 120 } as const;
/** Yarıçap bölgesi (m). */
export const ZONE_RADIUS_LIMITS = { min: 100, max: 30_000 } as const;
/** Pazaryeri kesinti oranı (baz puan): %0–%60. */
export const MARKETPLACE_COMMISSION_BP_MAX = 6000;
/** Günde en fazla aralık. */
export const MAX_INTERVALS_PER_DAY = 4;
/** Poligonda en fazla nokta. */
export const MAX_POLYGON_POINTS = 500;
/** Bir bölgedeki en fazla mahalle. */
export const MAX_NEIGHBORHOODS_PER_ZONE = 200;

export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ---------------------------------------------------------------------------
// Alarm politikası

export interface AlarmPolicyValues {
  auto_cancel_minutes: number;
  customer_notice_minutes: number;
  platform_wa_enabled: boolean;
  sms_enabled: boolean;
}

/** En geç müşteri bilgisi dakikası (otomatik iptal − 5). */
export function maxCustomerNoticeMinutes(autoCancelMinutes: number): number {
  return autoCancelMinutes - ALARM_LIMITS.noticeGap;
}

export function validateAlarmPolicy(p: AlarmPolicyValues): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ac = p.auto_cancel_minutes;
  if (!Number.isInteger(ac) || ac < ALARM_LIMITS.autoCancelMin || ac > ALARM_LIMITS.autoCancelMax) {
    issues.push({
      path: 'alarmPolicy.auto_cancel_minutes',
      message: `Otomatik iptal süresi ${ALARM_LIMITS.autoCancelMin}–${ALARM_LIMITS.autoCancelMax} dk arasında olmalı.`,
    });
  }
  const cn = p.customer_notice_minutes;
  if (!Number.isInteger(cn) || cn < ALARM_LIMITS.customerNoticeMin) {
    issues.push({
      path: 'alarmPolicy.customer_notice_minutes',
      message: `Müşteri bilgisi en erken ${ALARM_LIMITS.customerNoticeMin}. dakikada gidebilir.`,
    });
  } else if (Number.isInteger(ac) && cn > maxCustomerNoticeMinutes(ac)) {
    issues.push({
      path: 'alarmPolicy.customer_notice_minutes',
      message: `Müşteri bilgisi otomatik iptalden en az ${ALARM_LIMITS.noticeGap} dk önce gitmeli (en geç ${maxCustomerNoticeMinutes(ac)}. dakika).`,
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Haftalık çalışma saatleri

export interface HoursInterval {
  opensAt: string;
  closesAt: string;
}

export interface HoursDay {
  /** 0 = Pazar … 6 = Cumartesi */
  weekday: number;
  intervals: HoursInterval[];
}

const WEEK_MIN = 7 * 1440;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Aralığın süresi (dk): kapanış ≤ açılış ⇒ gece yarısını aşar; eşitse 24 saat. */
export function intervalDurationMinutes(opensAt: string, closesAt: string): number {
  const o = toMinutes(opensAt);
  const c = toMinutes(closesAt);
  if (c === o) return 1440;
  return c > o ? c - o : c + 1440 - o;
}

/** Kapanış açılıştan önceyse aralık ertesi güne sarkar (ör. 18:00–02:00). */
export function crossesMidnight(opensAt: string, closesAt: string): boolean {
  return toMinutes(closesAt) < toMinutes(opensAt);
}

/**
 * Haftalık saat doğrulaması: saat biçimi, gün başına en fazla 4 aralık, aynı gün iki kez yok,
 * aralıklar (gece yarısını aşanlar dahil, hafta döngüsel) çakışmaz. Boş gün = kapalı.
 */
export function validateWeeklyHours(days: readonly HoursDay[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<number>();
  const spans: { s: number; e: number; path: string; weekday: number }[] = [];
  days.forEach((day, di) => {
    if (!Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6) {
      issues.push({ path: `days.${di}.weekday`, message: 'Gün 0 (Pazar) ile 6 (Cumartesi) arasında olmalı.' });
      return;
    }
    if (seen.has(day.weekday)) {
      issues.push({ path: `days.${di}.weekday`, message: `${weekdayNameTR(day.weekday)} birden fazla kez girilmiş.` });
      return;
    }
    seen.add(day.weekday);
    if (day.intervals.length > MAX_INTERVALS_PER_DAY) {
      issues.push({ path: `days.${di}.intervals`, message: `Bir güne en fazla ${MAX_INTERVALS_PER_DAY} aralık girilebilir.` });
    }
    day.intervals.forEach((iv, ii) => {
      const path = `days.${di}.intervals.${ii}`;
      if (!isValidHHMM(iv.opensAt) || !isValidHHMM(iv.closesAt)) {
        issues.push({ path, message: 'Saatler SS:DD biçiminde olmalı (ör. 11:00).' });
        return;
      }
      if (iv.opensAt === iv.closesAt && day.intervals.length > 1) {
        issues.push({ path, message: 'Açılış ve kapanış aynıysa gün 24 saat açık sayılır; başka aralık eklenemez.' });
        return;
      }
      const s = day.weekday * 1440 + toMinutes(iv.opensAt);
      spans.push({ s, e: s + intervalDurationMinutes(iv.opensAt, iv.closesAt), path, weekday: day.weekday });
    });
  });
  // Döngüsel çakışma kontrolü (Cumartesi gecesi → Pazar sabahı dahil)
  const reported = new Set<string>();
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i]!;
      const b = spans[j]!;
      let overlap = false;
      for (const k of [-WEEK_MIN, 0, WEEK_MIN]) {
        if (a.s < b.e + k && b.s + k < a.e) overlap = true;
      }
      if (overlap && !reported.has(b.path)) {
        reported.add(b.path);
        const sameDay = a.weekday === b.weekday;
        issues.push({
          path: b.path,
          message: sameDay
            ? `${weekdayNameTR(b.weekday)} saatleri çakışıyor.`
            : `${weekdayNameTR(b.weekday)} saatleri, ${weekdayNameTR(a.weekday)} gecesinden devreden saatlerle çakışıyor.`,
        });
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Teslimat bölgesi geometrisi

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function ringArea(ring: number[][]): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  }
  return area / 2;
}

/**
 * GeoJSON Polygon doğrulaması: type 'Polygon', dış halka ≥ 3 farklı nokta, kapalı halka (ilk = son),
 * [lng, lat] geçerli aralıkta, alan sıfır değil. Hata yoksa null.
 */
export function validatePolygon(polygon: unknown): string | null {
  if (!polygon || typeof polygon !== 'object') return 'Haritada bir alan çizin.';
  const p = polygon as { type?: unknown; coordinates?: unknown };
  if (p.type !== 'Polygon') return 'Alan GeoJSON Polygon biçiminde olmalı.';
  if (!Array.isArray(p.coordinates) || p.coordinates.length === 0) return 'Alanın köşe noktaları eksik.';
  let total = 0;
  for (let r = 0; r < p.coordinates.length; r++) {
    const ring = p.coordinates[r] as unknown;
    if (!Array.isArray(ring)) return 'Alanın köşe noktaları geçersiz.';
    for (const pos of ring as unknown[]) {
      if (!Array.isArray(pos) || pos.length < 2 || !isFiniteNum(pos[0]) || !isFiniteNum(pos[1])) {
        return 'Köşe noktaları [boylam, enlem] sayı çifti olmalı.';
      }
      const [lng, lat] = pos as number[];
      if (lng! < -180 || lng! > 180 || lat! < -90 || lat! > 90) return 'Köşe noktası harita sınırları dışında.';
    }
    const pts = ring as number[][];
    total += pts.length;
    if (pts.length < 4) return 'Alan en az 3 köşe noktasından oluşmalı.';
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) return 'Alan kapalı olmalı (ilk ve son nokta aynı).';
    const distinct = new Set(pts.slice(0, -1).map((q) => `${q[0]},${q[1]}`));
    if (distinct.size < 3) return 'Alan en az 3 farklı köşe noktasından oluşmalı.';
    if (Math.abs(ringArea(pts)) < 1e-12) return 'Alanın içi boş olamaz (noktalar tek çizgi üzerinde).';
  }
  if (total > MAX_POLYGON_POINTS) return `Alan en fazla ${MAX_POLYGON_POINTS} noktadan oluşabilir.`;
  return null;
}

/** Açık nokta listesini kapalı GeoJSON Polygon'a çevirir (harita çizimi). points: [lng, lat][] */
export function polygonFromPoints(points: readonly (readonly [number, number])[]): GeoJsonPolygon {
  const ring = points.map((p) => [p[0], p[1]]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0]!, first[1]!]);
  return { type: 'Polygon', coordinates: [ring] };
}

/** Mahalle adını düzenler: kırpma, çoklu boşluk. */
export function cleanNeighborhoodName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/**
 * Mahalle listesi: boş olamaz, her ad 2–60 karakter, bölge içinde tekrar yok (Türkçe büyük/küçük ve "Mah." eki
 * duyarsız). `taken`: tenant'ın diğer bölgelerindeki anahtar → bölge adı.
 */
export function validateNeighborhoods(
  names: readonly string[],
  taken: ReadonlyMap<string, string> = new Map(),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const cleaned = names.map(cleanNeighborhoodName).filter(Boolean);
  if (cleaned.length === 0) {
    issues.push({ path: 'neighborhoods', message: 'En az bir mahalle ekleyin.' });
    return issues;
  }
  if (cleaned.length > MAX_NEIGHBORHOODS_PER_ZONE) {
    issues.push({ path: 'neighborhoods', message: `Bir bölgeye en fazla ${MAX_NEIGHBORHOODS_PER_ZONE} mahalle eklenebilir.` });
  }
  const seen = new Set<string>();
  cleaned.forEach((n, i) => {
    const key = neighborhoodKey(n);
    if (n.length < 2 || n.length > 60 || !key) {
      issues.push({ path: `neighborhoods.${i}`, message: `"${n}" geçerli bir mahalle adı değil.` });
      return;
    }
    if (seen.has(key)) {
      issues.push({ path: `neighborhoods.${i}`, message: `"${n}" listede birden fazla kez var.` });
      return;
    }
    seen.add(key);
    const other = taken.get(key);
    if (other) issues.push({ path: `neighborhoods.${i}`, message: `"${n}" mahallesi "${other}" bölgesinde zaten tanımlı.` });
  });
  return issues;
}
