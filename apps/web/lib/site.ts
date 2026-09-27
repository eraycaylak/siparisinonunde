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
 * Herkese açık demo dağıtımı mı (Cloudflare, 15 §13): derleme anında gömülür (deploy/cloudflare/Dockerfile
 * NEXT_PUBLIC_DEPLOY_ENV=dev). Üretim ve yerel geliştirmede tanımsızdır.
 */
export function isDemoDeployment(value: string | undefined = process.env.NEXT_PUBLIC_DEPLOY_ENV): boolean {
  return value === 'dev';
}

/**
 * Demo dağıtımında sayfaların üstündeki uyarı (components/common/demo-notice.tsx). Metin derleme anında gömülür ve iki dev
 * kipinde de doğru kalmalıdır: simülatör (mock) ve gerçek WhatsApp (proje sahibinin kendi telefonlarıyla deneme; 15 §13).
 */
export const DEMO_NOTICE = {
  title: 'Demo ortamı.',
  body: 'Siparişler örnektir ve gerçek bir işletmeye gitmez. Gerçek adres ve telefon girmeyin.',
} as const;

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
