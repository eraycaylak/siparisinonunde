import { describe, expect, it } from 'vitest';
import { DARK_BG, INK_TEXT, WHITE, brandPalette, brandPaletteCss, contrastRatio, normalizeHex } from './brand-palette';
import { suggestRestricted } from './contracts';

// 12 §5.1 kabul kriteri (1): 200 rastgele renkle özellik tabanlı test.
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('brandPalette (12 §5.1)', () => {
  it('örnekler: #FFD400 → ink metin, #8E24AA → beyaz metin, #E53935 koyulaştırılır', () => {
    const yellow = brandPalette('#FFD400');
    expect(yellow.brandContrast).toBe(INK_TEXT);
    expect(yellow.brand).toBe('#FFD400');
    expect(yellow.darkened).toBe(false);

    const purple = brandPalette('#8E24AA');
    expect(purple.brandContrast).toBe(WHITE);
    expect(purple.darkened).toBe(false);

    const red = brandPalette('#E53935');
    expect(red.darkened).toBe(true);
    expect(red.brandContrast).toBe(WHITE);
    expect(contrastRatio(red.brand, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('geçersiz/boş renk varsayılan palete düşer', () => {
    expect(brandPalette(null).input).toBe(brandPalette('#C2410C').input);
    expect(brandPalette('kırmızı').input).toBe('#C2410C');
    expect(normalizeHex('#abc')).toBe('#AABBCC');
  });

  it('200 rastgele renk: tüm eşikler sağlanır', () => {
    const rnd = seededRandom(42);
    for (let i = 0; i < 200; i++) {
      const hex = `#${Math.floor(rnd() * 0xffffff)
        .toString(16)
        .padStart(6, '0')}`;
      const p = brandPalette(hex);
      expect(contrastRatio(p.brand, p.brandContrast), `${hex} buton`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.brandStrong, WHITE), `${hex} strong`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.brandUi, WHITE), `${hex} ui`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(p.brandSubtle, INK_TEXT), `${hex} subtle`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.dark.brand, DARK_BG), `${hex} koyu`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(p.dark.brand, p.dark.brandContrast), `${hex} koyu buton`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.dark.brandStrong, DARK_BG), `${hex} koyu strong`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('CSS çıktısı kapsam seçicisiyle açık ve koyu değişkenleri yazar', () => {
    const css = brandPaletteCss(brandPalette('#B45309'), '[data-sf-theme]');
    expect(css).toContain('[data-sf-theme]{--brand:');
    expect(css).toContain('.dark [data-sf-theme]{');
    expect(css).toContain('--brand-contrast:');
  });
});

describe('suggestRestricted (04 §6.8)', () => {
  it('alkol/tütün/tüp kelimelerini yakalar, benzer kelimelere takılmaz', () => {
    expect(suggestRestricted('Efes Bira 50 cl')).toBe(true);
    expect(suggestRestricted('Yeni Rakı', null)).toBe(true);
    expect(suggestRestricted('Nargile (elma)')).toBe(true);
    expect(suggestRestricted('Tüp gaz')).toBe(true);
    expect(suggestRestricted('Biraz acılı lahmacun')).toBe(false);
    expect(suggestRestricted('Ayran', 'Yayık ayranı')).toBe(false);
  });
});
