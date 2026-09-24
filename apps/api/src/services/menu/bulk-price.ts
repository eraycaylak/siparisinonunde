// Toplu fiyat güncelleme hesabı (04 §6.5). Saf fonksiyon; uygulama ve önizleme aynı hesabı kullanır.

import { roundHalfUp } from '@siparis/core';
import type { BulkPriceItem, BulkPriceRounding } from '@siparis/core/menu/contracts';

export interface BulkPriceProduct {
  id: string;
  name: string;
  categoryName: string | null;
  priceKurus: number;
}

const ROUNDING_UNIT: Record<BulkPriceRounding, number> = { none: 1, '0.5': 50, '1': 100, '5': 500, '10': 1000 };

/** Yeni fiyat (kuruş): yüzde ya da sabit değişim + en yakına yuvarlama. */
export function computeNewPrice(oldKurus: number, kind: 'percent' | 'fixed', value: number, rounding: BulkPriceRounding): number {
  const raw = kind === 'percent' ? oldKurus * (1 + value / 100) : oldKurus + value;
  const unit = ROUNDING_UNIT[rounding];
  return roundHalfUp(raw / unit) * unit;
}

export interface BulkPriceComputation {
  items: BulkPriceItem[];
  changedCount: number;
  invalidCount: number;
  warnings: 'large_change'[];
}

export function computeBulkPrice(
  products: readonly BulkPriceProduct[],
  kind: 'percent' | 'fixed',
  value: number,
  rounding: BulkPriceRounding,
): BulkPriceComputation {
  let large = false;
  const items = products.map((p): BulkPriceItem => {
    const next = computeNewPrice(p.priceKurus, kind, value, rounding);
    // Negatif fiyat yasak; fiyatı olan ürün 0'a düşürülemez (04 §6.5 "0 veya negatif fiyat engellenir")
    const invalid = next < 0 || (next === 0 && p.priceKurus > 0);
    if (p.priceKurus > 0 && Math.abs(next - p.priceKurus) / p.priceKurus > 0.5) large = true;
    return {
      productId: p.id,
      name: p.name,
      categoryName: p.categoryName,
      oldPriceKurus: p.priceKurus,
      newPriceKurus: next,
      diffKurus: next - p.priceKurus,
      invalid,
    };
  });
  return {
    items,
    changedCount: items.filter((i) => i.diffKurus !== 0 && !i.invalid).length,
    invalidCount: items.filter((i) => i.invalid).length,
    warnings: large ? ['large_change'] : [],
  };
}

/** price_change_batches.value: yüzde → baz puan (%12,5 = 1250), sabit → kuruş. */
export function batchValue(kind: 'percent' | 'fixed', value: number): number {
  return kind === 'percent' ? Math.round(value * 100) : Math.round(value);
}
