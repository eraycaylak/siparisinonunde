import { describe, expect, it } from 'vitest';
import { alarmingOrdersOf, bandOrdersOf, isHighLevel, newOrdersOf, orderAnchorHref, withNewOrderCount, type AlarmCard } from './alarm-state';

const T0 = Date.parse('2026-09-25T12:00:00Z');

function card(id: string, patch: Partial<AlarmCard> = {}): AlarmCard {
  return {
    id,
    number: 1000,
    status: 'new',
    channel: 'web',
    rejectionScheduledAt: null,
    testKind: null,
    verifiedAt: new Date(T0).toISOString(),
    placedAt: new Date(T0 - 5_000).toISOString(),
    alarmStep: null,
    ...patch,
  };
}

describe('yeni sipariş alarm kuralları', () => {
  const items = [
    card('a'),
    card('b', { channel: 'manual' }),
    card('c', { rejectionScheduledAt: new Date(T0).toISOString() }),
    card('d', { testKind: 'canary' }),
    card('e', { status: 'accepted' }),
    card('f', { channel: 'wa_link', testKind: 'onboarding_test' }),
  ];

  it('yeni siparişler: kanarya ve yeni olmayanlar hariç', () => {
    expect(newOrdersOf(items).map((c) => c.id)).toEqual(['a', 'b', 'c', 'f']);
  });

  it('bant: telefon siparişi ve ret geri sayımı hariç; test siparişi dahil', () => {
    expect(bandOrdersOf(items, false).map((c) => c.id)).toEqual(['a', 'f']);
  });

  it('mutfak bant ve alarm görmez', () => {
    expect(bandOrdersOf(items, true)).toEqual([]);
    expect(alarmingOrdersOf(items, new Set(), true)).toEqual([]);
  });

  it('"Gördüm" ile susturulan sipariş çalmaz ama bantta kalır', () => {
    const silenced = new Set(['a']);
    expect(alarmingOrdersOf(items, silenced, false).map((c) => c.id)).toEqual(['f']);
    expect(bandOrdersOf(items, false).map((c) => c.id)).toContain('a');
  });

  it('ses 60 sn sonra ya da sunucu alarmı 2. adımdayken yükselir', () => {
    const a = card('a');
    expect(isHighLevel([a], new Set(), T0 + 59_000)).toBe(false);
    expect(isHighLevel([a], new Set(), T0 + 60_000)).toBe(true);
    expect(isHighLevel([a], new Set(['a']), T0 + 1_000)).toBe(true);
    expect(isHighLevel([card('a', { alarmStep: 2 })], new Set(), T0 + 1_000)).toBe(true);
    expect(isHighLevel([], new Set(['a']), T0 + 120_000)).toBe(false);
  });

  it('doğrulanmamış (Akış B) siparişte süre oluşturmadan sayılır', () => {
    const b = card('b', { verifiedAt: null, placedAt: new Date(T0).toISOString() });
    expect(isHighLevel([b], new Set(), T0 + 61_000)).toBe(true);
  });

  it('sekme başlığı: sayfanın kendi başlığı korunur, ön ek tekrarlanmaz', () => {
    expect(withNewOrderCount('Sohbetler · Panel', 2)).toBe('(2) Yeni sipariş · Sohbetler · Panel');
    expect(withNewOrderCount('(2) Yeni sipariş · Sohbetler · Panel', 3)).toBe('(3) Yeni sipariş · Sohbetler · Panel');
    expect(withNewOrderCount('(3) Yeni sipariş · Sohbetler · Panel', 0)).toBe('Sohbetler · Panel');
    expect(withNewOrderCount('Menü · Panel', 0)).toBe('Menü · Panel');
  });

  it('bant bağlantısı canlı ekrandaki karta gider', () => {
    expect(orderAnchorHref('abc')).toBe('/panel#siparis-abc');
  });
});
