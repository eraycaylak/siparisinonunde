// DOM tabanlı test: uyarı bandı gerçekten render edilip basılan işaretleme (rol, metin, stil) denetlenir.
// jsdom yerine `react-dom/server` kullanılır — apps/web vitest kurulumunda DOM ortamı paketi yoktur
// (bkz. raporun "DIŞ BAĞIMLILIK" maddesi); `renderToStaticMarkup` aynı işaretlemeyi üretir.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { evaluateCssSupport, updateTargetFor, type BrowserSupportVerdict } from './browser-support';
import { OldBrowserNoticeView } from './old-browser-notice';

const ANDROID_110 =
  'Mozilla/5.0 (Linux; Android 9; SM-T510) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36';

function render(verdict: BrowserSupportVerdict, userAgent = ANDROID_110): string {
  return renderToStaticMarkup(createElement(OldBrowserNoticeView, { verdict, target: updateTargetFor(userAgent) }));
}

describe('eski tarayıcı bandı (işaretleme)', () => {
  it('güncel tarayıcıda hiçbir şey basılmaz', () => {
    expect(render(evaluateCssSupport(() => true))).toBe('');
  });

  it('bozuk tarayıcıda role="alert" bant, Türkçe başlık ve yapılacak iş basılır', () => {
    const html = render({ ok: false, missing: ['color-mix', 'oklch'], probeUnavailable: false });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Tarayıcınız eski');
    expect(html).toContain('kaçırmamak');
    expect(html).toContain('Play Store');
    // Okunabilen sürüm kullanıcıya da gösterilir
    expect(html).toContain('Chrome 110');
  });

  it('bant Tailwind sınıfı kullanmaz: Tailwind çıktısı çalışmasa bile görünür kalır', () => {
    const html = render({ ok: false, missing: ['color-mix'], probeUnavailable: false });
    expect(html).not.toContain('class=');
    // Renk hex; oklch/color-mix geçmez (uyarının kendisi aynı özelliğe bağlı olamaz)
    expect(html).toContain('#c81e1e');
    expect(html).not.toMatch(/oklch|color-mix/);
  });

  it('yalnız gerçekten eksik olan özellikler listelenir', () => {
    const html = render({ ok: false, missing: ['dvh'], probeUnavailable: false });
    expect(html).toContain('Ekran yüksekliği');
    // color-mix eksik değil → onun maddesi basılmaz
    expect(html).not.toContain('katı renge');
    expect((html.match(/<li>/g) ?? []).length).toBe(1);
  });

  it('CSS.supports yoksa madde listesi yerine açıklama metni basılır', () => {
    const html = render({ ok: false, missing: [], probeUnavailable: true });
    expect(html).toContain('sipariş kaçırma riski');
    expect(html).not.toContain('<li>');
  });

  it('kapatma düğmesi yoktur: panel gerçekten bozuk, uyarı gizlenemez', () => {
    const html = render({ ok: false, missing: ['color-mix'], probeUnavailable: false });
    expect(html).not.toContain('<button');
  });

  it('iPhone kullanıcı ajanında Play Store değil iOS güncellemesi anlatılır', () => {
    const html = render(
      { ok: false, missing: ['color-mix'], probeUnavailable: false },
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
    );
    expect(html).toContain('Yazılım Güncelleme');
    expect(html).not.toContain('Play Store');
  });
});
