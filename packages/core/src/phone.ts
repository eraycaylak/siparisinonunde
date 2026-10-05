// Telefon numaraları: E.164. Türkiye numaraları ulusal biçimlerden de ("0532…", "532…") tanınır; Türkiye dışı
// numaralar YALNIZ açıkça uluslararası yazıldığında ("+49…", "0049…") kabul edilir. Tarayıcıda da çalışır.
//
// Neden Türkiye dışı da kabul ediliyor (denetim 2026-10-04, madde 12 / soru 4): eski davranışta `normalizePhone`
// yalnız +90 döndürüyordu, başka ülke numarası sessizce `null` oluyordu ve sipariş düşüyordu — ortak numaraya
// yazan yabancı numaralı müşteri çıkmaz sokakta kalıyordu. Artık numara KABUL edilir; Türkiye'ye özel kanallar
// (SMS/OTP) `normalizeTrMobile` ya da `isTrPhone` ile ayrıca süzülür, böylece "kabul" ile "SMS gönderilebilir"
// kararları birbirinden ayrışır.
//
// Ulusal biçim tahmini YALNIZ Türkiye için yapılır: "+" ya da "00" olmadan yazılan 10 haneli bir numara her zaman
// TR numarası sayılır (başka ülkenin ulusal biçimini tahmin etmek yanlış ülkeye mesaj göndermek demektir).

/** E.164 ülke kodu: Türkiye. */
const TR_CC = '90';
/** Türkiye ulusal numarası: 10 hane, 2–5 ile başlar (sabit hat 2/3/4, cep 5). */
const TR_NATIONAL = /^[2-5]\d{9}$/;
/** E.164: ülke kodu 0 ile başlamaz, toplam 8–15 hane (WhatsApp wa_id ile aynı aralık). */
const E164_DIGITS = /^[1-9]\d{7,14}$/;

export interface NormalizePhoneOptions {
  /** true: yalnız Türkiye cep numarası (+905XXXXXXXXX) kabul edilir. */
  mobileOnly?: boolean;
  /** true: Türkiye dışı numara reddedilir (yalnız +90). */
  trOnly?: boolean;
}

/** Yalnız rakamlardan Türkiye numarası (ulusal ya da ülke kodlu); değilse null. */
function trFromDigits(digits: string): string | null {
  let national = digits;
  if (national.startsWith('0090')) national = national.slice(4);
  if (national.startsWith(TR_CC) && national.length === 12) national = national.slice(2);
  else if (national.startsWith('0') && national.length === 11) national = national.slice(1);
  return TR_NATIONAL.test(national) ? `+${TR_CC}${national}` : null;
}

/**
 * Numarayı E.164'e çevirir. Kabul:
 *  - Türkiye: "0532 123 45 67", "5321234567", "+90 (532) 123-45-67", "00905321234567", "905321234567"
 *  - Türkiye dışı (yalnız açık uluslararası yazım): "+49 170 1234567", "0049 170 1234567"
 * Geçersizse null. `opts.trOnly` / `opts.mobileOnly` Türkiye dışını reddeder.
 */
export function normalizePhone(input: string | null | undefined, opts: NormalizePhoneOptions = {}): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!/^[+\d\s().\-/]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  const tr = trFromDigits(digits);
  if (tr) {
    if (opts.mobileOnly && !tr.startsWith(`+${TR_CC}5`)) return null;
    return tr;
  }
  if (opts.mobileOnly || opts.trOnly) return null;

  // Türkiye dışı: numara uluslararası yazılmış olmalı ("+" ya da "00" öneki). Öneksiz numara ulusal sayılır ve
  // ulusal tahmini yalnız TR için yapıldığından (yukarıda) burada reddedilir.
  const international = trimmed.startsWith('+') ? digits : digits.startsWith('00') ? digits.slice(2) : null;
  if (!international || !E164_DIGITS.test(international)) return null;
  // Ülke kodu 90 ise numara TR kurallarına uymak ZORUNDADIR: "+905321234567890" gibi bozuk bir numara
  // "yabancı numara" kılığında geçmesin (yanlış numaraya giden mesaj, kayıp sipariş).
  if (international.startsWith(TR_CC) && !trFromDigits(international)) return null;
  return `+${international}`;
}

/** TR cep numarası için kısayol: +905XXXXXXXXX ya da null. */
export function normalizeTrMobile(input: string | null | undefined): string | null {
  return normalizePhone(input, { mobileOnly: true });
}

/** Yalnız Türkiye numarası (sabit hat dahil): +90XXXXXXXXXX ya da null. */
export function normalizeTrPhone(input: string | null | undefined): string | null {
  return normalizePhone(input, { trOnly: true });
}

export function isValidTrMobile(input: string | null | undefined): boolean {
  return normalizeTrMobile(input) !== null;
}

export function isValidTrPhone(input: string | null | undefined): boolean {
  return normalizeTrPhone(input) !== null;
}

/**
 * Numara Türkiye numarası mı (E.164 ya da ulusal yazım). Türkiye'ye özel kanalların kapısı: NetGSM yalnız TR
 * numaralarına SMS gönderir, bu yüzden SMS yedeği bu kontrolden geçer (bkz. docs/02 §10.2).
 */
export function isTrPhone(input: string | null | undefined): boolean {
  return normalizeTrPhone(input) !== null;
}

/** Görüntü biçimi: +905321234567 → "0532 123 45 67". Türkiye dışı numara E.164 olarak döner. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const n = normalizePhone(e164);
  if (!n) return String(e164);
  if (!n.startsWith(`+${TR_CC}`)) return n;
  const d = n.slice(3);
  return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`;
}

/**
 * Maskeli gösterim, yalnız son 4 hane açık: TR "0*** *** 45 67", Türkiye dışı "+*** *** 45 67" (loglar, fiş, panel).
 * Ülke kodu da maskelenir: tek başına bile olsa kişiyi daraltan bir bilgidir (CLAUDE.md kural 7).
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const n = normalizePhone(phone);
  const tr = !n || n.startsWith(`+${TR_CC}`);
  const digits = n ? (tr ? n.slice(3) : n.slice(1)) : String(phone).replace(/\D/g, '');
  if (digits.length < 4) return '****';
  const last4 = digits.slice(-4);
  return `${tr ? '0' : '+'}*** *** ${last4.slice(0, 2)} ${last4.slice(2)}`;
}

/** wa.me bağlantısı için rakamlar: +905321234567 → "905321234567" */
export function toWaMeDigits(e164: string): string {
  return e164.replace(/\D/g, '');
}
