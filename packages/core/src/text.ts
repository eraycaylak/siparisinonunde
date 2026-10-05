// Arama anahtarı: Türkçe harf katlama (müşteri adı araması, 04 §4.13). Tarayıcıda ve sunucuda aynı sonucu verir.
//
// NEDEN AYRI BİR KATLAMA (`turkishLower` yetmiyor): ad araması veritabanında bir İFADE İNDEKSİ üzerinden
// koşuyor (`packages/db/migrations/0006_customers_search_index.sql` → `customers_tenant_name_fold_idx`).
// İndeksin ifadesi `translate(...)`'dır; bu fonksiyon onun TS ikizidir ve ikisi BİREBİR aynı dizgeyi üretmek
// zorundadır — ayrışırsa istemcinin ürettiği desen indekse uymaz ve arama sessizce yanlış sonuç verir.
// Tek kaynak: `NAME_FOLD_SQL` (apps/api/src/services/customers/lookup.ts) ↔ `FOLD_FROM`/`FOLD_TO` (burası).
//
// `turkishLower` (zones.ts) PostgreSQL'de karşılığı OLMAYAN bir dönüşümdür; "küçült, sonra karşılaştır" yolu
// ise iki ayrı sebepten ÇALIŞMAZ. ÖLÇÜLDÜ (PostgreSQL 17, libc sağlayıcısı, iki ayrı veritabanı):
//   1. NOKTASIZ ı / NOKTALI İ — collation'dan BAĞIMSIZ, her yerde başarısız. `lower('Ahmet Yıldız')` →
//      `'ahmet yıldız'` (ı olduğu gibi kalır) ve `'Ahmet Yıldız' ILIKE '%yildiz%'` → **false**; `C` ve
//      `C.UTF-8`'de aynı sonuç. Kasiyer "yildiz" yazarken "Yıldız"ı HİÇ bulamaz. Asıl gerekçe budur.
//   2. COLLATION'A BAĞIMLILIK — `lower()`in ASCII dışını çevirip çevirmemesi locale'e ve platformun libc'ine
//      bağlıdır: `locale 'C'` veritabanında `lower('ÇİĞDEM')` → `'ÇİĞdem'`, `ILIKE 'çiğ%'` → false (ölçüldü);
//      `C.UTF-8`'de aynı makinede `'çiğdem'` ve true. Depo üç farklı kurulum taşıyor (canlı container
//      `initdb --locale=C.UTF-8` → deploy/cloudflare/entrypoint.sh, compose `postgres:16` → `en_US.utf8`,
//      geliştirme `C`), yani `lower()` davranışı ortamdan ortama değişir.
//      ⚠️ `0006_customers_search_index.sql` ile docs/04 §4.13 bu ikinci maddeyi `C.UTF-8`'e yazıyor; ölçüm
//      `C.UTF-8`'de `lower()`in ÇALIŞTIĞINI gösterdi. Gerekçe yanlış locale'i suçluyor, karar doğru.
// Her iki maddeyi de `translate()` kapatır: locale'den tamamen bağımsız ve IMMUTABLE'dır (ifade indeksi için
// zorunlu). Ayrıca `ILIKE` bir önek indeksini hiç kullanamaz, `translate()` ifade indeksi kullanılabilirdir.
//
// KATLAMANIN KAPSAMI (bilinçli): I / İ / ı / i hepsi `i`'ye katlanır — kasiyer "ilgaz" yazarken "Ilgaz"ı da,
// "cigdem" yazarken "ÇİĞDEM"i de bulur. Bu, `turkishLower`'ın (I→ı) harf AYRIMINI koruyan davranışından
// bilerek daha geniştir: arama kutusunda ayrım yapmak kullanıcıyı cezalandırır.
// BİLİNEN SINIR: Türkçe dışı aksanlar katlanmaz (`JOSÉ` → `josÉ`, `É` olduğu gibi kalır). `toLowerCase()`
// KULLANILMAZ, çünkü JS `'É'.toLowerCase()` → `'é'` derken SQL `translate` `'É'`i olduğu gibi bırakır; ikizler
// ayrışır. Aksan katlaması gerekirse HER İKİ tarafa birlikte eklenir.

/** `translate()` kaynak karakterleri — SQL ikiziyle birebir aynı sıra ve uzunlukta olmalı (39 karakter). */
export const FOLD_FROM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÇĞİIÖŞÜçğıöşü';
/** `translate()` hedef karakterleri (39 karakter). */
export const FOLD_TO = 'abcdefghijklmnopqrstuvwxyzcgiiosucgiosu';

const FOLD_MAP = new Map<string, string>([...FOLD_FROM].map((ch, i) => [ch, FOLD_TO[i]!]));
/** Yalnız `FOLD_FROM`'daki karakterler değiştirilir; geri kalan (boşluk, rakam, aksan) olduğu gibi kalır. */
const FOLD_RE = /[A-ZÇĞİIÖŞÜçğıöşü]/g;

/**
 * Arama karşılaştırma anahtarı: ASCII büyük harfler küçültülür, 13 Türkçe harf ASCII karşılığına katlanır.
 * Boşluklar KORUNUR ("mehmet yilmaz" ≠ "mehmetyilmaz"): SQL ikizi de korur. Idempotenttir.
 */
export function foldSearch(input: string): string {
  return input.replace(FOLD_RE, (ch) => FOLD_MAP.get(ch) ?? ch);
}
