import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IOS_HOME_SCREEN_NAME, iosBrowserOf, iosInstallGuide, shouldOfferIosInstall } from './ios-install';
import { IosInstallSteps } from './ios-install-steps';
import { detectPushPlatform } from './push-client';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/604.1',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0',
  iphone16:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  iphone15:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
} as const;

describe('iosBrowserOf', () => {
  it('Safari, Chrome ve diğerleri ayrılır (Chrome iOS kullanıcı ajanında "Safari" da geçer)', () => {
    expect(iosBrowserOf(UA.iphoneSafari)).toBe('safari');
    expect(iosBrowserOf(UA.iphoneChrome)).toBe('chrome');
    expect(iosBrowserOf(UA.iphoneFirefox)).toBe('other');
    // Uygulama içi tarayıcı (Instagram): "Safari/" yok → other
    expect(iosBrowserOf(UA.iphoneInstagram)).toBe('other');
  });
});

describe('shouldOfferIosInstall — rehber ne zaman çıkar', () => {
  const platform = (ua: string, standalone: boolean) => detectPushPlatform(ua, { standalone });

  it('iOS 16.4+ ve sekmede açık: rehber gösterilir', () => {
    expect(shouldOfferIosInstall(platform(UA.iphoneSafari, false))).toBe(true);
  });

  it('ana ekrandan açıldıysa gösterilmez (bildirim zaten çalışır)', () => {
    expect(shouldOfferIosInstall(platform(UA.iphoneSafari, true))).toBe(false);
  });

  it('iOS 16.4 altında gösterilmez: ana ekrana eklemek de yetmez, ayrı uyarı verilir', () => {
    const old = platform(UA.iphone15, false);
    expect(old.iosTooOld).toBe(true);
    expect(shouldOfferIosInstall(old)).toBe(false);
    // 16.3 de eski; 16.4 eşiktir
    expect(shouldOfferIosInstall(platform(UA.iphone16, false))).toBe(false);
  });

  it('Android ve masaüstünde hiç gösterilmez', () => {
    expect(shouldOfferIosInstall(platform(UA.android, false))).toBe(false);
  });
});

describe('iosInstallGuide — adımlar', () => {
  it('her tarayıcı yolunda sıralı, boş olmayan Türkçe adımlar var ve izin adımı en sonda', () => {
    for (const browser of ['safari', 'chrome', 'other'] as const) {
      const guide = iosInstallGuide(browser);
      expect(guide.steps.length, browser).toBeGreaterThanOrEqual(4);
      for (const step of guide.steps) expect(step.length, `${browser}: ${step}`).toBeGreaterThan(10);
      expect(guide.steps.join(' '), browser).toContain('Ana Ekrana Ekle');
      expect(guide.steps.at(-1), browser).toContain('İzin Ver');
      expect(guide.why, browser).toContain('bildirim');
    }
  });

  it('ana ekran simgesinin adı manifest short_name ile aynı', () => {
    // app/panel/manifest.webmanifest/route.ts içindeki short_name
    expect(IOS_HOME_SCREEN_NAME).toBe('Siparişler');
    expect(iosInstallGuide('safari').steps.join(' ')).toContain('"Siparişler"');
  });

  it('Safari rehberi alt çubuğu, Chrome rehberi adres çubuğunu söyler (Paylaş simgesinin yeri farklı)', () => {
    expect(iosInstallGuide('safari').steps[0]).toContain('alt çubuğundaki');
    expect(iosInstallGuide('chrome').steps[0]).toContain('adres çubuğunun');
    // Chrome'da "Ana Ekrana Ekle" çıkmayabilir → Safari'ye yönlendiren yedek yol yazılı
    expect(iosInstallGuide('chrome').fallback).toContain('Safari');
  });

  it('diğer tarayıcılar (Firefox iOS, uygulama içi tarayıcı) doğrudan Safari\'ye yönlendirilir', () => {
    expect(iosInstallGuide('other').steps[0]).toContain('Safari');
  });
});

describe('IosInstallSteps (işaretleme)', () => {
  it('adımlar sıralı liste olarak basılır (ekran okuyucu "1 / 5" diye okur)', () => {
    const guide = iosInstallGuide('safari');
    const html = renderToStaticMarkup(createElement(IosInstallSteps, { guide }));
    expect(html).toContain('<ol');
    expect((html.match(/<li>/g) ?? []).length).toBe(guide.steps.length);
    expect(html).toContain('Paylaş');
    // Neden gerekli cümlesi de basılır (kesme işareti HTML'de kaçırıldığı için parça eşlenir)
    expect(html).toContain('ana ekrana eklenmeden gelmez');
  });

  it('yedek yol yoksa fazladan paragraf basılmaz', () => {
    const guide = { ...iosInstallGuide('safari'), fallback: null };
    const html = renderToStaticMarkup(createElement(IosInstallSteps, { guide }));
    expect(html).not.toContain('text-fg-muted');
  });
});
