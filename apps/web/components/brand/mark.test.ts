import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRAND_RED, OG_IMAGE } from '@/lib/site';
import { MARK_PATH, MARK_PATH_SIMPLE, MARK_VIEWBOX } from './mark';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)));

describe('Yemek Gelsin işareti ve marka rengi (12 §3.1–3.2)', () => {
  it('vektör dosya bileşenle aynı çizimi ve marka kırmızısını taşır', () => {
    const svg = read('public/brand/yemekgelsin-mark.svg').toString('utf8');
    expect(svg).toContain(`viewBox="${MARK_VIEWBOX}"`);
    expect(svg).toContain(`d="${MARK_PATH}"`);
    expect(svg).toContain(`fill="${BRAND_RED}"`);
  });

  it('tam işaret üç parça + üç diş, sade siluet tek parça', () => {
    expect(MARK_PATH.match(/M/g)).toHaveLength(6);
    expect(MARK_PATH_SIMPLE.match(/M/g)).toHaveLength(1);
  });

  it('CSS token (--brand-red) ve sabit (BRAND_RED) aynı renk', () => {
    const css = read('app/globals.css').toString('utf8');
    expect(css).toMatch(new RegExp(`--brand-red:\\s*${BRAND_RED}\\s*;`, 'i'));
  });

  it('önizleme görseli 1200×630 JPEG ve hafif', () => {
    const jpg = read(`public${OG_IMAGE.url}`);
    expect(jpg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(jpg.length).toBeLessThan(200 * 1024);
    // SOF0/SOF2 başlığından boyut
    let i = 2;
    let size: [number, number] | null = null;
    while (i < jpg.length) {
      const marker = jpg[i + 1]!;
      const len = jpg.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        size = [jpg.readUInt16BE(i + 7), jpg.readUInt16BE(i + 5)];
        break;
      }
      i += 2 + len;
    }
    expect(size).toEqual([OG_IMAGE.width, OG_IMAGE.height]);
  });
});
