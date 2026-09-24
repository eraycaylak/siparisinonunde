// İşletme ana rengi ve otomatik kontrast düzeltmesi (12 §5.1). Saf fonksiyon; OKLCH uzayında ton ve kroma
// korunur, yalnız açıklık (L) değişir. Panel önizlemesi, storefront teması ve baskı üreticisi aynı fonksiyonu kullanır.

export const INK_TEXT = '#111827';
export const WHITE = '#FFFFFF';
/** Koyu tema sayfa zemini (12 §3.2). */
export const DARK_BG = '#0F1419';

/** 12 hazır renk (ilk renk varsayılan). Her biri brandPalette ile doğrulanmıştır (testte). */
export const BRAND_PRESETS: readonly { hex: string; name: string }[] = [
  { hex: '#C62828', name: 'Kırmızı' },
  { hex: '#D84315', name: 'Kiremit' },
  { hex: '#EF6C00', name: 'Turuncu' },
  { hex: '#F9A825', name: 'Hardal' },
  { hex: '#FFD400', name: 'Sarı' },
  { hex: '#2E7D32', name: 'Yeşil' },
  { hex: '#00695C', name: 'Çam' },
  { hex: '#0277BD', name: 'Mavi' },
  { hex: '#283593', name: 'Lacivert' },
  { hex: '#6A1B9A', name: 'Mor' },
  { hex: '#AD1457', name: 'Vişne' },
  { hex: '#5D4037', name: 'Kahve' },
];

export const DEFAULT_BRAND_COLOR = BRAND_PRESETS[0]!.hex;

type RGB = [number, number, number];

export function isHexColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
}

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHex(rgb: RGB): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG göreli parlaklık. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG kontrast oranı (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

interface Oklch {
  l: number;
  c: number;
  h: number;
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.sqrt(A * A + B * B), h: Math.atan2(B, A) };
}

function oklchToLinear({ l: L, c, h }: Oklch): RGB {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: RGB) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH → hex; renk sRGB dışındaysa ton korunarak kroma azaltılır. */
export function oklchToHex(color: Oklch): string {
  const L = Math.min(1, Math.max(0, color.l));
  let lin = oklchToLinear({ ...color, l: L });
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = color.c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ l: L, c: mid, h: color.h }))) lo = mid;
      else hi = mid;
    }
    lin = oklchToLinear({ l: L, c: lo, h: color.h });
  }
  return rgbToHex(lin.map((v) => toGamma(Math.min(1, Math.max(0, v)))) as RGB);
}

/** L'yi `step` adımlarla değiştirerek hedef kontrasta ulaşır (en çok 50 adım). */
function adjustUntil(hex: string, against: string, min: number, direction: -1 | 1, step = 0.02): string {
  let current = hex;
  const base = hexToOklch(hex);
  for (let i = 1; i <= 50 && contrastRatio(current, against) < min; i++) {
    current = oklchToHex({ ...base, l: base.l + direction * step * i });
  }
  return current;
}

export interface BrandPalette {
  /** Buton zemini (gerekirse koyulaştırılmış) */
  brand: string;
  /** Buton metni: beyaz ya da ink (#111827), ≥ 4,5:1 */
  brandContrast: string;
  /** Beyaz zeminde metin/bağlantı (≥ 4,5:1) */
  brandStrong: string;
  /** Beyaz zeminde çip kenarı/sekme çizgisi (≥ 3:1) */
  brandUi: string;
  /** Seçili çip zemini (L ≈ 0,96) */
  brandSubtle: string;
  /** Koyu tema butonu (koyu zeminde ≥ 3:1) */
  brandDark: string;
  brandDarkContrast: string;
  /** Girdi okunabilirlik için koyulaştırıldı mı ("Renginiz … hafif koyulaştırıldı") */
  adjusted: boolean;
  input: string;
}

function pickContrast(bg: string): { color: string; ratio: number } {
  const w = contrastRatio(bg, WHITE);
  const i = contrastRatio(bg, INK_TEXT);
  return w >= i ? { color: WHITE, ratio: w } : { color: INK_TEXT, ratio: i };
}

/** 12 §5.1 algoritması. Geçersiz girdi → hazır paletin ilk rengi. */
export function brandPalette(input: string | null | undefined): BrandPalette {
  const source = isHexColor(input) ? input.toUpperCase() : DEFAULT_BRAND_COLOR;
  let brand = source;
  let contrast = pickContrast(brand);
  let adjusted = false;
  if (contrast.ratio < 4.5) {
    brand = adjustUntil(brand, WHITE, 4.5, -1);
    contrast = { color: WHITE, ratio: contrastRatio(brand, WHITE) };
    adjusted = true;
  }
  const brandStrong = adjustUntil(source, WHITE, 4.5, -1);
  const brandUi = adjustUntil(source, WHITE, 3, -1);
  const base = hexToOklch(source);
  const brandSubtle = oklchToHex({ l: 0.96, c: Math.min(base.c, 0.035), h: base.h });
  let brandDark = brand;
  if (contrastRatio(brandDark, DARK_BG) < 3) brandDark = adjustUntil(source, DARK_BG, 3, 1);
  const darkContrast = pickContrast(brandDark);
  return {
    brand,
    brandContrast: contrast.color,
    brandStrong,
    brandUi,
    brandSubtle,
    brandDark,
    brandDarkContrast: darkContrast.color,
    adjusted,
    input: source,
  };
}

/** Storefront/baskı için CSS değişkenleri (`<style>:root{…}</style>`). */
export function brandCssVariables(p: BrandPalette): Record<string, string> {
  return {
    '--brand': p.brand,
    '--brand-contrast': p.brandContrast,
    '--brand-strong': p.brandStrong,
    '--brand-ui': p.brandUi,
    '--brand-subtle': p.brandSubtle,
  };
}
