// Vitrin 404'ü (O3, 00 §12a madde 11): bilinmeyen dükkan adresinde platform tanıtımı, pazarlama sitesi ya da işletme
// paneli bağlantısı ve başka işletme önerisi YOK; arama motorlarına kapalı.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import StorefrontNotFound, { metadata } from './not-found';

describe('/s/ not-found', () => {
  it('nötr metin; hiçbir bağlantı (ana sayfa, panel) ve platform adı yok', () => {
    const html = renderToStaticMarkup(<StorefrontNotFound />);
    expect(html).toContain('Sayfa bulunamadı');
    expect(html).not.toMatch(/<a\b|href=/);
    expect(html).not.toMatch(/panel|Ana sayfa|Yemek Gelsin|dükkanlar/i);
  });

  it('noindex ve nötr önizleme', () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(JSON.stringify(metadata)).not.toContain('Yemek Gelsin');
  });
});
