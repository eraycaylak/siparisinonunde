/**
 * Logodan marka rengi (12 §5.1): işletme logo yükleyip henüz renk seçmediyse logonun baskın CANLI rengi önerilir.
 * Şeffaf, griye yakın (düşük doygunluk), çok koyu ve çok açık pikseller sayılmaz; renkler 4 bitlik kovalarda toplanır,
 * doygunluğu yüksek pikseller biraz daha ağır basar. Canlı piksel çok azsa (siyah-beyaz logo) null: varsayılan renk kalır.
 * Okunabilirlik düzeltmesini (koyulaştırma) vitrin paleti yapar (brandPalette).
 */
export function dominantColor(data: ArrayLike<number>, opts: { minVividShare?: number } = {}): string | null {
  const minVividShare = opts.minVividShare ?? 0.03;
  const buckets = new Map<number, { w: number; r: number; g: number; b: number }>();
  let opaque = 0;
  let vivid = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const a = data[i + 3]!;
    if (a < 128) continue;
    opaque++;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 510;
    const d = max - min;
    const s = d === 0 ? 0 : d / (255 - Math.abs(max + min - 255));
    if (s < 0.25 || l < 0.12 || l > 0.92) continue;
    vivid++;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const w = 1 + s;
    const cur = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0 };
    cur.w += w;
    cur.r += r * w;
    cur.g += g * w;
    cur.b += b * w;
    buckets.set(key, cur);
  }
  if (!opaque || vivid / opaque < minVividShare) return null;
  let best: { w: number; r: number; g: number; b: number } | null = null;
  for (const v of buckets.values()) if (!best || v.w > best.w) best = v;
  if (!best) return null;
  const hex = (n: number) => Math.round(n / best!.w).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`.toUpperCase();
}

/** Tarayıcıda: görsel adresinden baskın renk (64×64'e küçültülür). Yüklenemezse ya da canvas okunamazsa null. */
export async function logoBrandColor(url: string): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('görsel yüklenemedi'));
      img.src = url;
    });
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    return dominantColor(ctx.getImageData(0, 0, size, size).data);
  } catch {
    return null;
  }
}
