// Sipariş alan ekranın renk kontrastı kapısı (12 §11.1 ölçüt 1.4.3 / 1.4.11; WCAG 2.2 AA).
//
// Panelin erişilebilirliği daha önce hiç denetlenmemişti. Bu test `app/globals.css` içindeki token'ları OKUR ve
// canlı sipariş ekranında gerçekten yan yana duran çiftleri ölçer: metin ≥ 4,5:1, arayüz öğesi ve odak halkası
// ≥ 3:1. Böylece paletin ileride sessizce eşiğin altına düşmesi mümkün olmaz.
//
// Not: ölçüm mutlaka token'ın GERÇEK değerinden yapılır; test içine renk kopyalanmaz.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

/** `:root { … }` / `.dark { … }` bloğundaki `--ad: deger;` çiftleri. İlk eşleşen blok alınır. */
function blockVars(selector: string): Map<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`globals.css içinde "${selector}" bloğu yok`);
  const open = CSS.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = CSS.slice(open + 1, end);
  const vars = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9_-]+)\s*:\s*([^;}]+);/gi)) {
    const [, key, value] = m;
    if (key && value) vars.set(key, value.trim());
  }
  return vars;
}

const LIGHT = blockVars(':root');
const DARK = blockVars('.dark');

/** Token değerini hex'e çözer; `var(--x)` zincirlerini takip eder. */
function resolve(name: string, theme: 'light' | 'dark'): string {
  const layers = theme === 'dark' ? [DARK, LIGHT] : [LIGHT];
  for (let hop = 0; hop < 8; hop++) {
    let value: string | undefined;
    for (const layer of layers) {
      value = layer.get(name);
      if (value !== undefined) break;
    }
    if (value === undefined) throw new Error(`${theme}: ${name} token'ı bulunamadı`);
    const ref = /^var\((--[a-z0-9_-]+)\)$/i.exec(value);
    if (!ref?.[1]) {
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${theme}: ${name} = "${value}" 6 haneli hex değil`);
      return value.toLowerCase();
    }
    name = ref[1];
  }
  throw new Error(`${theme}: ${name} var() zinciri çözülemedi`);
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** WCAG 2.x kontrast oranı (1–21). */
function ratio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/** [ön plan token'ı, arka plan token'ı, ekrandaki yeri] */
const TEXT_PAIRS: readonly [string, string, string][] = [
  ['--fg', '--surface-raised', 'kart yazısı'],
  ['--fg', '--surface', 'sayfa yazısı'],
  ['--fg-muted', '--surface-raised', 'kartta ikincil yazı (mahalle, ödeme)'],
  ['--fg-muted', '--surface', 'boş sütun yazısı'],
  ['--primary-fg', '--primary', '"Onayla · 30 dk" butonu'],
  ['--primary-fg', '--primary-hover', '"Onayla" butonu (üzerine gelince)'],
  ['--primary-fg', '--primary-active', '"Onayla" butonu (basılı)'],
  ['--status-new-fg', '--surface-raised', 'kartta geçen süre / "Görülmedi"'],
  ['--status-new-bg', '--status-new-fg', 'sütun başlığındaki sayı'],
  ['--band-alarm-fg', '--band-alarm', 'kırmızı "YENİ SİPARİŞ" bandı'],
  ['--note-fg', '--note-bg', 'müşteri notu'],
  ['--destructive', '--surface-raised', '"Reddet" yazısı'],
  ['--success-fg', '--success', '"Teslim edildi" butonu'],
  ['--band-warn-fg', '--band-warn', 'sarı bant'],
  ['--band-ok-fg', '--band-ok', 'yeşil bant'],
];

const NON_TEXT_PAIRS: readonly [string, string, string][] = [
  ['--ring', '--surface-raised', 'odak halkası (kart içinde)'],
  ['--ring', '--surface', 'odak halkası (sayfa üstünde)'],
  ['--ring', '--primary', 'odak halkası ("Onayla" butonunun üstünde)'],
  ['--ring', '--band-alarm', 'odak halkası (kırmızı bandın üstünde)'],
  ['--border-strong', '--surface-raised', 'ikincil buton kenarı'],
  ['--status-new-fg', '--surface', 'yeni sipariş kartının kırmızı çerçevesi'],
];

describe.each(['light', 'dark'] as const)('canlı sipariş ekranı kontrastı — %s tema', (theme) => {
  it.each(TEXT_PAIRS)('metin ≥ 4,5:1 — %s / %s (%s)', (fg, bg) => {
    expect(ratio(resolve(fg, theme), resolve(bg, theme))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(NON_TEXT_PAIRS)('arayüz öğesi ≥ 3:1 — %s / %s (%s)', (fg, bg) => {
    expect(ratio(resolve(fg, theme), resolve(bg, theme))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe('kontrast ölçerin kendisi', () => {
  it('bilinen değerleri doğru hesaplar (siyah/beyaz 21:1, aynı renk 1:1)', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 2);
    expect(ratio('#c81e1e', '#c81e1e')).toBeCloseTo(1, 5);
  });

  it('var() zincirini çözer (--primary → --brand-red)', () => {
    expect(resolve('--primary', 'light')).toBe(resolve('--brand-red', 'light'));
  });

  it('koyu temada geçersiz kılınmayan token açık temadan gelir (bantlar iki temada aynı)', () => {
    expect(resolve('--band-alarm', 'dark')).toBe(resolve('--band-alarm', 'light'));
    expect(resolve('--fg', 'dark')).not.toBe(resolve('--fg', 'light'));
  });
});

describe('odak halkası hiçbir yerde kapatılmamış', () => {
  it('globals.css görünür odak halkası tanımlar', () => {
    expect(CSS).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ring\)/);
    expect(CSS).toContain('outline-offset: 2px');
  });

  it('hareket azaltma açıkken yanıp sönme durur (WCAG 2.3.1)', () => {
    expect(CSS).toContain('prefers-reduced-motion: reduce');
    expect(CSS).toMatch(/animation-duration:\s*0ms\s*!important/);
  });
});
