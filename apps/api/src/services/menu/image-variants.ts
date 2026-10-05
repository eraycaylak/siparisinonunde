// Duyarlı görsel varyantlarının ADLANDIRMA SÖZLEŞMESİ — tek kaynak (14 §6.3, 12 §5.2, 06 §12).
//
//   <token>.<maxW>x<maxH>.<w>.<uzanti>
//
// Örnek: `kQ7v…_a.1080x810.640.jpg` → en büyük varyant 1080×810 px, bu dosya 640 px geniş JPEG.
//
// Neden ad içinde: `UploadResponse` sözleşmesi (`packages/core/src/menu/contracts.ts`) tek bir `url` alanı taşır ve
// `products.image_url` / `tenants.cover_url` sütunlarında da tek metin saklanır. Varyant listesini ve gerçek piksel
// ölçüsünü taşıyacak bir alan YOK; sözleşme bu dilimin sahipliğinde de değil (raporda DIŞ BAĞIMLILIK). Bu yüzden
// gereken her şey dosya adına yazılır: istemci (apps/web/lib/image.ts) adı çözer, `srcset` ve en-boy oranını
// (CLS) oradan üretir. Sunucuya ek istek yok, veri modeli değişmiyor, eski kayıtlar bozulmuyor.
//
// GERİYE DÖNÜK UYUM: Faz 1'de yüklenmiş dosyalar `<token>.png` biçimindedir ve bu kalıba UYMAZ. `parseVariantName`
// onlar için `null` döner; istemci de `srcset` üretmeyip tek `src` ile çizer. Dışarıdan girilen `https://…`
// adresleri de aynı yoldan geçer.
//
// ⚠️ Bu dosya ile `apps/web/lib/image.ts` AYNI sözleşmeyi yazar/okur. Biri değişirse diğeri de değişmek zorundadır;
// `VARIANT_WIDTHS` ve `FALLBACK_WIDTH` iki tarafta da birim testlidir.

/** Üretilen genişlik merdiveni (12 §5.2: ürün görseli 1080, kapak 1200×630; mobil veri için 320 şart). */
export const VARIANT_WIDTHS = [320, 640, 1080] as const;

/** En geniş varyant: 1080 px. Kaynak daha büyük olsa da bundan geniş kare servis edilmez. */
export const MAX_VARIANT_WIDTH = VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1]!;

/**
 * Üst basamağın, altındaki merdiven basamağından en az bu kadar geniş olması şartı. 321 px'lik kaynak için
 * hem 320 hem 321 px yazmak iki özdeş dosya demektir; %15 eşiği bu ikizleri engeller.
 */
export const MIN_STEP_RATIO = 1.15;

/** `src` olarak verilen geri düşme karesinin genişliği (`srcset` ya da WebP anlamayan istemciler). */
export const FALLBACK_WIDTH = 640;

/** Ad içinde izin verilen uzantılar (yüklenebilen türlerle birebir). */
export const VARIANT_EXTENSIONS = ['webp', 'jpg', 'png'] as const;
export type VariantExtension = (typeof VARIANT_EXTENSIONS)[number];

/**
 * Var olan varyant genişlikleri. Sunucu bu listeyi KAYNAĞIN genişliğiyle çağırır (üretmek için); istemci aynı
 * listeyi ADDAKİ en büyük varyant genişliğiyle çağırır (beklemek için). İki çağrı aynı sonucu vermek zorundadır:
 * `top` hesabı idempotent olduğu için (`min(x, 1080)` iki kez uygulanabilir) tek bir gövde ikisine de yeter.
 *
 * Kurallar:
 *   1. Görsel BÜYÜTÜLMEZ: üst basamak en çok kaynağın kendi genişliğidir.
 *   2. Üst basamak merdivenden DÜŞÜRÜLMEZ: 1024 px'lik kaynak 640'a inmez, 1024 olarak da yazılır — yoksa
 *      yüklenen görselin çözünürlüğünün %40'ı sebepsiz atılırdı (kapak 672 px'lik kabukta çiziliyor).
 *   3. Üst basamak altındakine çok yakınsa (< %15) yazılmaz; 320 ile 321 ikiz dosyadır.
 */
export function variantWidths(sourceWidth: number): number[] {
  const top = Math.min(sourceWidth, MAX_VARIANT_WIDTH);
  const below = VARIANT_WIDTHS.filter((w) => w < top);
  const prev = below[below.length - 1];
  if (prev !== undefined && top < prev * MIN_STEP_RATIO) return [...below];
  return [...below, top];
}

/** Sözleşmeye uygun dosya adı. */
export function variantName(token: string, maxWidth: number, maxHeight: number, width: number, ext: VariantExtension): string {
  return `${token}.${maxWidth}x${maxHeight}.${width}.${ext}`;
}

export interface ParsedVariantName {
  token: string;
  /** En büyük varyantın gerçek piksel genişliği (en-boy oranı ve merdiven bundan türer). */
  maxWidth: number;
  /** En büyük varyantın gerçek piksel yüksekliği. */
  maxHeight: number;
  /** Bu dosyanın genişliği. */
  width: number;
  ext: VariantExtension;
}

// Token base64url'dür (`randomToken`), nokta İÇERMEZ → nokta güvenli ayraçtır. Ölçüler 1–5 hane, baştan sıfırsız:
// böylece `logo.png` gibi eski adlar ve `foto.2x.png` gibi rastlantısal adlar kalıba uymaz.
const NAME_RE = /^([A-Za-z0-9_-]+)\.([1-9]\d{0,4})x([1-9]\d{0,4})\.([1-9]\d{0,4})\.(webp|jpg|png)$/;

/** Dosya adını çözer; sözleşmeye uymuyorsa (eski yükleme, dış adres) `null`. */
export function parseVariantName(name: string): ParsedVariantName | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const [, token, maxW, maxH, w, ext] = m;
  const maxWidth = Number(maxW);
  const width = Number(w);
  // Hiçbir varyant en büyük varyanttan geniş olamaz; aksi hâlde ad uydurulmuştur.
  if (width > maxWidth) return null;
  return { token: token!, maxWidth, maxHeight: Number(maxH), width, ext: ext as VariantExtension };
}
