// Ortak WhatsApp numarası (00 §12a madde 8): dükkan kodu (tenants.wa_code), QR/wa.me ön-dolu metni ve dükkan seçme
// komutları. Saf fonksiyonlar; API (yönlendirici, panel, vitrin) ve web aynı kuralları kullanır.

import { toWaMeDigits } from './phone';
import { slugifyTr } from './slug';

/** Ortak numaranın sohbet başlığında görünen adı (platform markası). */
export const SHARED_WA_DISPLAY_NAME = 'Siparişin Önünde';

/** Geliştirmede (mock) ortak numaranın gösterim numarası (seed ve simülatör). */
export const MOCK_SHARED_WA_DISPLAY_PHONE = '+905550000000';

/** Dükkan kodu: büyük harf A–Z ve rakam, 3–12 karakter (ör. BOZOK, DONER). En az bir harf ayrıca gerekir (waCodeProblem). */
export const WA_CODE_PATTERN = /^[A-Z0-9]{3,12}$/;
/** Koddaki zorunlu harf: yalnız rakamdan oluşan kod "#1047" gibi sipariş numarasıyla karışır (tr.ts "Sipariş no: #1047"). */
const WA_CODE_LETTER = /[A-Z]/;
export const WA_CODE_MIN = 3;
export const WA_CODE_MAX = 12;
/** Kayıtta slug'dan üretilen kodun en fazla uzunluğu (çakışma soneki için yer kalır). */
const WA_CODE_BASE_MAX = 10;

/**
 * Kod olarak kullanılamayan sözcükler: bot komutları ve sık selamlar. Mesajın tamamı bir koda eşitse dükkan seçildiği
 * için bunlar kod olursa komutlar (DUR, BAŞLAT, liste…) ya da selamlar yanlış dükkana yönlenirdi.
 */
export const RESERVED_WA_CODES: ReadonlySet<string> = new Set([
  'DUR', 'STOP', 'START', 'BASLA', 'BASLAT', 'LISTE', 'DUKKAN', 'DUKKANLAR', 'DEGISTIR', 'YETKILI', 'INSAN', 'OPERATOR',
  'IPTAL', 'MENU', 'MERHABA', 'MRB', 'SELAM', 'SLM', 'EVET', 'HAYIR', 'TAMAM', 'SIPARIS', 'YARDIM', 'KOD', 'TEST',
]);

/** Akış B sipariş koduna benzeyen kod (6 karakter, karışmayan alfabe, en az 1 rakam) — yönlendirmede karışır. */
export function looksLikeOrderCode(code: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) && /\d/.test(code);
}

const TR_UPPER: Record<string, string> = { Ç: 'C', Ğ: 'G', İ: 'I', I: 'I', Ö: 'O', Ş: 'S', Ü: 'U', Â: 'A', Î: 'I', Û: 'U' };

/** Serbest girişi koda çevirir: Türkçe harfler ASCII'ye, büyük harf, boşluk/#/tire atılır. Geçersizse null. */
export function normalizeWaCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const upper = input.normalize('NFKC').toLocaleUpperCase('tr-TR');
  let out = '';
  for (const ch of upper) out += TR_UPPER[ch] ?? ch;
  out = out.replace(/[\s#_.-]+/g, '');
  return WA_CODE_PATTERN.test(out) ? out : null;
}

export type WaCodeProblem = 'format' | 'digits_only' | 'reserved' | 'order_code';

/** Kodun kullanılabilirliği (tekillik ayrıca veritabanında denetlenir). */
export function waCodeProblem(code: string): WaCodeProblem | null {
  if (!WA_CODE_PATTERN.test(code)) return 'format';
  if (!WA_CODE_LETTER.test(code)) return 'digits_only';
  if (RESERVED_WA_CODES.has(code)) return 'reserved';
  if (looksLikeOrderCode(code)) return 'order_code';
  return null;
}

export const WA_CODE_PROBLEM_MESSAGES: Record<WaCodeProblem, string> = {
  format: 'Dükkan kodu 3–12 karakter olmalı; yalnız harf (A–Z) ve rakam kullanın.',
  digits_only: 'Dükkan kodu en az bir harf içermeli; yalnız rakamdan oluşan kod sipariş numarasıyla (#1047) karışır.',
  reserved: 'Bu sözcük bot komutu olduğu için dükkan kodu olamaz.',
  order_code: '6 karakterli ve rakam içeren kod sipariş koduyla karışır; başka bir kod seçin.',
};

/**
 * Slug'dan kod tabanı: ilk parça (4 karakterden kısaysa ya da harf içermiyorsa sonraki parçalar eklenir), büyük harf,
 * en çok 10 karakter; yine harf yoksa "DKN" eki. "bozok-pide" → BOZOK, "camlik-doner" → CAMLIK, "a-b-c" → ABC,
 * "1453-kebap" → 1453KEBAP, "1453" → 1453DKN. Migration 0901'deki SQL ile aynı kural.
 */
export function waCodeBase(slugOrName: string): string {
  const segs = slugifyTr(slugOrName).split('-').filter(Boolean);
  let code = '';
  for (const s of segs) {
    code += s;
    if (code.length >= 4 && /[a-z]/.test(code)) break;
  }
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, WA_CODE_BASE_MAX);
  if (!WA_CODE_LETTER.test(code)) code = `${code.slice(0, WA_CODE_BASE_MAX - 3)}DKN`;
  if (code.length < WA_CODE_MIN) code = `${code}DKN`.slice(0, WA_CODE_MIN);
  return code;
}

/** n. aday (1 = taban; sonrakiler rakam soneki): BOZOK, BOZOK2, BOZOK3… Kullanılamayan adaylar atlanır. */
export function waCodeCandidate(base: string, n: number): string {
  if (n <= 1) return base;
  const suffix = String(n);
  return `${base.slice(0, WA_CODE_MAX - suffix.length)}${suffix}`;
}

/** Tabandan başlayarak kullanılabilir ilk kodu bulur (`taken` dolu kodlar). */
export async function pickWaCode(slugOrName: string, taken: (code: string) => boolean | Promise<boolean>): Promise<string> {
  const base = waCodeBase(slugOrName);
  for (let n = 1; n < 10_000; n++) {
    const c = waCodeCandidate(base, n);
    if (waCodeProblem(c)) continue;
    if (!(await taken(c))) return c;
  }
  throw new Error('Dükkan kodu üretilemedi');
}

/** QR/bağlantının ön-dolu mesajı: dükkan adı + #KOD (yönlendirici #KOD'u okur). */
export function sharedPrefillText(shopName: string, code: string): string {
  return `Merhaba, ${shopName.trim()} için sipariş vermek istiyorum. #${code}`;
}

/** Ortak numaraya dükkan kodlu wa.me bağlantısı (QR içeriği). */
export function sharedWaLink(displayPhone: string, shopName: string, code: string): string {
  return `https://wa.me/${toWaMeDigits(displayPhone)}?text=${encodeURIComponent(sharedPrefillText(shopName, code))}`;
}

/**
 * Mesajdaki "#KOD" belirteçleri (normalize edilmiş; sırayla, tekrarsız). Yalnız rakamdan oluşan "#1047" sipariş
 * numarasıdır (bot mesajlarındaki "Sipariş no: #1047"), dükkan kodu sayılmaz.
 */
export function extractHashCodes(text: string): string[] {
  const out: string[] = [];
  const re = /#\s?([0-9A-Za-zÇĞİÖŞÜÂÎÛçğıöşüâîû]{3,12})(?![0-9A-Za-zÇĞİÖŞÜÂÎÛçğıöşüâîû])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const c = normalizeWaCode(m[1]!);
    if (c && WA_CODE_LETTER.test(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Dükkan seçici komutları (mesajın tamamı; Türkçe karakter ve büyük/küçük harf duyarsız, katlanmış biçim). */
export const SHOP_LIST_COMMANDS: ReadonlySet<string> = new Set(['dukkanlar', 'liste', 'dukkan listesi', 'tum dukkanlar']);
export const SHOP_PICKER_COMMANDS: ReadonlySet<string> = new Set(['dukkan', 'degistir', 'baska dukkan', 'dukkan degistir', 'dukkan sec']);

/** Dükkan seçici buton/liste kimlikleri (ortak numara; 14 §8). */
export const SHARED_BUTTON_IDS = {
  shop: (tenantId: string) => `shop:${tenantId}`,
  list: 'shops:list',
  page: (n: number) => `shops:page:${n}`,
  /** Ad eşleşmesi listesinin sayfası: eşleşen dükkanlar ilk listenin platform mesajında (shared_wa_messages) saklıdır */
  matchPage: (listId: string, n: number) => `shops:m:${listId}:${n}`,
} as const;
