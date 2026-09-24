// Storefront tema kuralı (12 §5.1): işletme ana rengi → okunabilir palet.
// OKLCH uzayında ton (h) ve kroma (C) korunur, yalnız açıklık (L) 0,02 adımlarla değişir.
// Saf fonksiyon: sunucuda (SSR) hesaplanır, <style> olarak satır içine yazılır.

/** Marka rengi seçilmemişse kullanılan renk (hazır paletin ilk rengi). */
export const DEFAULT_BRAND_COLOR = '#C2410C';
/** Gövde metni (ink) — 12 §3.2. */
export const INK_TEXT = '#111827';
export const WHITE = '#FFFFFF';
/** Koyu tema zemini (globals.css --bg). */
export const DARK_BG = '#0F1419';

export interface BrandTones {
  /** Buton zemini. */
  brand: string;
  /** Buton metni (beyaz ya da ink). */
  brandContrast: string;
  /** Zeminde metin/bağlantı/fiyat vurgusu (≥ 4,5:1). */
  brandStrong: string;
  /** Seçili kenar, sekme alt çizgisi (≥ 3:1). */
  brandUi: string;
  /** Seçili çip zemini (açık ton). */
  brandSubtle: string;
}

export interface BrandPalette extends BrandTones {
  /** Girdi (normalize). */
  input: string;
  /** --brand okunabilirlik için koyulaştırıldı mı ("Renginiz hafif koyulaştırıldı"). */
  darkened: boolean;
  dark: BrandTones;
}

// ---------------------------------------------------------------------------
// Renk yardımcıları

type RGB = [number, number, number];

/** '#abc' / '#aabbcc' / 'aabbcc' → '#AABBCC'; geçersizse null. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) {
    return `#${s
      .split('')
      .map((c) => c + c)
      .join('')
      .toUpperCase()}`;
  }
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toUpperCase()}`;
  return null;
}

function hexToRgb(hex: string): RGB {
  const s = hex.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]: RGB): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255;

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
  L: number;
  C: number;
  h: number;
}

function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.sqrt(A * A + B * B), h: Math.atan2(B, A) };
}

/** OKLCH → doğrusal sRGB (gamut dışı olabilir). */
function oklchToLinear({ L, C, h }: Oklch): RGB {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
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

/** OKLCH → hex; gamut dışındaysa tonu koruyarak kromayı azaltır. */
function oklchToHex(c: Oklch): string {
  const L = Math.min(1, Math.max(0, c.L));
  let lo = 0;
  let hi = c.C;
  let rgb = oklchToLinear({ L, C: hi, h: c.h });
  if (!inGamut(rgb)) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ L, C: mid, h: c.h }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear({ L, C: lo, h: c.h });
  }
  return rgbToHex(rgb.map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as RGB);
}

/** L'yi 0,02 adımlarla düşürür (koyulaştırır) ta ki `bg` ile kontrast ≥ `target` olsun. */
function darkenUntil(hex: string, bg: string, target: number): string {
  if (contrastRatio(hex, bg) >= target) return hex;
  const base = hexToOklch(hex);
  for (let L = base.L - 0.02; L > -0.02; L -= 0.02) {
    const out = oklchToHex({ ...base, L: Math.max(0, L) });
    if (contrastRatio(out, bg) >= target) return out;
  }
  return '#000000';
}

/** L'yi 0,02 adımlarla artırır (açar) ta ki `bg` ile kontrast ≥ `target` olsun. */
function lightenUntil(hex: string, bg: string, target: number): string {
  if (contrastRatio(hex, bg) >= target) return hex;
  const base = hexToOklch(hex);
  for (let L = base.L + 0.02; L < 1.02; L += 0.02) {
    const out = oklchToHex({ ...base, L: Math.min(1, L) });
    if (contrastRatio(out, bg) >= target) return out;
  }
  return '#FFFFFF';
}

function withLightness(hex: string, L: number, maxChroma: number): string {
  const c = hexToOklch(hex);
  return oklchToHex({ L, C: Math.min(c.C, maxChroma), h: c.h });
}

/** Buton metni: ≥ 4,5:1 sağlayanlardan kontrastı yüksek olan; ikisi de sağlamıyorsa null. */
function pickText(bg: string): string | null {
  const cw = contrastRatio(bg, WHITE);
  const ci = contrastRatio(bg, INK_TEXT);
  if (cw < 4.5 && ci < 4.5) return null;
  return cw >= ci ? WHITE : INK_TEXT;
}

// ---------------------------------------------------------------------------

/** 12 §5.1 algoritması. Geçersiz/boş girdide DEFAULT_BRAND_COLOR kullanılır. */
export function brandPalette(input: string | null | undefined): BrandPalette {
  const base = normalizeHex(input) ?? DEFAULT_BRAND_COLOR;

  // Açık tema
  let brand = base;
  let brandContrast = pickText(base);
  let darkened = false;
  if (!brandContrast) {
    brand = darkenUntil(base, WHITE, 4.5);
    brandContrast = WHITE;
    darkened = true;
  }
  const light: BrandTones = {
    brand,
    brandContrast,
    brandStrong: darkenUntil(base, WHITE, 4.5),
    brandUi: darkenUntil(base, WHITE, 3),
    brandSubtle: withLightness(base, 0.96, 0.03),
  };

  // Koyu tema: zeminde ≥ 3:1 olana kadar açılır; buton metni 2. adımla yeniden seçilir
  let dBrand = lightenUntil(base, DARK_BG, 3);
  let dText = pickText(dBrand);
  if (!dText) {
    dBrand = lightenUntil(dBrand, INK_TEXT, 4.5);
    dText = INK_TEXT;
  }
  const dark: BrandTones = {
    brand: dBrand,
    brandContrast: dText,
    brandStrong: lightenUntil(base, DARK_BG, 4.5),
    brandUi: lightenUntil(base, DARK_BG, 3),
    brandSubtle: withLightness(base, 0.3, 0.05),
  };

  return { input: base, darkened, ...light, dark };
}

function toneVars(t: BrandTones): string {
  return `--brand:${t.brand};--brand-contrast:${t.brandContrast};--brand-strong:${t.brandStrong};--brand-ui:${t.brandUi};--brand-subtle:${t.brandSubtle};`;
}

/**
 * Paleti CSS'e çevirir. `scope` seçicisi altında --brand, --brand-contrast, --brand-strong, --brand-ui,
 * --brand-subtle tanımlanır; koyu tema (.dark sınıfı ya da data-theme="system" + sistem koyu) ayrıca.
 */
export function brandPaletteCss(p: BrandPalette, scope = ':root'): string {
  return [
    `${scope}{${toneVars(p)}}`,
    `.dark ${scope}{${toneVars(p.dark)}}`,
    `@media (prefers-color-scheme: dark){:root[data-theme="system"]:not(.light) ${scope}{${toneVars(p.dark)}}}`,
  ].join('');
}
