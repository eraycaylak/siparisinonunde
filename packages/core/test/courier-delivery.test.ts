// Kurye teslim kuralları (04 §9.2; denetim H10/H11/H13): kapıda tahsil edilebilen yöntemler ve sebep listesi.

import { describe, expect, it } from 'vitest';
import { COURIER_COLLECTED_PAYMENT_METHODS, PAYMENT_METHODS, PHASE1_PAYMENT_METHODS } from '../src/enums';
import {
  DELIVERY_FAILURE_REASONS,
  DELIVERY_FAILURE_REASON_LABELS,
  courierCanChangePayment,
  courierPaymentMethods,
  deliveryFailureNoteRequired,
  deliveryFailureReasonSchema,
} from '../src/orders/delivery';

const ALL_OPEN = [...PHASE1_PAYMENT_METHODS];

describe('kuryenin seçebileceği ödeme yöntemleri', () => {
  it('online kart ve kasada ödeme hiçbir koşulda listede olmaz', () => {
    expect(COURIER_COLLECTED_PAYMENT_METHODS).not.toContain('online_card');
    expect(COURIER_COLLECTED_PAYMENT_METHODS).not.toContain('pay_at_counter');
    for (const m of PAYMENT_METHODS) {
      if (m === 'online_card' || m === 'pay_at_counter') expect(courierCanChangePayment(m)).toBe(false);
      else expect(courierCanChangePayment(m)).toBe(true);
    }
  });

  it('yalnız şubede açık yöntemler döner', () => {
    expect(courierPaymentMethods({ branchPaymentMethods: ALL_OPEN, fulfillmentType: 'delivery' })).toEqual([
      'cash_on_delivery',
      'card_on_delivery',
      'meal_card_on_delivery',
    ]);
    expect(courierPaymentMethods({ branchPaymentMethods: ['cash_on_delivery', 'pay_at_counter'], fulfillmentType: 'delivery' })).toEqual(['cash_on_delivery']);
    expect(courierPaymentMethods({ branchPaymentMethods: ['online_card'], fulfillmentType: 'delivery' })).toEqual([]);
  });

  it('gel-al ve masada siparişte kurye tahsilatı yok', () => {
    expect(courierPaymentMethods({ branchPaymentMethods: ALL_OPEN, fulfillmentType: 'pickup' })).toEqual([]);
    expect(courierPaymentMethods({ branchPaymentMethods: ALL_OPEN, fulfillmentType: 'dine_in' })).toEqual([]);
  });

  it('şube listesi boşsa seçenek üretilmez (fail-closed)', () => {
    expect(courierPaymentMethods({ branchPaymentMethods: [], fulfillmentType: 'delivery' })).toEqual([]);
  });

  it('önceden/kasada ödenmiş siparişte liste boş döner (ekran 422 yiyecek seçenek göstermez)', () => {
    expect(courierPaymentMethods({ branchPaymentMethods: ALL_OPEN, fulfillmentType: 'delivery', orderPaymentMethod: 'online_card' })).toEqual([]);
    expect(courierPaymentMethods({ branchPaymentMethods: ALL_OPEN, fulfillmentType: 'delivery', orderPaymentMethod: 'pay_at_counter' })).toEqual([]);
    expect(courierPaymentMethods({ branchPaymentMethods: ALL_OPEN, fulfillmentType: 'delivery', orderPaymentMethod: 'cash_on_delivery' })).toEqual([
      'cash_on_delivery',
      'card_on_delivery',
      'meal_card_on_delivery',
    ]);
    // Verilmezse (ya da null) eski davranış: yalnız şube + teslim türü sınanır
    expect(courierPaymentMethods({ branchPaymentMethods: ['cash_on_delivery'], fulfillmentType: 'delivery', orderPaymentMethod: null })).toEqual([
      'cash_on_delivery',
    ]);
  });
});

describe('teslim edilemedi sebepleri', () => {
  it('her sebebin Türkçe etiketi var ve şema yalnız bu değerleri kabul eder', () => {
    for (const r of DELIVERY_FAILURE_REASONS) {
      expect(DELIVERY_FAILURE_REASON_LABELS[r]).toBeTruthy();
      expect(deliveryFailureReasonSchema.safeParse(r).success).toBe(true);
    }
    expect(deliveryFailureReasonSchema.safeParse('kapi_kapali').success).toBe(false);
    expect(deliveryFailureReasonSchema.safeParse('courier_issue').success).toBe(false);
  });

  it('"Diğer" sebebinde açıklama zorunlu, diğerlerinde değil', () => {
    expect(deliveryFailureNoteRequired('other', null)).toBe(true);
    expect(deliveryFailureNoteRequired('other', '   ')).toBe(true);
    expect(deliveryFailureNoteRequired('other', 'Bina yıkılmış')).toBe(false);
    expect(deliveryFailureNoteRequired('customer_absent', null)).toBe(false);
  });
});
