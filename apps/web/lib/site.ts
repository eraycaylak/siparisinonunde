// Site sabitleri. Künye bilgileri TASLAK: şirket belgeleriyle teyit edilecek (08 §4.7).

export const SITE_NAME = 'Siparişin Önünde';
export const SITE_TAGLINE = 'Keşif pazaryerinde, sadakat sende.';
export const SITE_DESCRIPTION =
  'Müşterin sana zaten WhatsApp’tan yazıyor. Siparişini komisyonsuz al, panelde sesli uyarıyla yönet; müşterine “Onaylandı” ve “Yolda” mesajı kendiliğinden gitsin.';

/** Pazarlama sitesinin tam adresi (metadataBase, sitemap, OpenGraph). */
export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

/** Storefront alt alan adı kökü (ör. siparisinonunde.com). Boşsa alt alan adı yönlendirmesi kapalı. */
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? '';

/** Pilot bölge (00 §12a). */
export const PILOT_AREA = { city: 'Yozgat', district: 'Merkez' } as const;

/** Künye (6563 m.3). Değerler şirket belgeleri gelince doldurulacak. */
export const LEGAL_ENTITY = {
  title: '[Şahıs şirketi unvanı — teyit edilecek]',
  type: 'Şahıs şirketi',
  taxOffice: '[Vergi dairesi — teyit edilecek]',
  taxNo: '[VKN/TCKN — teyit edilecek]',
  mersis: 'Şahıs şirketlerinde MERSİS numarası bulunmayabilir — teyit edilecek',
  chamber: '[Meslek odası — teyit edilecek]',
  address: '[Açık adres], Merkez / Yozgat',
  email: '[iletisim@alanadi — teyit edilecek]',
  phone: '[Telefon — teyit edilecek]',
} as const;

/** Yasal metinlerin taslak sürüm bilgisi. */
export const LEGAL_DRAFT = { version: '0.1-taslak', date: '24 Eylül 2026' } as const;

export const MARKETING_NAV = [
  { href: '/nasil-calisir', label: 'Nasıl çalışır' },
  { href: '/fiyatlar', label: 'Fiyatlar' },
  { href: '/hesaplayici', label: 'Hesaplayıcı' },
  { href: '/sss', label: 'SSS' },
  { href: '/demo', label: 'Demo iste' },
] as const;

export const LEGAL_NAV = [
  { href: '/yasal/kullanim-kosullari', label: 'Kullanım koşulları' },
  { href: '/yasal/gizlilik', label: 'Gizlilik politikası' },
  { href: '/yasal/kvkk-aydinlatma', label: 'KVKK aydınlatma metni' },
  { href: '/yasal/cerez', label: 'Çerez politikası' },
  { href: '/yasal/mesafeli-satis-sablonu', label: 'Mesafeli satış şablonu' },
  { href: '/kunye', label: 'Künye' },
] as const;
