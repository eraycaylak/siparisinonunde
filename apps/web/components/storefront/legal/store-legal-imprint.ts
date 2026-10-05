// Satıcı / veri sorumlusu künyesi ve belge yapı taşları (08 §4.7). İşletmeye özel yasal metinlerin ortak tarafı:
// künyeyi yer tutucularla tamamlama, künye tabloları ve şikâyet/başvuru cümleleri. Belge metinleri store-legal.ts'te.

import type { StorefrontView } from '@siparis/core/menu/contracts';
import { formatPhone } from '@/lib/format';

/** Zorunlu künye alanı boşsa gösterilen yer tutucular (08 §4.7 zorunlu alanlar). */
export const IMPRINT_PLACEHOLDERS = {
  legalName: '[İşletme unvanı]',
  address: '[İşletme adresi]',
  phone: '[İşletme telefonu]',
  taxNo: '[Vergi kimlik no]',
} as const;

export interface ImprintInput {
  /** Ticari ad (vitrinde görünen işletme adı). */
  name: string;
  legal: {
    legalName?: string | null;
    taxNo?: string | null;
    taxOffice?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  /** Künye adresi yoksa şube adresi (panel künye kontrolüyle aynı kural). */
  branchAddress?: string | null;
  /** Künye telefonu yoksa şube/işletme telefonu. */
  phone?: string | null;
}

export interface SellerImprint {
  tradeName: string;
  legalName: string;
  address: string;
  /** Biçimli telefon ya da yer tutucu. */
  phone: string;
  email: string | null;
  taxOffice: string | null;
  taxNo: string;
  /** Eksik zorunlu alanların adları (boşsa künye tam). */
  missing: string[];
}

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** Künyeyi yer tutucularla tamamlar. İsteğe bağlı alanlar (e-posta, vergi dairesi) boşsa null kalır, yer tutucu basılmaz. */
export function sellerImprint(input: ImprintInput): SellerImprint {
  const legalName = clean(input.legal.legalName);
  const address = clean(input.legal.address) ?? clean(input.branchAddress);
  const phoneRaw = clean(input.legal.phone) ?? clean(input.phone);
  const taxNo = clean(input.legal.taxNo);
  const missing: string[] = [];
  if (!legalName) missing.push('Unvan');
  if (!address) missing.push('Adres');
  if (!phoneRaw) missing.push('Telefon');
  if (!taxNo) missing.push('Vergi kimlik no');
  return {
    tradeName: input.name.trim(),
    legalName: legalName ?? IMPRINT_PLACEHOLDERS.legalName,
    address: address ?? IMPRINT_PLACEHOLDERS.address,
    phone: phoneRaw ? formatPhone(phoneRaw) : IMPRINT_PLACEHOLDERS.phone,
    email: clean(input.legal.email),
    taxOffice: clean(input.legal.taxOffice),
    taxNo: taxNo ?? IMPRINT_PLACEHOLDERS.taxNo,
    missing,
  };
}

/** Storefront yanıtından künye. */
export function storeImprint(store: StorefrontView): SellerImprint {
  return sellerImprint({
    name: store.tenant.name,
    legal: store.legal,
    branchAddress: store.branch.address,
    phone: store.branch.phone ?? store.tenant.phone,
  });
}

export interface ImprintRow {
  label: string;
  value: string;
}

/** Künye tablosu satırları (belge başı, altbilgi, takip sayfası). */
export function imprintRows(i: SellerImprint): ImprintRow[] {
  const rows: ImprintRow[] = [{ label: 'Unvan', value: i.legalName }];
  if (i.tradeName && i.tradeName !== i.legalName) rows.push({ label: 'İşletme adı', value: i.tradeName });
  rows.push({ label: 'Adres', value: i.address }, { label: 'Telefon', value: i.phone });
  if (i.email) rows.push({ label: 'E-posta', value: i.email });
  if (i.taxOffice) rows.push({ label: 'Vergi dairesi', value: i.taxOffice });
  rows.push({ label: 'Vergi kimlik no', value: i.taxNo });
  return rows;
}

/**
 * Yalnız dolu künye alanları (yer tutucusuz): vitrin altbilgisi ve takip sayfasındaki "İşletme bilgileri" kutusu.
 * Unvan yoksa ticari ad gösterilir.
 */
export function availableImprintRows(input: ImprintInput): ImprintRow[] {
  const phone = clean(input.legal.phone) ?? clean(input.phone);
  const rows: [string, string | null][] = [
    ['Unvan', clean(input.legal.legalName) ?? clean(input.name)],
    ['Adres', clean(input.legal.address) ?? clean(input.branchAddress)],
    ['Telefon', phone ? formatPhone(phone) : null],
    ['E-posta', clean(input.legal.email)],
    ['Vergi dairesi', clean(input.legal.taxOffice)],
    ['Vergi kimlik no', clean(input.legal.taxNo)],
  ];
  return rows.filter((r): r is [string, string] => Boolean(r[1])).map(([label, value]) => ({ label, value }));
}

/** Şikâyet için iletişim: "{adres} adresine, {telefon} numaralı telefona ya da {e-posta} e-posta adresine". */
export function contactPhrase(i: SellerImprint): string {
  const parts = [`${i.address} adresine`, `${i.phone} numaralı telefona`];
  if (i.email) parts.push(`${i.email} e-posta adresine`);
  return `${parts.slice(0, -1).join(', ')} ya da ${parts.at(-1)}`;
}

/** KVKK başvurusu yazılıdır (Başvuru Tebliği): adres ve varsa e-posta; telefon yalnız bilgi için. */
export function writtenContactPhrase(i: SellerImprint): string {
  return i.email ? `${i.address} adresine ya da ${i.email} e-posta adresine` : `${i.address} adresine`;
}

// ---------------------------------------------------------------------------
// Belge yapı taşları

export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'facts'; rows: ImprintRow[] };

export interface LegalSection {
  title: string;
  blocks: LegalBlock[];
}

export const p = (text: string): LegalBlock => ({ kind: 'p', text });
export const list = (items: string[]): LegalBlock => ({ kind: 'list', items });
