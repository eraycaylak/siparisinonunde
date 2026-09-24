// Türkiye telefon numaraları: E.164 (+90XXXXXXXXXX). Tarayıcıda da çalışır.

export interface NormalizePhoneOptions {
  /** true: yalnız cep (5xx) kabul edilir. */
  mobileOnly?: boolean;
}

/**
 * TR numarasını E.164'e çevirir. Kabul: "0532 123 45 67", "5321234567", "+90 (532) 123-45-67",
 * "00905321234567", "905321234567". Geçersizse null.
 */
export function normalizePhone(input: string | null | undefined, opts: NormalizePhoneOptions = {}): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!/^[+\d\s().\-/]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('0090')) digits = digits.slice(4);
  else if (digits.startsWith('90') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  // Ulusal numara 2–5 ile başlar (sabit hat 2/3/4, cep 5)
  if (!/^[2-5]\d{9}$/.test(digits)) return null;
  if (opts.mobileOnly && !digits.startsWith('5')) return null;
  return `+90${digits}`;
}

/** TR cep numarası için kısayol: +905XXXXXXXXX ya da null. */
export function normalizeTrMobile(input: string | null | undefined): string | null {
  return normalizePhone(input, { mobileOnly: true });
}

export function isValidTrMobile(input: string | null | undefined): boolean {
  return normalizeTrMobile(input) !== null;
}

export function isValidTrPhone(input: string | null | undefined): boolean {
  return normalizePhone(input) !== null;
}

/** Görüntü biçimi: +905321234567 → "0532 123 45 67". Tanınmazsa girdi aynen döner. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const n = normalizePhone(e164);
  if (!n) return String(e164);
  const d = n.slice(3);
  return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`;
}

/** Maskeli gösterim, yalnız son 4 hane açık: "0*** *** 45 67" (loglar, fiş, panel). */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const n = normalizePhone(phone);
  const digits = n ? n.slice(3) : String(phone).replace(/\D/g, '');
  if (digits.length < 4) return '****';
  const last4 = digits.slice(-4);
  return `0*** *** ${last4.slice(0, 2)} ${last4.slice(2)}`;
}

/** wa.me bağlantısı için rakamlar: +905321234567 → "905321234567" */
export function toWaMeDigits(e164: string): string {
  return e164.replace(/\D/g, '');
}
