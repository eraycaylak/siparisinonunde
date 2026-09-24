// Para: integer kuruş (00 §10, CLAUDE.md kural 9). Türkçe biçim: 1.234,56

/** Kuruşu "1.234,56" biçimine çevirir (para birimi simgesi olmadan). */
export function formatKurus(kurus: number): string {
  const sign = kurus < 0 ? '-' : '';
  const abs = Math.abs(Math.round(kurus));
  const lira = Math.floor(abs / 100);
  const k = abs % 100;
  const liraStr = String(lira).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${liraStr},${String(k).padStart(2, '0')}`;
}

/** 12345 → "123,45 ₺" */
export function formatTRY(kurus: number): string {
  return `${formatKurus(kurus)} ₺`;
}

/** Mesaj metinleri için (03 §9): 48500 → "485,00 TL" */
export function formatTL(kurus: number): string {
  return `${formatKurus(kurus)} TL`;
}

/** Kısa gösterim: tam liraysa kuruşsuz. 15000 → "150 TL", 12345 → "123,45 TL" */
export function formatTLShort(kurus: number): string {
  if (kurus % 100 === 0) {
    const s = formatKurus(kurus);
    return `${s.slice(0, -3)} TL`;
  }
  return formatTL(kurus);
}

/**
 * Metni kuruşa çevirir. Kabul: "123,45", "1.234,56", "1234.5", "123", "123,45 ₺", "123 TL".
 * Geçersizse null.
 */
export function parseTRY(input: string): number | null {
  if (typeof input !== 'string') return null;
  let s = input.replace(/₺|TL|TRY/gi, '').replace(/\s+/g, '').trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  let intPart: string;
  let fracPart = '';
  if (s.includes(',')) {
    // Türkçe: virgül ondalık, nokta binlik
    const parts = s.split(',');
    if (parts.length !== 2) return null;
    intPart = parts[0]!.replace(/\./g, '');
    fracPart = parts[1]!;
    if (!/^\d{1,3}(\.\d{3})+$|^\d+$/.test(parts[0]!)) return null;
  } else {
    const dots = s.split('.');
    if (dots.length === 2 && dots[1]!.length > 0 && dots[1]!.length <= 2) {
      intPart = dots[0]!;
      fracPart = dots[1]!;
    } else {
      if (dots.length > 1 && !dots.slice(1).every((p) => p.length === 3)) return null;
      intPart = dots.join('');
    }
  }
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(fracPart)) return null;
  const value = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

/** TL (ondalıklı) → kuruş, yarım yukarı yuvarlar. */
export function tlToKurus(tl: number): number {
  return roundHalfUp(tl * 100);
}

/** Pozitif yönde yarım yukarı (negatifte simetrik) yuvarlama. */
export function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1;
  // Kayan nokta gürültüsünü (ör. 0.5000000001) bastır
  const abs = Math.abs(value);
  return sign * Math.floor(abs + 0.5 + 1e-9);
}
