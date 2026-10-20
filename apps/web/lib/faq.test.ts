// SSS (05 C.3.4): O2 (00 §12a madde 11) ile "aynı numarada başka dükkanlar" sorusu kalktı; SSS sayfası ve FAQPage
// JSON-LD tek numarada çok dükkan (dizin/pazaryeri) izlenimi vermez.

import { describe, expect, it } from 'vitest';
import { FAQ } from './faq';

describe('FAQ', () => {
  it('"baska-dukkan" maddesi yok; hiçbir soru/cevap aynı numarada başka dükkanlar ya da dükkan listesi anlatmaz', () => {
    expect(FAQ.map((f) => f.id)).not.toContain('baska-dukkan');
    for (const f of FAQ) {
      expect(`${f.q} ${f.a}`, f.id).not.toMatch(/başka dükkan|aynı numarada|dükkan listesi|dükkanlar” der/i);
    }
  });

  it('kimlikler tekil', () => {
    expect(new Set(FAQ.map((f) => f.id)).size).toBe(FAQ.length);
  });
});
