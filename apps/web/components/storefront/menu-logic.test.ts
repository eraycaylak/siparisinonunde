import { describe, expect, it } from 'vitest';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { clockLocative, deliverySummary, nextOpenText, orderingStatus } from './format';
import { planReorder, selectionErrors, unitPriceKurus } from './menu-logic';

const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const P3 = '00000000-0000-4000-8000-000000000003';
const G1 = '00000000-0000-4000-8000-0000000000a1';
const G2 = '00000000-0000-4000-8000-0000000000a2';
const O1 = '00000000-0000-4000-8000-0000000000b1';
const O2 = '00000000-0000-4000-8000-0000000000b2';
const O3 = '00000000-0000-4000-8000-0000000000b3';

function store(overrides: Partial<StorefrontView['branch']> = {}): StorefrontView {
  return {
    tenant: { name: 'Test', slug: 'test-isletme', brandColor: null, logoUrl: null, coverUrl: null, phone: null },
    branch: {
      id: P1,
      name: 'Merkez',
      address: null,
      orderingState: 'open',
      nextOpenAt: null,
      acceptsDelivery: true,
      acceptsPickup: true,
      paymentMethods: ['cash_on_delivery'],
      mealCardBrands: [],
      prepMinutes: 20,
      busyExtraMinutes: 0,
      ...overrides,
    },
    orderingEnabled: true,
    zones: [
      { id: G1, name: 'Yakın', kind: 'neighborhoods', neighborhoods: [], feeKurus: 0, minOrderKurus: 15000, etaMinutes: 10 },
      { id: G2, name: 'Uzak', kind: 'neighborhoods', neighborhoods: [], feeKurus: 2500, minOrderKurus: 20000, etaMinutes: 20 },
    ],
    categories: [
      {
        id: G1,
        name: 'Pideler',
        products: [
          {
            id: P1,
            name: 'Pide',
            description: null,
            priceKurus: 20000,
            imageUrl: null,
            soldOut: false,
            optionGroups: [
              { id: G1, name: 'Acı', minSelect: 1, maxSelect: 1, options: [{ id: O1, name: 'Acılı', priceDeltaKurus: 0 }] },
              { id: G2, name: 'Ekstra', minSelect: 0, maxSelect: 2, options: [{ id: O2, name: 'Kaşar', priceDeltaKurus: 3000 }] },
            ],
          },
          { id: P2, name: 'Künefe', description: null, priceKurus: 15000, imageUrl: null, soldOut: true, optionGroups: [] },
        ],
      },
    ],
    legal: { legalName: null, taxNo: null, taxOffice: null, address: null, phone: null, email: null },
  };
}

describe('clockLocative', () => {
  it('Türkçe ünlü uyumu ve sertleşme', () => {
    expect(clockLocative('10.00')).toBe("'da");
    expect(clockLocative('11.00')).toBe("'de");
    expect(clockLocative('13.00')).toBe("'te");
    expect(clockLocative('14.00')).toBe("'te");
    expect(clockLocative('16.00')).toBe("'da");
    expect(clockLocative('20.00')).toBe("'de");
    expect(clockLocative('10.30')).toBe("'da");
    expect(clockLocative('10.40')).toBe("'ta");
    expect(clockLocative('00.00')).toBe("'da");
    expect(clockLocative('Yarın 09.00')).toBe("'da");
  });
});

describe('orderingStatus ve teslimat özeti', () => {
  it('kapalı: "Yarın 10.00\'da açılıyor"', () => {
    const now = new Date('2026-09-24T21:00:00Z');
    const s = orderingStatus(store({ orderingState: 'closed', nextOpenAt: '2026-09-25T07:00:00Z' }), now);
    expect(s.acceptsOrders).toBe(false);
    expect(s.label).toBe('Kapalı');
    expect(s.detail).toBe("Bugün 10.00'da açılıyor");
    expect(nextOpenText('2026-09-25T07:00:00Z', new Date('2026-09-24T12:00:00Z'))).toBe("Yarın 10.00'da açılıyor");
  });

  it('yoğun: "+X dk" ve bant', () => {
    const s = orderingStatus(store({ orderingState: 'busy', busyExtraMinutes: 15 }));
    expect(s.label).toBe('Yoğun (+15 dk)');
    expect(s.band).toBe('Yoğunuz · Tahmini 45–65 dk');
    expect(s.acceptsOrders).toBe(true);
  });

  it('online sipariş kapalı (kill-switch)', () => {
    const v = { ...store({ orderingState: 'paused' }), orderingEnabled: false };
    expect(orderingStatus(v).label).toBe('Şu an online sipariş alınmıyor');
  });

  it('teslimat özeti: süre, ücret aralığı, min. sepet, gel-al', () => {
    expect(deliverySummary(store()).map((s) => s.text)).toEqual(['30–50 dk', 'Teslimat 0–25 TL', "Min. sepet 150 TL'den", "Gel-al · 20 dk'da hazır"]);
  });
});

describe('seçenekler ve "Aynısından tekrar"', () => {
  it('birim fiyat ve zorunlu grup doğrulaması', () => {
    const p = store().categories[0]!.products[0]!;
    expect(unitPriceKurus(p, [O1, O2])).toBe(23000);
    const errors = selectionErrors(p, new Map([[G2, [O2]]]));
    expect(errors.get(G1)).toBe('Bir seçim yapın.');
    expect(errors.has(G2)).toBe(false);
  });

  it('tükenen ve menüden kalkan ürünü atlar, kaldırılan seçeneği bildirir', () => {
    const plan = planReorder(
      {
        items: [
          { productId: P1, name: 'Pide', quantity: 2, optionIds: [O1, O2, O3] },
          { productId: P2, name: 'Künefe', quantity: 1, optionIds: [] },
          { productId: P3, name: 'Eski ürün', quantity: 1, optionIds: [] },
        ],
        totalKurus: 0,
        createdAt: '2026-09-20T12:00:00Z',
      },
      store(),
    );
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatchObject({ productId: P1, quantity: 2, optionIds: [O1, O2], unitPriceKurus: 23000, optionLabels: ['Acılı', 'Kaşar'] });
    expect(plan.totalKurus).toBe(46000);
    expect(plan.notices).toEqual([
      'Pide: bazı seçenekler artık yok, çıkarıldı.',
      'Künefe bugün tükendi, sepete eklenmedi.',
      'Eski ürün artık menüde yok, sepete eklenmedi.',
    ]);
  });

  it('zorunlu seçimi kaybolan ürün eklenmez', () => {
    const plan = planReorder({ items: [{ productId: P1, name: 'Pide', quantity: 1, optionIds: [] }], totalKurus: 0, createdAt: '2026-09-20T12:00:00Z' }, store());
    expect(plan.lines).toHaveLength(0);
    expect(plan.notices[0]).toContain('"Acı" seçimi gerekiyor');
  });
});
