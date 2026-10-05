import { describe, expect, it } from 'vitest';
import {
  OLD_BROWSER_BODY,
  OLD_BROWSER_TITLE,
  PANEL_CSS_FEATURES,
  PANEL_MIN_BROWSERS,
  evaluateCssSupport,
  updateTargetFor,
  type CssSupports,
} from './browser-support';

/** Her şeyi destekleyen tarayıcı (güncel Chrome/Safari). */
const modern: CssSupports = () => true;

/** Yalnız verilen değerleri destekleyen tarayıcı. */
function supportsOnly(allowed: readonly string[]): CssSupports {
  return (_property, value) => allowed.includes(value);
}

describe('panel tarayıcı kapısı — sınanan özellikler', () => {
  it('Tailwind 4 çıktısının gerçek eşikleri sınanır; @property sınanmaz (Tailwind kendi yedeğini basar)', () => {
    const ids = PANEL_CSS_FEATURES.map((f) => f.id);
    expect(ids).toEqual(['color-mix', 'dvh', 'oklch']);
    // Yoklama, üretilen CSS'te Tailwind'in kendi kullandığı testin aynısı olmalı
    expect(PANEL_CSS_FEATURES[0]).toMatchObject({ property: 'color', value: 'color-mix(in lab, red, red)' });
    expect(ids).not.toContain('property');
  });

  it('PANELDE kullanılmayan özellik kapıya girmez (yanlış alarm olurdu)', () => {
    const ids: string[] = PANEL_CSS_FEATURES.map((f) => f.id);
    // Derlenen CSS'teki tek `linear-gradient(… in oklab, …)` VİTRİN başlığındadır
    // (components/storefront/store-header.tsx). Kapıya alınsaydı Firefox 113–127'de panel kusursuz boyanırken
    // kapatılamaz "panel bozuk" bandı çıkardı.
    expect(ids).not.toContain('oklab-gradient');
    // Yoklanan hiçbir değer gradyan ara-renk ipucu içermemeli
    for (const f of PANEL_CSS_FEATURES) expect(f.value, f.id).not.toMatch(/gradient/);
  });

  it('her özelliğin Türkçe "neyi bozar" açıklaması var (uyarının ayrıntı bölümü boş kalmasın)', () => {
    for (const f of PANEL_CSS_FEATURES) {
      expect(f.broken.length, f.id).toBeGreaterThan(10);
    }
  });
});

describe('evaluateCssSupport', () => {
  it('güncel tarayıcıda uyarı çıkmaz', () => {
    expect(evaluateCssSupport(modern)).toEqual({ ok: true, missing: [], probeUnavailable: false });
  });

  it('color-mix yoksa panel bozuk sayılır', () => {
    const verdict = evaluateCssSupport(supportsOnly(['oklch(50% 0.1 250)', '100dvh']));
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(['color-mix']);
  });

  it('eski Chrome (110 sınıfı: color-mix/oklch yok, dvh var) iki eksiği bildirir', () => {
    const verdict = evaluateCssSupport(supportsOnly(['100dvh']));
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(['color-mix', 'oklch']);
  });

  it('Firefox 113–127 sınıfı (color-mix + oklch + dvh var, yalnız oklab gradyan yok) uyarı ALMAZ', () => {
    // Panelde oklab gradyan hiç kullanılmıyor; yoklanmadığı için bu tarayıcı temiz geçer.
    const verdict = evaluateCssSupport(supportsOnly(['color-mix(in lab, red, red)', 'oklch(50% 0.1 250)', '100dvh']));
    expect(verdict).toEqual({ ok: true, missing: [], probeUnavailable: false });
  });

  it('dvh yoksa (düzen kırıcı, Tailwind yedeği yok) uyarı çıkar', () => {
    const verdict = evaluateCssSupport(supportsOnly(['color-mix(in lab, red, red)', 'oklch(50% 0.1 250)']));
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(['dvh']);
  });

  it('CSS.supports hiç yoksa (çok eski tarayıcı) uyarı gösterilir ve bu durum ayrıca işaretlenir', () => {
    const verdict = evaluateCssSupport(null);
    expect(verdict).toEqual({ ok: false, missing: [], probeUnavailable: true });
    expect(evaluateCssSupport(undefined).probeUnavailable).toBe(true);
  });

  it('CSS.supports fırlatırsa özellik desteklenmiyor sayılır (panel çökmez)', () => {
    const verdict = evaluateCssSupport(() => {
      throw new Error('bozuk CSS.supports');
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toHaveLength(PANEL_CSS_FEATURES.length);
  });
});

describe('updateTargetFor — "hangi sürüme güncelleyeyim"', () => {
  const UA = {
    androidChrome110:
      'Mozilla/5.0 (Linux; Android 9; SM-T510) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
    iphone15:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
    iphoneChrome:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
    ipad16:
      'Mozilla/5.0 (iPad; CPU OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1',
    edge109:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36 Edg/109.0.1518.78',
    firefox102: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:102.0) Gecko/20100101 Firefox/102.0',
    samsung17:
      'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/17.0 Chrome/87.0.4280.141 Mobile Safari/537.36',
    macSafari15:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15',
    bilinmeyen: 'SomeKiosk/1.0',
  } as const;

  it('eski Android tableti: Chrome 111, Play Store yolu ve "tablet değişmeli" ihtimali anlatılır', () => {
    const t = updateTargetFor(UA.androidChrome110);
    expect(t).toMatchObject({ browser: 'Chrome', minVersion: '111', currentVersion: '110' });
    expect(t.howTo).toContain('Play Store');
    expect(t.howTo).toContain('111');
  });

  it('iPhone/iPad: çözüm tarayıcı değil iOS güncellemesi; başka tarayıcı kurmanın çözmediği yazılır', () => {
    for (const ua of [UA.iphone15, UA.ipad16, UA.iphoneChrome]) {
      const t = updateTargetFor(ua);
      expect(t.browser, ua).toBe('Safari');
      expect(t.minVersion, ua).toBe('16.4');
      expect(t.howTo, ua).toContain('Yazılım Güncelleme');
      expect(t.howTo, ua).toContain('Başka tarayıcı kurmak bu sorunu çözmez');
    }
    // Sürüm okuması: iOS 15_7 → "15", iPad OS 16_1 → "16"
    expect(updateTargetFor(UA.iphone15).currentVersion).toBe('15');
    expect(updateTargetFor(UA.ipad16).currentVersion).toBe('16');
  });

  it('Edge, Chrome kullanıcı ajanının içinde geçse de Edge olarak tanınır', () => {
    expect(updateTargetFor(UA.edge109)).toMatchObject({ browser: 'Edge', minVersion: '111', currentVersion: '109' });
  });

  it('Firefox eşiği 128 (Tailwind 4 tabanı)', () => {
    expect(updateTargetFor(UA.firefox102)).toMatchObject({ browser: 'Firefox', minVersion: '128', currentVersion: '102' });
  });

  it('Samsung Internet: sürüm ↔ Chromium eşlemesi kesin olmadığı için numara UYDURULMAZ', () => {
    const t = updateTargetFor(UA.samsung17);
    expect(t.browser).toBe('Samsung Internet');
    expect(t.minVersion).toBeNull();
    expect(t.currentVersion).toBe('17');
    expect(t.howTo).toContain('Galaxy Store');
  });

  it('masaüstü Safari: macOS güncellemesi', () => {
    const t = updateTargetFor(UA.macSafari15);
    expect(t).toMatchObject({ browser: 'Safari', minVersion: '16.4', currentVersion: '15' });
    expect(t.howTo).toContain('Sistem Ayarları');
  });

  it('tanınmayan tarayıcı: güncel Chrome/Edge önerilir, sürüm uydurulmaz', () => {
    const t = updateTargetFor(UA.bilinmeyen);
    expect(t).toMatchObject({ browser: null, minVersion: null, currentVersion: null });
    expect(t.howTo).toContain('111');
  });

  it('her yolda Türkçe, boş olmayan bir yapılacak iş döner', () => {
    for (const ua of Object.values(UA)) {
      expect(updateTargetFor(ua).howTo.length, ua).toBeGreaterThan(20);
    }
  });
});

describe('uyarı metni', () => {
  it('başlık ve gövde Türkçe ve sipariş kaçma riskini söyler', () => {
    expect(OLD_BROWSER_TITLE).toContain('eski');
    expect(OLD_BROWSER_BODY).toContain('kaçırmamak');
  });

  it('en düşük sürüm tablosu Tailwind 4 tabanıyla aynı', () => {
    expect(PANEL_MIN_BROWSERS).toEqual({ chrome: '111', edge: '111', firefox: '128', safari: '16.4', ios: '16.4' });
  });
});
