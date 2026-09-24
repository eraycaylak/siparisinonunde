// Vitrin istemci mantığı (gösterim amaçlı; gerçek tutarı her zaman sunucu hesaplar — CLAUDE.md kural 3).

import type { StorefrontView, StorefrontViewProduct, StoreSessionView } from '@siparis/core/menu/contracts';
import { MAX_ITEM_QUANTITY } from '@siparis/core/pricing';
import type { CartLine } from '@/lib/cart';

export type StoreProduct = StorefrontViewProduct;
export type StoreOptionGroup = StoreProduct['optionGroups'][number];

export const QUANTITY_MAX = MAX_ITEM_QUANTITY;
export const NOTE_MAX = 140;

export function productIndex(store: StorefrontView): Map<string, StoreProduct> {
  return new Map(store.categories.flatMap((c) => c.products).map((p) => [p.id, p]));
}

/** Seçili seçenekleri ürünün grup ve seçenek sırasına dizer; üründe olmayanları atar. */
export function orderedOptionIds(product: StoreProduct, optionIds: readonly string[]): string[] {
  const set = new Set(optionIds);
  return product.optionGroups.flatMap((g) => g.options.filter((o) => set.has(o.id)).map((o) => o.id));
}

export function optionLabels(product: StoreProduct, optionIds: readonly string[]): string[] {
  const set = new Set(optionIds);
  return product.optionGroups.flatMap((g) => g.options.filter((o) => set.has(o.id)).map((o) => o.name));
}

/** Birim fiyat (ürün + seçenek farkları), en az 0. */
export function unitPriceKurus(product: StoreProduct, optionIds: readonly string[]): number {
  const set = new Set(optionIds);
  const delta = product.optionGroups.flatMap((g) => g.options).reduce((s, o) => s + (set.has(o.id) ? o.priceDeltaKurus : 0), 0);
  return Math.max(0, product.priceKurus + delta);
}

/** Grup için Türkçe kural metni: "Zorunlu · 1 seçin", "İsteğe bağlı · en çok 3". */
export function groupRuleText(g: StoreOptionGroup): string {
  const max = g.maxSelect ?? null;
  if (g.minSelect > 0) {
    if (max !== null && max === g.minSelect) return `Zorunlu · ${g.minSelect} seçin`;
    return max !== null ? `Zorunlu · ${g.minSelect}–${max} seçin` : `Zorunlu · en az ${g.minSelect} seçin`;
  }
  if (max === 1) return 'İsteğe bağlı · en çok 1';
  return max !== null ? `İsteğe bağlı · en çok ${max}` : 'İsteğe bağlı';
}

/** Tek seçim (radyo) mu. */
export function isSingleChoice(g: StoreOptionGroup): boolean {
  return g.maxSelect === 1;
}

/** Seçim kurallarını denetler; grupId → Türkçe hata. */
export function selectionErrors(product: StoreProduct, selected: ReadonlyMap<string, readonly string[]>): Map<string, string> {
  const errors = new Map<string, string>();
  for (const g of product.optionGroups) {
    const n = selected.get(g.id)?.length ?? 0;
    if (n < g.minSelect) errors.set(g.id, g.minSelect === 1 ? 'Bir seçim yapın.' : `En az ${g.minSelect} seçim yapın.`);
    else if (g.maxSelect !== null && n > g.maxSelect) errors.set(g.id, `En çok ${g.maxSelect} seçebilirsiniz.`);
  }
  return errors;
}

export interface ReorderPlan {
  lines: Omit<CartLine, 'key'>[];
  totalKurus: number;
  /** "Künefe bugün tükendi, sepete eklenmedi." gibi bildirimler (03 §3.4). */
  notices: string[];
}

/** "Aynısından tekrar": son siparişi güncel menüyle yeniden kurar; olmayan/tükenen ürünü atlar ve bildirir. */
export function planReorder(lastOrder: NonNullable<StoreSessionView['lastOrder']>, store: StorefrontView): ReorderPlan {
  const byId = productIndex(store);
  const lines: ReorderPlan['lines'] = [];
  const notices: string[] = [];
  for (const item of lastOrder.items) {
    const product = item.productId ? byId.get(item.productId) : undefined;
    if (!product) {
      notices.push(`${item.name} artık menüde yok, sepete eklenmedi.`);
      continue;
    }
    if (product.soldOut) {
      notices.push(`${product.name} bugün tükendi, sepete eklenmedi.`);
      continue;
    }
    const kept = orderedOptionIds(product, item.optionIds);
    if (kept.length < item.optionIds.length) notices.push(`${product.name}: bazı seçenekler artık yok, çıkarıldı.`);
    const byGroup = new Map<string, string[]>();
    for (const g of product.optionGroups) {
      const inGroup = g.options.filter((o) => kept.includes(o.id)).map((o) => o.id);
      byGroup.set(g.id, g.maxSelect !== null ? inGroup.slice(0, g.maxSelect) : inGroup);
    }
    const missing = product.optionGroups.find((g) => (byGroup.get(g.id)?.length ?? 0) < g.minSelect);
    if (missing) {
      notices.push(`${product.name} için "${missing.name}" seçimi gerekiyor; ürünü menüden ekleyin.`);
      continue;
    }
    const optionIds = product.optionGroups.flatMap((g) => byGroup.get(g.id) ?? []);
    const quantity = Math.min(QUANTITY_MAX, Math.max(1, item.quantity));
    const unit = unitPriceKurus(product, optionIds);
    lines.push({
      productId: product.id,
      quantity,
      optionIds,
      name: product.name,
      unitPriceKurus: unit,
      optionLabels: optionLabels(product, optionIds),
      imageUrl: product.imageUrl,
    });
  }
  return { lines, totalKurus: lines.reduce((s, l) => s + l.unitPriceKurus * l.quantity, 0), notices };
}

/** Sepet satırının güncel menüye göre durumu: güncel birim fiyat ya da satışta değil. */
export function lineStatus(line: CartLine, byId: ReadonlyMap<string, StoreProduct>): { available: boolean; unitPriceKurus: number } {
  const product = byId.get(line.productId);
  if (!product || product.soldOut) return { available: false, unitPriceKurus: line.unitPriceKurus };
  const ids = orderedOptionIds(product, line.optionIds ?? []);
  if (ids.length !== (line.optionIds ?? []).length) return { available: false, unitPriceKurus: line.unitPriceKurus };
  return { available: true, unitPriceKurus: unitPriceKurus(product, ids) };
}
