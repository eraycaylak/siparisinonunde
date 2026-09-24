import { describe, expect, it } from 'vitest';
import { etaRange, quoteCart, type PricingProduct } from '../src/pricing';

const porsiyon = {
  id: 'g-porsiyon',
  name: 'Porsiyon',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: 'o-tam', name: 'Tam porsiyon', priceDeltaKurus: 0 },
    { id: 'o-bucuk', name: '1,5 porsiyon', priceDeltaKurus: 12000 },
  ],
};
const ekstra = {
  id: 'g-ekstra',
  name: 'Ekstralar',
  minSelect: 0,
  maxSelect: 3,
  options: [
    { id: 'o-kasar', name: 'Kaşar', priceDeltaKurus: 3000 },
    { id: 'o-yumurta', name: 'Yumurta', priceDeltaKurus: 2000 },
    { id: 'o-sucuk', name: 'Sucuk', priceDeltaKurus: 4000 },
    { id: 'o-tereyag', name: 'Tereyağı', priceDeltaKurus: 1500 },
    { id: 'o-pasif', name: 'Pastırma', priceDeltaKurus: 5000, isActive: false },
  ],
};
const products: PricingProduct[] = [
  { id: 'p-adana', name: 'Adana Kebap', priceKurus: 30000, optionGroups: [porsiyon] },
  { id: 'p-pide', name: 'Kıymalı Pide', priceKurus: 20000, optionGroups: [ekstra] },
  { id: 'p-ayran', name: 'Ayran', priceKurus: 3000, optionGroups: [] },
  { id: 'p-kapali', name: 'Künefe', priceKurus: 15000, isActive: false, optionGroups: [] },
  { id: 'p-bira', name: 'Bira', priceKurus: 10000, waRestricted: true, optionGroups: [] },
  {
    id: 'p-tukendi',
    name: 'Sütlaç',
    priceKurus: 9000,
    soldOutUntil: new Date('2026-09-25T00:00:00Z'),
    optionGroups: [],
  },
];
const zone = { id: 'z1', name: 'Merkez yakın', feeKurus: 2000, minOrderKurus: 25000, etaMinutes: 25 };
const now = new Date('2026-09-24T12:00:00Z');

describe('quoteCart', () => {
  it('satır, ara toplam, bölge ücreti ve toplam', () => {
    const q = quoteCart(
      {
        fulfillmentType: 'delivery',
        zone,
        items: [
          { productId: 'p-adana', quantity: 1, optionIds: ['o-bucuk'] },
          { productId: 'p-pide', quantity: 2, optionIds: ['o-kasar', 'o-yumurta'] },
          { productId: 'p-ayran', quantity: 2, optionIds: [] },
        ],
      },
      { products, now },
    );
    expect(q.problems).toEqual([]);
    expect(q.ok).toBe(true);
    expect(q.lines.map((l) => l.lineTotalKurus)).toEqual([42000, 50000, 6000]);
    expect(q.lines[1]!.optionsUnitKurus).toBe(5000);
    expect(q.subtotalKurus).toBe(98000);
    expect(q.deliveryFeeKurus).toBe(2000);
    expect(q.totalKurus).toBe(100000);
    expect(q.minOrderKurus).toBe(25000);
    expect(q.meetsMinimum).toBe(true);
    expect(q.zone?.id).toBe('z1');
  });

  it('zorunlu seçenek eksikse option_rule_violation', () => {
    const q = quoteCart({ fulfillmentType: 'pickup', items: [{ productId: 'p-adana', quantity: 1, optionIds: [] }] }, { products, now });
    expect(q.ok).toBe(false);
    expect(q.problems[0]).toMatchObject({ code: 'option_rule_violation', groupId: 'g-porsiyon', productId: 'p-adana' });
  });

  it('max aşımı, geçersiz, pasif ve tekrar eden seçenek', () => {
    const tooMany = quoteCart(
      { fulfillmentType: 'pickup', items: [{ productId: 'p-pide', quantity: 1, optionIds: ['o-kasar', 'o-yumurta', 'o-sucuk', 'o-tereyag'] }] },
      { products, now },
    );
    expect(tooMany.problems.map((p) => p.code)).toEqual(['option_rule_violation']);

    const two = quoteCart(
      { fulfillmentType: 'pickup', items: [{ productId: 'p-adana', quantity: 1, optionIds: ['o-tam', 'o-bucuk'] }] },
      { products, now },
    );
    expect(two.problems[0]?.code).toBe('option_rule_violation');

    const foreign = quoteCart(
      { fulfillmentType: 'pickup', items: [{ productId: 'p-pide', quantity: 1, optionIds: ['o-tam'] }] },
      { products, now },
    );
    expect(foreign.problems[0]?.code).toBe('option_not_found');

    const inactive = quoteCart(
      { fulfillmentType: 'pickup', items: [{ productId: 'p-pide', quantity: 1, optionIds: ['o-pasif'] }] },
      { products, now },
    );
    expect(inactive.problems[0]?.code).toBe('option_unavailable');

    const dup = quoteCart(
      { fulfillmentType: 'pickup', items: [{ productId: 'p-pide', quantity: 1, optionIds: ['o-kasar', 'o-kasar'] }] },
      { products, now },
    );
    expect(dup.problems[0]?.code).toBe('duplicate_option');
  });

  it('ürün yok, satışta değil, tükendi, kısıtlı, adet hatası', () => {
    const q = quoteCart(
      {
        fulfillmentType: 'pickup',
        items: [
          { productId: 'yok', quantity: 1, optionIds: [] },
          { productId: 'p-kapali', quantity: 1, optionIds: [] },
          { productId: 'p-tukendi', quantity: 1, optionIds: [] },
          { productId: 'p-bira', quantity: 1, optionIds: [] },
          { productId: 'p-ayran', quantity: 0, optionIds: [] },
          { productId: 'p-ayran', quantity: 51, optionIds: [] },
        ],
      },
      { products, now },
    );
    expect(q.problems.map((p) => p.code)).toEqual([
      'product_not_found',
      'item_unavailable',
      'item_unavailable',
      'restricted_item',
      'invalid_quantity',
      'invalid_quantity',
    ]);
    expect(q.lines).toEqual([]);
  });

  it('tükendi süresi geçince satılabilir', () => {
    const later = new Date('2026-09-25T01:00:00Z');
    const q = quoteCart({ fulfillmentType: 'pickup', items: [{ productId: 'p-tukendi', quantity: 1, optionIds: [] }] }, { products, now: later });
    expect(q.ok).toBe(true);
  });

  it('min sepet karşılanmazsa eksik tutarla problem', () => {
    const q = quoteCart(
      { fulfillmentType: 'delivery', zone, items: [{ productId: 'p-ayran', quantity: 2, optionIds: [] }] },
      { products, now },
    );
    expect(q.meetsMinimum).toBe(false);
    expect(q.ok).toBe(false);
    const p = q.problems.find((x) => x.code === 'min_basket_not_met');
    expect(p?.missingKurus).toBe(19000);
    expect(q.totalKurus).toBe(8000);
  });

  it('paket serviste bölge yoksa out_of_delivery_area; manuel istisna ücretle geçer', () => {
    const items = [{ productId: 'p-pide', quantity: 2, optionIds: [] }];
    const out = quoteCart({ fulfillmentType: 'delivery', zone: null, items }, { products, now });
    expect(out.problems.map((p) => p.code)).toContain('out_of_delivery_area');
    const override = quoteCart({ fulfillmentType: 'delivery', zone: null, items }, { products, now, outOfZoneOverride: { feeKurus: 5000 } });
    expect(override.ok).toBe(true);
    expect(override.deliveryFeeKurus).toBe(5000);
    expect(override.totalKurus).toBe(45000);
  });

  it('gel-al ücretsiz; kapalı teslim türü hatası', () => {
    const q = quoteCart({ fulfillmentType: 'pickup', items: [{ productId: 'p-ayran', quantity: 1, optionIds: [] }] }, { products, now });
    expect(q.deliveryFeeKurus).toBe(0);
    expect(q.totalKurus).toBe(3000);
    const closed = quoteCart(
      { fulfillmentType: 'delivery', zone, items: [{ productId: 'p-pide', quantity: 2, optionIds: [] }] },
      { products, now, acceptsDelivery: false },
    );
    expect(closed.problems.map((p) => p.code)).toContain('fulfillment_unavailable');
  });

  it('boş sepet', () => {
    expect(quoteCart({ fulfillmentType: 'pickup', items: [] }, { products, now }).problems[0]?.code).toBe('empty_cart');
  });

  it('ETA aralığı', () => {
    expect(etaRange({ zoneEtaMinutes: 25, prepMinutes: 20 }).label).toBe('45–55 dk');
    expect(etaRange({ zoneEtaMinutes: 10, prepMinutes: 12, busyExtraMinutes: 15 })).toMatchObject({ minMinutes: 35, maxMinutes: 45 });
  });
});
