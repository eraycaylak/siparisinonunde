import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, type OrderStatus } from '../src/enums';
import {
  ORDER_TRANSITIONS,
  allowedActions,
  assertTransition,
  canTransition,
  isFinal,
  isOpen,
  nextActions,
  validateTransition,
} from '../src/order-fsm';

// 00 §5 kanonik geçişler (birebir)
const CANONICAL: Record<OrderStatus, OrderStatus[]> = {
  awaiting_customer: ['new', 'cancelled'],
  new: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'ready', 'on_the_way', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['on_the_way', 'delivered', 'cancelled'],
  on_the_way: ['delivered', 'cancelled'],
  delivered: [],
  rejected: [],
  cancelled: [],
};

describe('order FSM', () => {
  it('geçiş tablosu 00 §5 ile birebir', () => {
    for (const s of ORDER_STATUSES) {
      expect([...ORDER_TRANSITIONS[s]].sort()).toEqual([...CANONICAL[s]].sort());
    }
  });

  // Tüm (from, to) çiftleri: izinli/izinsiz
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      const allowed = CANONICAL[from].includes(to);
      it(`${from} → ${to}: ${allowed ? 'izinli' : 'izinsiz'}`, () => {
        expect(canTransition(from, to)).toBe(allowed);
        const input =
          to === 'rejected'
            ? { reason: 'too_busy' }
            : to === 'cancelled'
              ? { reason: 'customer_request', cancelledBy: 'customer' as const }
              : {};
        const err = validateTransition(from, to, input);
        if (allowed) expect(err).toBeNull();
        else expect(err?.code).toBe('invalid_transition');
      });
    }
  }

  it('geçersiz geçiş mesajı Türkçe durum etiketleriyle (kod içermez)', () => {
    const err = validateTransition('preparing', 'on_the_way');
    expect(err?.message).toBe('Bu sipariş "Hazırlanıyor" durumundan "Yolda" durumuna geçemez.');
    expect(err?.message).not.toMatch(/preparing|on_the_way/);
  });

  it('rejected → new geçişi yoktur', () => {
    expect(canTransition('rejected', 'new')).toBe(false);
  });

  it('final durumlar', () => {
    expect(isFinal('delivered')).toBe(true);
    expect(isFinal('rejected')).toBe(true);
    expect(isFinal('cancelled')).toBe(true);
    expect(isFinal('new')).toBe(false);
    expect(isOpen('on_the_way')).toBe(true);
    for (const s of ['delivered', 'rejected', 'cancelled'] as const) expect(nextActions(s)).toEqual([]);
  });

  it('ret sebebi zorunlu; other için not zorunlu', () => {
    expect(validateTransition('new', 'rejected', {})?.code).toBe('reason_required');
    expect(validateTransition('new', 'rejected', { reason: 'nope' })?.code).toBe('reason_required');
    expect(validateTransition('new', 'rejected', { reason: 'other' })?.code).toBe('note_required');
    expect(validateTransition('new', 'rejected', { reason: 'other', note: 'Malzeme bitti' })).toBeNull();
  });

  it('iptalde cancelled_by ve sebep zorunlu', () => {
    expect(validateTransition('new', 'cancelled', { reason: 'customer_request' })?.code).toBe('cancelled_by_required');
    expect(validateTransition('new', 'cancelled', { cancelledBy: 'system' })?.code).toBe('reason_required');
    expect(validateTransition('accepted', 'cancelled', { cancelledBy: 'tenant', reason: 'other' })?.code).toBe('note_required');
    expect(validateTransition('accepted', 'cancelled', { cancelledBy: 'tenant', reason: 'courier_issue' })).toBeNull();
  });

  it('assertTransition hata fırlatır', () => {
    expect(() => assertTransition('delivered', 'new')).toThrow();
    expect(() => assertTransition('new', 'accepted')).not.toThrow();
  });

  it('nextActions bağlama göre süzer', () => {
    expect(nextActions('accepted', { fulfillmentType: 'pickup' })).toEqual(['preparing', 'ready', 'cancelled']);
    expect(nextActions('accepted', { usePreparingStep: false, fulfillmentType: 'delivery' })).toEqual([
      'ready',
      'on_the_way',
      'cancelled',
    ]);
    expect(nextActions('new', { rejectionPending: true })).toEqual(['cancelled']);
    expect(allowedActions('ready', { fulfillmentType: 'pickup' })).toEqual(['delivered', 'cancelled']);
  });
});
