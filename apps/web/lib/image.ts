// Duyarlı görsel adresleri — `apps/api/src/services/menu/image-variants.ts` sözleşmesinin OKUYAN tarafı.
//
// Sunucu her yüklemeyi `<token>.<maxW>x<maxH>.<w>.<uzanti>` adlı varyantlara ayırır. Veritabanında (ve
// `StorefrontView` içinde) yalnız geri düşme karesinin adresi durduğu için, `srcset` ve gerçek piksel ölçüsü
// o adresten TÜRETİLİR. Ek istek yok, `UploadResponse` sözleşmesi değişmiyor.
//
// GERİYE DÖNÜK UYUM, bu dosyanın asıl işi: eski yüklemeler (`/api/v1/uploads/<token>.png`) ve işletmenin elle
// girdiği `https://…` adresleri kalıba uymaz. O durumda `srcset` HİÇ üretilmez ve tek `src` ile çizilir —
// var olmayan bir varyantı `srcset`'e koymak tarayıcıyı `src`'ye geri DÜŞÜRMEZ, görseli tamamen kırar.
//
// GÜVENLİK: varyant adları, çözülen `token` ve sayılardan yeniden KURULUR (adresten parça kopyalanmaz). Ad kalıbı
// yalnız `[A-Za-z0-9_-]` + rakam + bilinen uzantıyı kabul eder, yani `srcset`'e yol çıkma (`../`) ya da başka bir
// origin sızamaz.
//
// ⚠️ `VARIANT_WIDTHS` ve ad kalıbı sunucu tarafıyla AYNI olmalıdır; iki tarafta da birim testlidir.

/** Yüklemelerin servis edildiği önek (API tarafı `app.ts` fastify-static). */
const UPLOAD_PREFIX = '/api/v1/uploads/';

/** Sunucunun ürettiği genişlik merdiveni. */
export const VARIANT_WIDTHS = [320, 640, 1080] as const;

/** En geniş varyant (sunucu da bundan geniş kare yazmaz). */
const MAX_VARIANT_WIDTH = VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1]!;

/** Üst basamağın altındakinden en az bu kadar geniş olması şartı (320/321 ikizini engeller). */
const MIN_STEP_RATIO = 1.15;

const NAME_RE = /^([A-Za-z0-9_-]+)\.([1-9]\d{0,4})x([1-9]\d{0,4})\.([1-9]\d{0,4})\.(webp|jpg|png)$/;

/**
 * En büyük varyantın genişliğinden var olan genişlikler. Gövde sunucudaki `variantWidths` ile BİREBİR aynıdır
 * (`apps/api/src/services/menu/image-variants.ts`); üst basamak merdivenden düşürülmediği için ada yazılan
 * `maxWidth` merdiven basamağı OLMAYABİLİR (ör. 1024).
 */
export function variantWidths(maxWidth: number): number[] {
  const top = Math.min(maxWidth, MAX_VARIANT_WIDTH);
  const below = VARIANT_WIDTHS.filter((w) => w < top);
  const prev = below[below.length - 1];
  if (prev !== undefined && top < prev * MIN_STEP_RATIO) return [...below];
  return [...below, top];
}

export interface ResponsiveImage {
  /** Her istemcide çalışan tek kare (özgün biçim). */
  src: string;
  /** WebP varyant kümesi (`<source type="image/webp">`). Varyant yoksa `undefined`. */
  webpSrcSet?: string;
  /** `srcset` seçiminde kullanılacak kutu açıklaması; yalnız `webpSrcSet` varken anlamlı. */
  sizes?: string;
  /** En büyük varyantın gerçek genişliği (en-boy oranı → CLS). Varyant yoksa `undefined`. */
  width?: number;
  /** En büyük varyantın gerçek yüksekliği. */
  height?: number;
}

/**
 * Görsel adresini duyarlı kaynak kümesine çevirir. Adres boşsa `null`, varyantsızsa yalnız `src` döner.
 *
 * @param sizes CSS'te kaplanan kutu (ör. `'104px'`, `'(max-width: 672px) 100vw, 672px'`).
 */
export function responsiveImage(url: string | null | undefined, sizes?: string): ResponsiveImage | null {
  const src = url?.trim();
  if (!src) return null;
  if (!src.startsWith(UPLOAD_PREFIX)) return { src };

  const parsed = NAME_RE.exec(src.slice(UPLOAD_PREFIX.length));
  if (!parsed) return { src };
  const [, token, maxW, maxH, w] = parsed;
  const maxWidth = Number(maxW);
  const maxHeight = Number(maxH);
  // Uydurulmuş ad: hiçbir varyant en büyük varyanttan geniş olamaz.
  if (Number(w) > maxWidth) return { src };

  const webpSrcSet = variantWidths(maxWidth)
    .map((width) => `${UPLOAD_PREFIX}${token}.${maxWidth}x${maxHeight}.${width}.webp ${width}w`)
    .join(', ');

  return { src, webpSrcSet, ...(sizes ? { sizes } : {}), width: maxWidth, height: maxHeight };
}
