// Site sabitleri. Künye bilgileri TASLAK: şirket belgeleriyle teyit edilecek (08 §4.7).

export const SITE_NAME = 'Yemek Gelsin';
/** Alan adı (00 §12a madde 9). */
export const SITE_DOMAIN = 'yemekgelsin.net';
/**
 * Platformun iletişim e-postası (00 §12a madde 9). Posta kutusu henüz kurulmadı; yalnız ürünün platform iletişim
 * adresi gösterdiği yerlerde (künye, yasal metinler) kullanılır.
 */
export const SUPPORT_EMAIL = 'destek@yemekgelsin.net';
export const SITE_TAGLINE = 'Keşif pazaryerinde, sadakat sende.';

/**
 * Marka kırmızısı (logodan örneklendi; app/globals.css --brand-red ile aynı, 12 §3.2). CSS token'ı kullanılamayan yerler
 * için: panel PWA manifesti, harita işaretçisi.
 */
export const BRAND_RED = '#E3101B';

/**
 * Varsayılan bağlantı önizleme görseli (OpenGraph/Twitter): proje sahibinin logosundan 1200×630 (public/brand/og.jpg).
 * Pazarlama sitesi ve kendi görseli olmayan platform sayfaları kullanır; vitrin ve takip sayfası kullanmaz (işletme markası
 * önde, 00 §7 ve 12 §5.3).
 */
export const OG_IMAGE = { url: '/brand/og.jpg', width: 1200, height: 630, alt: 'Yemek Gelsin' } as const;
export const SITE_DESCRIPTION =
  'Müşterin QR’ını okutur, WhatsApp’tan menünü açar. Siparişini komisyonsuz al, panelde sesli uyarıyla yönet; müşterine “Onaylandı” ve “Yolda” mesajı kendiliğinden gitsin.';

/** Pazarlama sitesinin tam adresi (metadataBase, sitemap, OpenGraph). */
export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

/** Storefront alt alan adı kökü (ör. yemekgelsin.net). Boşsa alt alan adı yönlendirmesi kapalı. */
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? '';

/**
 * Platform destek hattı (WhatsApp), rakamlarla E.164: ör. 905321234567. Derleme anında gömülür
 * (docker-compose SUPPORT_WHATSAPP → NEXT_PUBLIC_SUPPORT_WHATSAPP). Boşsa giriş ekranı iletişim formunu gösterir.
 */
export const SUPPORT_WHATSAPP = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? '').replace(/\D/g, '');

/** Destek hattına hazır mesajlı wa.me bağlantısı; numara tanımlı değilse null. */
export function supportWhatsappHref(text: string): string | null {
  return SUPPORT_WHATSAPP ? `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}` : null;
}

/**
 * "Demo ortamı" uyarısı açık mı (components/common/demo-notice.tsx): yalnız kendi derleme bayrağıyla,
 * NEXT_PUBLIC_DEMO_BANNER=1 (00 §12a madde 10). Varsayılan kapalıdır: canlı ortam (Türkiye VPS) ve demo verisi olmayan
 * Cloudflare ortamı uyarı göstermez; yalnız demo verili gizli staging (deploy/cloudflare, SEED_MODE=demo) açar.
 */
export function isDemoBannerEnabled(value: string | undefined = process.env.NEXT_PUBLIC_DEMO_BANNER): boolean {
  return value === '1' || value === 'true';
}

/**
 * Demo uyarısının metni (components/common/demo-notice.tsx). Derleme anında gömülür; yalnız demo verili ortamlarda görünür.
 */
export const DEMO_NOTICE = {
  title: 'Demo ortamı.',
  body: 'Siparişler örnektir ve gerçek bir işletmeye gitmez. Gerçek adres ve telefon girmeyin.',
} as const;

/**
 * Pazarlama sitesindeki "Demo menüyü aç" bağlantısının vitrini (NEXT_PUBLIC_DEMO_STORE_SLUG). Tanımsızsa yerel
 * geliştirmenin demo işletmesi (seed: bozok-pide); boş verilirse (canlı ortam: demo işletme yok) bağlantı gösterilmez.
 */
export function demoStoreSlug(value: string | undefined = process.env.NEXT_PUBLIC_DEMO_STORE_SLUG): string | null {
  const slug = (value ?? 'bozok-pide').trim();
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) ? slug : null;
}

/**
 * Herkese açık lead formu (/demo: demo talebi, hesaplayıcıdan gelen talep) açık mı (NEXT_PUBLIC_LEAD_FORM; derleme
 * anında gömülür). Varsayılan açık. Kişisel veri yalnız Türkiye'deki altyapıda tutulur (CLAUDE.md kural 7; 00 §12a
 * madde 10): Türkiye dışındaki Cloudflare ortamının alan adı kipi 0 ile derler; /demo formu göstermez (API de kayıt
 * almaz: PUBLIC_LEADS_ENABLED=0), varsa destek hattının WhatsApp bağlantısını gösterir.
 */
export function isLeadFormEnabled(value: string | undefined = process.env.NEXT_PUBLIC_LEAD_FORM): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false');
}

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
  email: SUPPORT_EMAIL,
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
