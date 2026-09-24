// Sepet/fiyat hesabı (07 §5, 14 §6.2 quote). Saf fonksiyon: ürün ve bölge verisi parametre olarak gelir.
// Fiyat yalnız sunucuda hesaplanır; istemci tutarı yok sayılır (CLAUDE.md kural 3).

import type { FulfillmentType } from './enums';
import { formatTL } from './money';

export const MAX_ITEM_QUANTITY = 50;
export const MAX_CART_LINES = 100;

export interface PricingOption {
  id: string;
  name: string;
  priceDeltaKurus: number;
  isActive?: boolean;
}

export interface PricingOptionGroup {
  id: string;
  name: string;
  minSelect: number;
  /** null = sınırsız */
  maxSelect: number | null;
  options: PricingOption[];
}

export interface PricingProduct {
  id: string;
  name: string;
  categoryName?: string | null;
  priceKurus: number;
  isActive?: boolean;
  /** "Bugün tükendi": bu andan önce satılamaz. */
  soldOutUntil?: Date | string | null;
  /** Alkol/tütün vb.: satılamaz (00 §6.10). */
  waRestricted?: boolean;
  optionGroups: PricingOptionGroup[];
}

export interface PricingZone {
  id: string;
  name: string;
  feeKurus: number;
  minOrderKurus: number;
  etaMinutes: number;
}

export interface CartItemInput {
  productId: string;
  quantity: number;
  optionIds: string[];
  note?: string | null;
}

export interface QuoteInput {
  items: CartItemInput[];
  fulfillmentType: FulfillmentType;
  /** Çağıran tarafından çözülmüş bölge (zones.resolveZone); paket serviste yoksa bölge dışı. */
  zone?: PricingZone | null;
}

export interface QuoteContext {
  products: readonly PricingProduct[] | ReadonlyMap<string, PricingProduct>;
  now?: Date;
  acceptsDelivery?: boolean;
  acceptsPickup?: boolean;
  /** Gel-al minimum sepeti (varsayılan 0). */
  pickupMinOrderKurus?: number;
  /**
   * Manuel siparişte bölge dışı istisnası (00 §4): bölge yoksa hata yerine bu ücretle devam edilir,
   * min sepet uygulanmaz.
   */
  outOfZoneOverride?: { feeKurus: number } | null;
}

export type QuoteProblemCode =
  | 'empty_cart'
  | 'too_many_lines'
  | 'product_not_found'
  | 'item_unavailable'
  | 'restricted_item'
  | 'invalid_quantity'
  | 'option_not_found'
  | 'option_unavailable'
  | 'duplicate_option'
  | 'option_rule_violation'
  | 'fulfillment_unavailable'
  | 'out_of_delivery_area'
  | 'min_basket_not_met';

export interface QuoteProblem {
  code: QuoteProblemCode;
  message: string;
  productId?: string;
  groupId?: string;
  optionId?: string;
  /** Min sepet için eksik tutar. */
  missingKurus?: number;
}

export interface QuoteLineOption {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDeltaKurus: number;
}

export interface QuoteLine {
  productId: string;
  name: string;
  categoryName: string | null;
  quantity: number;
  unitPriceKurus: number;
  optionsUnitKurus: number;
  lineTotalKurus: number;
  options: QuoteLineOption[];
  note: string | null;
}

export interface QuoteResult {
  lines: QuoteLine[];
  subtotalKurus: number;
  deliveryFeeKurus: number;
  totalKurus: number;
  minOrderKurus: number;
  meetsMinimum: boolean;
  zone: PricingZone | null;
  problems: QuoteProblem[];
  /** Sipariş oluşturulabilir mi (problem yok). */
  ok: boolean;
}

function toMap(products: QuoteContext['products']): ReadonlyMap<string, PricingProduct> {
  if (products instanceof Map) return products;
  return new Map((products as readonly PricingProduct[]).map((p) => [p.id, p]));
}

function isSoldOut(p: PricingProduct, now: Date): boolean {
  if (!p.soldOutUntil) return false;
  const until = p.soldOutUntil instanceof Date ? p.soldOutUntil : new Date(p.soldOutUntil);
  return !Number.isNaN(until.getTime()) && until > now;
}

/** Tek satırı doğrular ve fiyatlar; hata varsa problem listesine yazar ve null döner. */
export function priceLine(
  item: CartItemInput,
  product: PricingProduct | undefined,
  now: Date,
  problems: QuoteProblem[],
): QuoteLine | null {
  if (!product) {
    problems.push({ code: 'product_not_found', message: 'Ürün bulunamadı.', productId: item.productId });
    return null;
  }
  if (product.isActive === false || isSoldOut(product, now)) {
    problems.push({
      code: 'item_unavailable',
      message: `${product.name} şu an satışta değil.`,
      productId: product.id,
    });
    return null;
  }
  if (product.waRestricted) {
    problems.push({
      code: 'restricted_item',
      message: `${product.name} online sipariş ile satılamaz.`,
      productId: product.id,
    });
    return null;
  }
  if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_ITEM_QUANTITY) {
    problems.push({
      code: 'invalid_quantity',
      message: `Adet 1 ile ${MAX_ITEM_QUANTITY} arasında olmalı.`,
      productId: product.id,
    });
    return null;
  }

  const lineProblems: QuoteProblem[] = [];
  const optionIndex = new Map<string, { group: PricingOptionGroup; option: PricingOption }>();
  for (const group of product.optionGroups) {
    for (const option of group.options) optionIndex.set(option.id, { group, option });
  }

  const seen = new Set<string>();
  const chosen: QuoteLineOption[] = [];
  const countByGroup = new Map<string, number>();
  for (const optionId of item.optionIds ?? []) {
    if (seen.has(optionId)) {
      lineProblems.push({
        code: 'duplicate_option',
        message: 'Aynı seçenek birden fazla seçilemez.',
        productId: product.id,
        optionId,
      });
      continue;
    }
    seen.add(optionId);
    const hit = optionIndex.get(optionId);
    if (!hit) {
      lineProblems.push({
        code: 'option_not_found',
        message: `${product.name} için geçersiz seçenek.`,
        productId: product.id,
        optionId,
      });
      continue;
    }
    if (hit.option.isActive === false) {
      lineProblems.push({
        code: 'option_unavailable',
        message: `${hit.option.name} şu an seçilemiyor.`,
        productId: product.id,
        groupId: hit.group.id,
        optionId,
      });
      continue;
    }
    countByGroup.set(hit.group.id, (countByGroup.get(hit.group.id) ?? 0) + 1);
    chosen.push({
      groupId: hit.group.id,
      groupName: hit.group.name,
      optionId: hit.option.id,
      optionName: hit.option.name,
      priceDeltaKurus: hit.option.priceDeltaKurus,
    });
  }

  for (const group of product.optionGroups) {
    const count = countByGroup.get(group.id) ?? 0;
    if (count < group.minSelect) {
      lineProblems.push({
        code: 'option_rule_violation',
        message:
          group.minSelect === 1
            ? `${product.name}: "${group.name}" için bir seçim yapın.`
            : `${product.name}: "${group.name}" için en az ${group.minSelect} seçim yapın.`,
        productId: product.id,
        groupId: group.id,
      });
    } else if (group.maxSelect != null && count > group.maxSelect) {
      lineProblems.push({
        code: 'option_rule_violation',
        message: `${product.name}: "${group.name}" için en fazla ${group.maxSelect} seçim yapılabilir.`,
        productId: product.id,
        groupId: group.id,
      });
    }
  }

  if (lineProblems.length) {
    problems.push(...lineProblems);
    return null;
  }

  // Seçenekleri grup sırasıyla diz (fiş ve özet tutarlı olsun)
  const groupOrder = new Map(product.optionGroups.map((g, i) => [g.id, i]));
  chosen.sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0));

  const optionsUnitKurus = chosen.reduce((s, o) => s + o.priceDeltaKurus, 0);
  const unit = product.priceKurus;
  const lineTotalKurus = Math.max(0, (unit + optionsUnitKurus) * item.quantity);
  const note = item.note?.trim() ? item.note.trim() : null;
  return {
    productId: product.id,
    name: product.name,
    categoryName: product.categoryName ?? null,
    quantity: item.quantity,
    unitPriceKurus: unit,
    optionsUnitKurus,
    lineTotalKurus,
    options: chosen,
    note,
  };
}

/** Sepeti doğrular ve toplamları hesaplar (07 §5 adım 2–8). */
export function quoteCart(input: QuoteInput, ctx: QuoteContext): QuoteResult {
  const now = ctx.now ?? new Date();
  const products = toMap(ctx.products);
  const problems: QuoteProblem[] = [];
  const lines: QuoteLine[] = [];

  if (!input.items?.length) {
    problems.push({ code: 'empty_cart', message: 'Sepetiniz boş.' });
  } else if (input.items.length > MAX_CART_LINES) {
    problems.push({ code: 'too_many_lines', message: 'Sepette çok fazla satır var.' });
  } else {
    for (const item of input.items) {
      const line = priceLine(item, products.get(item.productId), now, problems);
      if (line) lines.push(line);
    }
  }

  const subtotalKurus = lines.reduce((s, l) => s + l.lineTotalKurus, 0);
  let deliveryFeeKurus = 0;
  let minOrderKurus = 0;
  let zone: PricingZone | null = null;

  if (input.fulfillmentType === 'delivery') {
    if (ctx.acceptsDelivery === false) {
      problems.push({ code: 'fulfillment_unavailable', message: 'Bu işletme şu an paket servis yapmıyor.' });
    }
    if (input.zone) {
      zone = input.zone;
      deliveryFeeKurus = zone.feeKurus;
      minOrderKurus = zone.minOrderKurus;
    } else if (ctx.outOfZoneOverride) {
      deliveryFeeKurus = Math.max(0, ctx.outOfZoneOverride.feeKurus);
      minOrderKurus = 0;
    } else {
      problems.push({ code: 'out_of_delivery_area', message: 'Bu adrese şu an teslimat yapamıyoruz.' });
    }
  } else if (input.fulfillmentType === 'pickup') {
    if (ctx.acceptsPickup === false) {
      problems.push({ code: 'fulfillment_unavailable', message: 'Bu işletme şu an gel-al siparişi almıyor.' });
    }
    minOrderKurus = Math.max(0, ctx.pickupMinOrderKurus ?? 0);
  } else {
    problems.push({ code: 'fulfillment_unavailable', message: 'Bu teslim türü henüz desteklenmiyor.' });
  }

  const meetsMinimum = subtotalKurus >= minOrderKurus;
  if (!meetsMinimum && lines.length) {
    const missing = minOrderKurus - subtotalKurus;
    problems.push({
      code: 'min_basket_not_met',
      message: `Minimum sepet tutarı ${formatTL(minOrderKurus)}. ${formatTL(missing)} daha ekleyin.`,
      missingKurus: missing,
    });
  }

  const totalKurus = subtotalKurus + deliveryFeeKurus;
  return {
    lines,
    subtotalKurus,
    deliveryFeeKurus,
    totalKurus,
    minOrderKurus,
    meetsMinimum,
    zone,
    problems,
    ok: problems.length === 0,
  };
}

/** Tahmini süre aralığı (03 §5.4): bölge + hazırlık (+ yoğunluk), alt sınır 5'e yuvarlanır, genişlik 10 dk. */
export function etaRange(parts: { zoneEtaMinutes?: number | null; prepMinutes?: number | null; busyExtraMinutes?: number | null }): {
  minMinutes: number;
  maxMinutes: number;
  label: string;
} {
  const base = (parts.zoneEtaMinutes ?? 0) + (parts.prepMinutes ?? 0) + (parts.busyExtraMinutes ?? 0);
  const min = Math.max(5, Math.round(base / 5) * 5);
  const max = min + 10;
  return { minMinutes: min, maxMinutes: max, label: `${min}–${max} dk` };
}
