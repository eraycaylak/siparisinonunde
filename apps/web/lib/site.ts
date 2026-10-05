// Site sabitleri. Künye (6563 m.3) ve yasal metin sürümü yapılandırmadan gelir: değerler ortam değişkeninde tutulur,
// kodda yer tutucu metin bulunmaz (08 §4.7; denetim B1, B12). Eksik değer uydurulmaz, açıkça "eksik yapılandırma"
// durumu oluşur ve `scripts/check-legal.ts` dağıtımı durdurur.

import { LEGAL_DOCUMENT_VERSION, isDraftLegalVersion } from '@siparis/core/enums';

export const SITE_NAME = 'Yemek Gelsin';
/** Alan adı (00 §12a madde 9). */
export const SITE_DOMAIN = 'yemekgelsin.net';
/**
 * Platformun marka e-postası (00 §12a madde 9): künye, yasal metinler ve KVKK başvuru adresi. Posta kutusunun gerçekten
 * açık olması canlıya çıkış ön koşuludur (KVKK m.13: 30 günlük cevap süresi, 15 §12). Künyede gösterilen adres
 * `LEGAL_SUPPORT_EMAIL` ile değiştirilebilir.
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
 * NEXT_PUBLIC_DEMO_BANNER=1 (00 §12a madde 10). Varsayılan kapalıdır: canlı ortam (Cloudflare, gerçek veri) uyarı
 * göstermez; yalnız demo verili gizli staging (deploy/cloudflare, SEED_MODE=demo) açar.
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
 * anında gömülür). Varsayılan açık; canlı ortamda açıktır (00 §12a madde 10). Operatör formu geçici kapatmak için 0 ile
 * derler: /demo formu göstermez (API de kayıt almaz: PUBLIC_LEADS_ENABLED=0), varsa destek hattının WhatsApp
 * bağlantısını gösterir.
 */
export function isLeadFormEnabled(value: string | undefined = process.env.NEXT_PUBLIC_LEAD_FORM): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false');
}

/** Pilot bölge (00 §12a). */
export const PILOT_AREA = { city: 'Yozgat', district: 'Merkez' } as const;

// ---------------------------------------------------------------------------
// Künye (6563 m.3) — tek yapılandırma kaynağı

interface LegalEntityFieldSpec {
  /** Değerin okunduğu ortam değişkeni. */
  env: string;
  /** Künye tablosundaki etiket. */
  label: string;
  /** 6563 m.3 zorunlu alanı mı (eksikse künye yayına hazır değildir). */
  required: boolean;
  /** Ortam değişkeni boşsa kullanılacak değer; yalnız markada sabit olan alanlar için tanımlıdır. */
  fallback?: string;
}

/** Künye alanının geldiği ortam değişkeni ve zorunluluğu (08 §4.7). Değerler koda yazılmaz. */
const LEGAL_ENTITY_FIELDS = {
  title: { env: 'LEGAL_ENTITY_NAME', label: 'Unvan', required: true },
  type: { env: 'LEGAL_ENTITY_TYPE', label: 'Şirket türü', required: true },
  address: { env: 'LEGAL_ENTITY_ADDRESS', label: 'Adres', required: true },
  // Marka e-postası 00 §12a madde 9 ile sabit; değişkenle değiştirilebilir ama hiç boş kalmaz.
  email: { env: 'LEGAL_SUPPORT_EMAIL', label: 'E-posta', required: true, fallback: SUPPORT_EMAIL },
  phone: { env: 'LEGAL_ENTITY_PHONE', label: 'Telefon', required: true },
  taxOffice: { env: 'LEGAL_ENTITY_TAX_OFFICE', label: 'Vergi dairesi', required: true },
  taxNo: { env: 'LEGAL_ENTITY_TAX_NO', label: 'Vergi / T.C. kimlik no', required: true },
  mersis: { env: 'LEGAL_ENTITY_MERSIS', label: 'MERSİS no', required: false },
  chamber: { env: 'LEGAL_ENTITY_CHAMBER', label: 'Meslek odası', required: false },
  kep: { env: 'LEGAL_ENTITY_KEP', label: 'KEP adresi', required: false },
} satisfies Record<string, LegalEntityFieldSpec>;

export type LegalEntityField = keyof typeof LEGAL_ENTITY_FIELDS;

export interface LegalEntity extends Record<LegalEntityField, string> {
  /** Eksik zorunlu alanların ortam değişkeni adları (boşsa künye tam). */
  missing: string[];
  /** Zorunlu alanların hepsi dolu mu (6563 m.3 künye yayına hazır mı). */
  isConfigured: boolean;
}

/** İsteğe bağlı alan boşsa gösterilen metin: yer tutucu değil, "bilgi yok" beyanı. */
export const LEGAL_ENTITY_NOT_APPLICABLE = 'Yok';

/** Zorunlu alan boşsa gösterilen metin: hangi ortam değişkeninin eksik olduğunu söyler, veri uydurmaz. */
export function legalEntityMissingText(env: string): string {
  return `Eksik yapılandırma: ${env}`;
}

const trimmed = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Ortam değişkenlerinden künye. `LEGAL_*` birincil addır (konteyner ortamı); `NEXT_PUBLIC_LEGAL_*` yalnız değerin
 * istemci paketine de gömülmesi gerektiğinde kullanılır. Web imajı derleme anında okur (NEXT_PUBLIC_* ile aynı kural,
 * 15 §4): değer değişirse web yeniden derlenir.
 */
function legalEntityEnv(): Record<LegalEntityField, string | undefined> {
  const e = process.env;
  return {
    title: e.LEGAL_ENTITY_NAME ?? e.NEXT_PUBLIC_LEGAL_ENTITY_NAME,
    type: e.LEGAL_ENTITY_TYPE ?? e.NEXT_PUBLIC_LEGAL_ENTITY_TYPE,
    address: e.LEGAL_ENTITY_ADDRESS ?? e.NEXT_PUBLIC_LEGAL_ENTITY_ADDRESS,
    email: e.LEGAL_SUPPORT_EMAIL ?? e.NEXT_PUBLIC_LEGAL_SUPPORT_EMAIL,
    phone: e.LEGAL_ENTITY_PHONE ?? e.NEXT_PUBLIC_LEGAL_ENTITY_PHONE,
    taxOffice: e.LEGAL_ENTITY_TAX_OFFICE ?? e.NEXT_PUBLIC_LEGAL_ENTITY_TAX_OFFICE,
    taxNo: e.LEGAL_ENTITY_TAX_NO ?? e.NEXT_PUBLIC_LEGAL_ENTITY_TAX_NO,
    mersis: e.LEGAL_ENTITY_MERSIS ?? e.NEXT_PUBLIC_LEGAL_ENTITY_MERSIS,
    chamber: e.LEGAL_ENTITY_CHAMBER ?? e.NEXT_PUBLIC_LEGAL_ENTITY_CHAMBER,
    kep: e.LEGAL_ENTITY_KEP ?? e.NEXT_PUBLIC_LEGAL_ENTITY_KEP,
  };
}

/**
 * Künyeyi çözer: eksik zorunlu alan için yer tutucu metin değil, hangi değişkenin eksik olduğunu söyleyen açık bir
 * "eksik yapılandırma" durumu üretir. Yalnız `fallback`'i tanımlı alanlar (marka e-postası) boş kalmaz.
 */
export function resolveLegalEntity(raw: Partial<Record<LegalEntityField, string | undefined>> = legalEntityEnv()): LegalEntity {
  const missing: string[] = [];
  const values = {} as Record<LegalEntityField, string>;
  for (const key of Object.keys(LEGAL_ENTITY_FIELDS) as LegalEntityField[]) {
    const field: LegalEntityFieldSpec = LEGAL_ENTITY_FIELDS[key];
    const value = trimmed(raw[key]) ?? field.fallback ?? null;
    if (value) {
      values[key] = value;
      continue;
    }
    if (field.required) {
      missing.push(field.env);
      values[key] = legalEntityMissingText(field.env);
    } else {
      values[key] = LEGAL_ENTITY_NOT_APPLICABLE;
    }
  }
  return { ...values, missing, isConfigured: missing.length === 0 };
}

/** Künye satırları (etiket + değer) künye sayfası ve DPA için tek sırada. */
export function legalEntityRows(entity: LegalEntity = LEGAL_ENTITY): Array<{ label: string; value: string }> {
  return (Object.keys(LEGAL_ENTITY_FIELDS) as LegalEntityField[]).map((key) => ({
    label: LEGAL_ENTITY_FIELDS[key].label,
    value: entity[key],
  }));
}

/** Künye (6563 m.3). Değerler ortam değişkenlerinden gelir; eksikse `missing` doludur ve sayfa uyarı gösterir. */
export const LEGAL_ENTITY: LegalEntity = resolveLegalEntity();

// ---------------------------------------------------------------------------
// Yasal metin sürümü

/**
 * Yasal metinlerin yürürlükteki sürümü. Tek kaynak `@siparis/core/enums` → `LEGAL_DOCUMENT_VERSION`: kabul kaydına
 * (`legal_acceptances.version`) yazılan sürümle ekranda gösterilen sürüm aynı olmalıdır (08 §7.5; denetim H19).
 * `isDraft` true iken metinler avukat onayı beklemektedir; bu hâlde sipariş ucu fail-closed reddeder.
 */
export const LEGAL_TEXT_VERSION = {
  version: LEGAL_DOCUMENT_VERSION,
  isDraft: isDraftLegalVersion(LEGAL_DOCUMENT_VERSION),
} as const;

/**
 * @deprecated `LEGAL_TEXT_VERSION` kullanın. Yalnız `components/marketing/legal-page.tsx` geriye dönük uyumu için
 * duruyor; `date` artık sürümün kendisinden türetilir (ISO önekli sürümlerde tarih sürümün içindedir).
 */
export const LEGAL_DRAFT = { version: LEGAL_TEXT_VERSION.version, date: LEGAL_TEXT_VERSION.version.slice(0, 10) } as const;

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
  { href: '/yasal/dpa', label: 'Veri işleme sözleşmesi' },
  { href: '/yasal/alt-isleyenler', label: 'Alt işleyenler' },
  { href: '/kunye', label: 'Künye' },
] as const;
