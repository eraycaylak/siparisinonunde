// Vitrin ve takip sayfası altbilgisindeki işletmeci beyanı (00 §7 "Storefront imzası", §12a madde 11; O3):
// "Bu sayfa {İşletme} tarafından işletilir; Yemek Gelsin yalnız yazılım altyapısı sağlar." Düz metin core
// `storefrontSignature` ile birebir aynı olmalı (tek kaynak); platform adı rel="nofollow" küçük bir bağlantıdır;
// eski "Altyapı: Yemek Gelsin" imzası kalktı; işletme adı bilinmiyorsa beyan çizilmez.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { storefrontSignature } from '@siparis/core/messages/tr';
import { PlatformSignature } from './platform-signature';
import { StorefrontShell } from './storefront-shell';

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&');

describe('işletmeci beyanı (PlatformSignature)', () => {
  it('metin core storefrontSignature ile birebir aynı; işletme adı vurgulu, platform adı nofollow bağlantı', () => {
    const html = renderToStaticMarkup(<PlatformSignature businessName="Bozok Pide Salonu" />);
    expect(textOf(html)).toBe(storefrontSignature('Bozok Pide Salonu'));
    expect(textOf(html)).toBe('Bu sayfa Bozok Pide Salonu tarafından işletilir; Yemek Gelsin yalnız yazılım altyapısı sağlar.');
    expect(html).toContain('<span class="font-semibold text-fg">Bozok Pide Salonu</span>');
    expect(html).toMatch(/<a href="[^"]*\/\?src=sf_footer" rel="nofollow"[^>]*>Yemek Gelsin<\/a>/);
    expect(html).not.toContain('Altyapı:');
  });

  it('işletme adı yoksa ya da boşsa hiçbir şey çizmez (beyan işletmesiz yazılmaz)', () => {
    expect(renderToStaticMarkup(<PlatformSignature businessName={null} />)).toBe('');
    expect(renderToStaticMarkup(<PlatformSignature businessName="   " />)).toBe('');
  });

  it('işletme adı HTML olarak yorumlanmaz', () => {
    const html = renderToStaticMarkup(<PlatformSignature businessName={'<b>Kötü</b> & Ad'} />);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;Kötü&lt;/b&gt; &amp; Ad');
  });
});

describe('StorefrontShell altbilgisi', () => {
  it('vitrin: işletme altbilgisi + beyan', () => {
    const html = renderToStaticMarkup(
      <StorefrontShell footer={<p>Satıcı künyesi</p>} businessName="Çamlık Döner">
        <p>menü</p>
      </StorefrontShell>,
    );
    expect(html).toContain('<footer');
    expect(html).toContain('Satıcı künyesi');
    expect(textOf(html)).toContain(storefrontSignature('Çamlık Döner'));
  });

  it('takip düzeni (işletme adı yok, altbilgi yok): boş altbilgi ve platform imzası çizilmez', () => {
    const html = renderToStaticMarkup(
      <StorefrontShell>
        <p>takip</p>
      </StorefrontShell>,
    );
    expect(html).not.toContain('<footer');
    expect(html).not.toContain('Yemek Gelsin');
  });
});
