// Bilinmeyen QR kodu sayfası (O4, 00 §12a madde 11): listesiz nötr bilgi; bağlantı, başka işletme, platform tanıtımı yok.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import QrNotFound, { metadata } from './not-found';
import { metadata as pageMetadata } from './page';

describe('/q not-found', () => {
  it('nötr metin; hiçbir bağlantı, liste ya da öneri yok', () => {
    const html = renderToStaticMarkup(<QrNotFound />);
    expect(html).toContain('QR kodu bulunamadı');
    expect(html).not.toMatch(/<a\b|href=|<ul|<li/);
    expect(html).not.toMatch(/panel|Yemek Gelsin|dükkanlar|benzer|öneri/i);
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it('/q sayfası aynı nötr başlığı verir (iç içe not-found metadata\'sı Next\'te uygulanmaz)', () => {
    expect(pageMetadata).toBe(metadata);
    expect(JSON.stringify(pageMetadata)).not.toContain('Yemek Gelsin');
  });
});
