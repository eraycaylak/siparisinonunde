// Kural tabanlı niyet eşleme (03 §8.2, 02 §6.4, §6.9): büyük/küçük harf ve Türkçe karakter duyarsız.

import { ORDER_CODE_PATTERN } from '@siparis/core';

/** Türkçe karakterleri ASCII'ye indirger, küçük harf, fazla boşlukları tekler. */
export function foldTr(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/û/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Noktalama atılmış, katlanmış tam metin (opt-out gibi "mesajın tamamı" eşleşmeleri için). */
export function bareText(input: string): string {
  return foldTr(input)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Opt-out: yalnız mesajın TAMAMI eşleşirse ("Dur, adresi değiştireyim" sayılmaz). */
const OPT_OUT = new Set(['dur', 'stop', 'mesaj atmayin', 'abonelikten cik', 'iptal abonelik', 'abonelik iptal', 'abonelikten ayril']);
/** Opt-in: "BAŞLAT" (03) ve "BAŞLA". */
const OPT_IN = new Set(['baslat', 'basla', 'start']);

export function isOptOut(text: string): boolean {
  return OPT_OUT.has(bareText(text));
}

export function isOptIn(text: string): boolean {
  return OPT_IN.has(bareText(text));
}

/** "yetkili", "insan", "operatör", "müşteri hizmetleri", "Yetkiliyle görüş" (kelime olarak). */
export function isHandoffRequest(text: string): boolean {
  const t = ` ${bareText(text)} `;
  return /\s(yetkili\w*|insan|operator\w*|musteri hizmetleri\w*|canli destek)\s/.test(t);
}

/**
 * Sipariş kodu (Akış B): "Sipariş kodu: K7M2Q9" ya da yalın "K7M2Q9" (en az 1 rakam; "BURADA" gibi kelimeler
 * kod sayılmaz). Kod alfabesi core ORDER_CODE_PATTERN.
 */
export function matchOrderCode(text: string): string | null {
  const t = text.normalize('NFKC').toLocaleUpperCase('tr-TR').replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ü/g, 'U');
  const prefixed = /SIPARIS\s*KODU?\s*[:：]?\s*([A-Z0-9]{6})(?![A-Z0-9])/.exec(t);
  if (prefixed?.[1]) {
    const m = ORDER_CODE_PATTERN.exec(prefixed[1]);
    if (m?.[1] && /\d/.test(m[1])) return m[1];
  }
  const bare = t.trim();
  if (/^[A-Z0-9]{6}$/.test(bare) && /\d/.test(bare)) {
    const m = ORDER_CODE_PATTERN.exec(bare);
    if (m?.[1] === bare) return bare;
  }
  return null;
}

export type SimpleIntent = 'hours' | 'address' | 'zones' | 'payment' | 'cancel' | 'where';

/** Faz 1 SSS niyetleri (03 §8.2). Selam/menü niyeti ayrıca eşlenmez (karşılama varyantı). */
export function detectIntent(text: string): SimpleIntent | null {
  const t = ` ${bareText(text)} `;
  if (/\s(iptal|vazgectim|istemiyorum)\s/.test(t)) return 'cancel';
  if (/(siparisim nerede|siparis nerede|ne zaman gelir|ne zaman gelecek|nerede kaldi|gelmedi)/.test(t)) return 'where';
  if (/(kaca kadar|acik misiniz|kacta acil|kacta kapan|calisma saat|saat kac)/.test(t)) return 'hours';
  if (/(neredesiniz|adresiniz|adres ne|konumunuz)/.test(t)) return 'address';
  if (/(geliyor musunuz|min sepet|minimum sepet|servis ucreti|teslimat ucreti|getiriyor musunuz)/.test(t)) return 'zones';
  if (/(kart geciyor|kredi karti|multinet|pluxee|edenred|setcard|metropol|yemek karti|sodexo|ticket)/.test(t)) return 'payment';
  return null;
}
