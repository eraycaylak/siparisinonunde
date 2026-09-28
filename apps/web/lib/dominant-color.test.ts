import { describe, expect, it } from 'vitest';
import { dominantColor } from './dominant-color';

/** [r,g,b,a] × adet → düz RGBA dizisi */
function pixels(...runs: [number, number, number, number, number][]): number[] {
  const out: number[] = [];
  for (const [r, g, b, a, n] of runs) for (let i = 0; i < n; i++) out.push(r, g, b, a);
  return out;
}

describe('logodan baskın renk', () => {
  it('beyaz zeminli kırmızı logo → kırmızı (beyaz ve siyah sayılmaz)', () => {
    const data = pixels([255, 255, 255, 255, 600], [20, 20, 20, 255, 100], [200, 30, 40, 255, 300]);
    expect(dominantColor(data)).toBe('#C81E28');
  });

  it('şeffaf pikseller yok sayılır; en çok görülen canlı renk kazanır', () => {
    const data = pixels([0, 120, 60, 0, 900], [230, 120, 20, 255, 200], [30, 90, 200, 255, 120]);
    expect(dominantColor(data)).toBe('#E67814');
  });

  it('siyah-beyaz / gri logo → null (varsayılan renk kalır)', () => {
    expect(dominantColor(pixels([255, 255, 255, 255, 500], [0, 0, 0, 255, 300], [128, 128, 128, 255, 200]))).toBeNull();
    expect(dominantColor([])).toBeNull();
  });
});
