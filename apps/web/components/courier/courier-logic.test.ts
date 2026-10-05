import { describe, expect, it } from 'vitest';
import type { CourierOrder } from '@siparis/core/orders/contracts';
import { DELIVER_UNDO_MS, canReportUndeliverable, deliverBody, deliverOptions, deliverReady, deliveryFailureText } from './courier-logic';

function order(patch: Partial<CourierOrder> = {}): CourierOrder {
  return {
    id: 'o1',
    number: 1051,
    status: 'on_the_way',
    fulfillmentType: 'delivery',
    customerName: 'Ayşe K.',
    customerPhone: '+905321234567',
    neighborhood: 'Medrese',
    addressLine: 'Moda Cd. No 12',
    directions: null,
    lat: null,
    lng: null,
    zoneName: 'Merkez',
    paymentMethod: 'cash_on_delivery',
    mealCardBrand: null,
    allowedPaymentMethods: ['cash_on_delivery', 'card_on_delivery', 'meal_card_on_delivery'],
    totalKurus: 28500,
    changeForKurus: null,
    changeKurus: null,
    note: null,
    items: [],
    estimatedReadyAt: null,
    readyAt: null,
    onTheWayAt: null,
    deliveryAttempts: 0,
    lastDeliveryFailure: null,
    version: 3,
    ...patch,
  };
}

describe('kurye teslim seçenekleri', () => {
  it('geri alma penceresi 5 sn', () => {
    expect(DELIVER_UNDO_MS).toBe(5_000);
  });

  it('siparişin kendi yöntemi "farklı yöntem" listesinde çıkmaz', () => {
    expect(deliverOptions(order()).map((o) => o.value)).toEqual(['card_on_delivery', 'meal_card_on_delivery']);
  });

  it('şubede kapalı yöntem önerilmez (sunucu listesi)', () => {
    expect(deliverOptions(order({ allowedPaymentMethods: ['cash_on_delivery'] })).map((o) => o.value)).toEqual([]);
    expect(deliverOptions(order({ paymentMethod: 'online_card', allowedPaymentMethods: [] })).map((o) => o.value)).toEqual([]);
  });

  it('yemek kartında marka seçilmeden gönderilemez', () => {
    expect(deliverReady('meal_card_on_delivery', '')).toBe(false);
    expect(deliverReady('meal_card_on_delivery', 'multinet')).toBe(true);
    expect(deliverReady('as_ordered', '')).toBe(true);
  });

  it('gövde: olduğu gibi teslimde boş, farklı yöntemde paidWith', () => {
    expect(deliverBody('as_ordered', '')).toEqual({});
    expect(deliverBody('card_on_delivery', '')).toEqual({ paidWith: 'card_on_delivery' });
    expect(deliverBody('meal_card_on_delivery', 'pluxee')).toEqual({ paidWith: 'meal_card_on_delivery', mealCardBrand: 'pluxee' });
  });
});

describe('teslim edilemedi görünümü', () => {
  it('yalnız yolda olan paket siparişinde bildirilebilir', () => {
    expect(canReportUndeliverable(order())).toBe(true);
    expect(canReportUndeliverable(order({ status: 'ready' }))).toBe(false);
    expect(canReportUndeliverable(order({ fulfillmentType: 'pickup' }))).toBe(false);
  });

  it('bildirim metni sebebi ve tekrar sayısını yazar', () => {
    expect(deliveryFailureText(null, 0)).toBeNull();
    expect(deliveryFailureText({ reason: 'address_not_found', note: null, at: '2026-10-05T10:00:00Z' }, 1)).toBe(
      'Teslim edilemedi bildirildi · Adres bulunamadı',
    );
    expect(deliveryFailureText({ reason: 'customer_absent', note: null, at: '2026-10-05T10:00:00Z' }, 2)).toBe(
      'Teslim edilemedi bildirildi · Müşteri kapıyı açmadı · 2 kez',
    );
  });
});
