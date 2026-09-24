// Türkçe biçim yardımcıları (12 §11.2). Saat dilimi her zaman Europe/Istanbul.

import { formatTL as coreFormatTL, formatTLShort, formatTRY } from '@siparis/core/money';

export const APP_TIME_ZONE = 'Europe/Istanbul';

const NBSP = '\u00A0';
const MINUS = '\u2212';

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

// ---------------------------------------------------------------------------
// Para — kuruş biçimi tek kaynaktan: @siparis/core/money

const numberFormatters = new Map<string, Intl.NumberFormat>();
function numberFormat(min: number, max: number): Intl.NumberFormat {
  const key = `${min}-${max}`;
  let f = numberFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max });
    numberFormatters.set(key, f);
  }
  return f;
}

export type MoneyStyle = 'symbol' | 'text' | 'short';

/**
 * Kuruş (integer) → metin.
 * 'symbol' (varsayılan): "1.250,50 ₺" · 'text': "1.250,50 TL" (mesaj/fiş dili) · 'short': "150 TL" / "123,45 TL".
 */
export function formatMoney(kurus: number, style: MoneyStyle = 'symbol'): string {
  if (style === 'text') return coreFormatTL(kurus);
  if (style === 'short') return formatTLShort(kurus);
  return formatTRY(kurus);
}

export interface LiraFormatOptions {
  /** 'always': her zaman 2 hane; 'auto' (varsayılan): küsurat yoksa gösterme; 'never': tam TL. */
  decimals?: 'always' | 'auto' | 'never';
  /** Birim eki; varsayılan "TL". */
  unit?: string;
}

/**
 * TL cinsinden ondalıklı tutar (fiyat tablosu, hesaplayıcı): 11404.8 → "11.404,80 TL", 990 → "990 TL".
 * Sayı ile birim arasında bölünmez boşluk, eksi işareti "−" (12 §11.2).
 */
export function formatLira(amountTl: number, options: LiraFormatOptions = {}): string {
  const { decimals = 'auto', unit = 'TL' } = options;
  if (!Number.isFinite(amountTl)) return `—${NBSP}${unit}`;
  const negative = amountTl < 0;
  const abs = Math.abs(amountTl);
  let text: string;
  if (decimals === 'never') {
    text = numberFormat(0, 0).format(Math.round(abs));
  } else if (decimals === 'auto') {
    const hasFraction = Math.round(abs * 100) % 100 !== 0;
    text = hasFraction ? numberFormat(2, 2).format(abs) : numberFormat(0, 0).format(Math.round(abs));
  } else {
    text = numberFormat(2, 2).format(abs);
  }
  const showMinus = negative && /[1-9]/.test(text);
  return `${showMinus ? MINUS : ''}${text}${unit ? NBSP + unit : ''}`;
}

/** Sayı: 1234.5 → "1.234,5". */
export function formatNumber(value: number, maxFractionDigits = 2): string {
  return numberFormat(0, maxFractionDigits).format(value);
}

/** Oran: 0.25 → "%25". */
export function formatPercent(ratio: number, maxFractionDigits = 1): string {
  return `%${numberFormat(0, maxFractionDigits).format(ratio * 100)}`;
}

// ---------------------------------------------------------------------------
// Tarih ve saat

const timeParts = new Intl.DateTimeFormat('tr-TR', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dateParts = new Intl.DateTimeFormat('tr-TR', {
  timeZone: APP_TIME_ZONE,
  day: 'numeric',
  month: 'long',
  weekday: 'short',
});
const dateFull = new Intl.DateTimeFormat('tr-TR', {
  timeZone: APP_TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const dateNumeric = new Intl.DateTimeFormat('tr-TR', {
  timeZone: APP_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/** Saat "20.35" (Europe/Istanbul). */
export function formatTime(value: DateInput): string {
  const parts = timeParts.formatToParts(toDate(value));
  return `${part(parts, 'hour')}.${part(parts, 'minute')}`;
}

/** Tarih "24 Eylül Çar". */
export function formatDate(value: DateInput): string {
  const parts = dateParts.formatToParts(toDate(value));
  return `${part(parts, 'day')} ${part(parts, 'month')} ${part(parts, 'weekday')}`;
}

/** Tarih "24 Eylül 2026". */
export function formatDateLong(value: DateInput): string {
  return dateFull.format(toDate(value));
}

/** Tarih "24.09.2026". */
export function formatDateNumeric(value: DateInput): string {
  return dateNumeric.format(toDate(value));
}

/** "24 Eylül Çar 20.35". */
export function formatDateTime(value: DateInput): string {
  return `${formatDate(value)} ${formatTime(value)}`;
}

/** İstanbul saatine göre YYYY-MM-DD (gün sorguları için). */
export function toIstanbulDateKey(value: DateInput): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(toDate(value));
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

/** Göreli süre: "az önce", "12 dk önce", "3 sa önce", "2 gün önce", "5 dk sonra". */
export function formatRelative(value: DateInput, now: DateInput = Date.now()): string {
  const diffSec = Math.round((toDate(now).getTime() - toDate(value).getTime()) / 1000);
  const future = diffSec < 0;
  const s = Math.abs(diffSec);
  const suffix = future ? 'sonra' : 'önce';
  if (s < 45) return future ? 'birazdan' : 'az önce';
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} dk ${suffix}`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} sa ${suffix}`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} gün ${suffix}`;
  return formatDate(value);
}

/** Geçen süre sayacı: 134 → "2:14", 3723 → "1:02:03". */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Metin ve telefon

/** Türkçe büyük harf: "soğansız" → "SOĞANSIZ", "i" → "İ". */
export function trUpper(value: string): string {
  return value.toLocaleUpperCase('tr-TR');
}

/** Türkçe küçük harf: "IŞIK" → "ışık". */
export function trLower(value: string): string {
  return value.toLocaleLowerCase('tr-TR');
}

/** +905321234567 / 05321234567 → "0 (532) 123 45 67". Tanınmayan biçimi olduğu gibi döndürür. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  let local: string | null = null;
  if (digits.length === 12 && digits.startsWith('90')) local = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) local = digits.slice(1);
  else if (digits.length === 10) local = digits;
  if (!local) return value;
  return `0 (${local.slice(0, 3)}) ${local.slice(3, 6)} ${local.slice(6, 8)} ${local.slice(8, 10)}`;
}

/** Aksan duyarsız arama anahtarı: "Çiğ Köfte" → "cig kofte". */
export function searchKey(value: string): string {
  return trLower(value)
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}
