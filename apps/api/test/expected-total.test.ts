// Tutar bağı (denetim B11 · FAZ 2.2): müşterinin ekranda gördüğü toplam ile sunucunun hesapladığı toplam.
// Veritabanı gerektirmez: services/orders/expected-total.ts saf bir politika işlevidir.
//
// Uçtan uca davranış (POST /store/:slug/orders):
//   - gövdede `expectedTotalKurus` sunucu toplamıyla aynı → sipariş oluşur
//   - farklı → 409 `cart_changed`, HİÇBİR kayıt yazılmaz, yanıt yeni tutarı taşır
//   - üretim derlemesinde alan hiç yoksa → 400 `expected_total_missing`

import { describe, expect, it } from 'vitest';
import { expectedTotalProblem, expectedTotalRequired } from '../src/services/orders/expected-total';

/** Fikstür: 375,00 ₺ ara toplam + 10,00 ₺ teslimat = 385,00 ₺ (checkout.test.ts'teki 38500 ile aynı). */
const TOTALS = { subtotalKurus: 37500, deliveryFeeKurus: 1000, totalKurus: 38500 };

describe('expectedTotalRequired', () => {
  it('yalnız üretim derlemesinde zorunlu (testler ve yerel çalışma bozulmaz)', () => {
    expect(expectedTotalRequired({ NODE_ENV: 'production' })).toBe(true);
    expect(expectedTotalRequired({ NODE_ENV: 'test' })).toBe(false);
    expect(expectedTotalRequired({ NODE_ENV: 'development' })).toBe(false);
  });
});

describe('expectedTotalProblem', () => {
  it('tutar birebir aynıysa sorun yok', () => {
    expect(expectedTotalProblem(38500, TOTALS, { required: true })).toBeNull();
    expect(expectedTotalProblem(38500, TOTALS, { required: false })).toBeNull();
  });

  it('eksik toplam (teslimat ücreti yok) 409 cart_changed döner ve yeni tutarı yazar', () => {
    // Denetimdeki asıl senaryo: /quote hata verdi ya da 400 ms gecikme penceresi — müşteri 375,00 ₺ gördü
    const err = expectedTotalProblem(37500, TOTALS, { required: true });
    expect(err).not.toBeNull();
    expect(err!.statusCode).toBe(409);
    expect(err!.code).toBe('cart_changed');
    expect(err!.message).toContain('385,00 TL');
    expect(err!.details).toMatchObject({
      expectedTotalKurus: 37500,
      totalKurus: 38500,
      subtotalKurus: 37500,
      deliveryFeeKurus: 1000,
      differenceKurus: 1000,
    });
  });

  it('ekranda görülen tutar sunucudan YÜKSEKSE de reddeder (fark negatif)', () => {
    const err = expectedTotalProblem(50000, TOTALS, { required: true });
    expect(err!.code).toBe('cart_changed');
    expect(err!.details).toMatchObject({ differenceKurus: -11500 });
  });

  it('1 kuruşluk fark bile sipariş oluşturmaz', () => {
    expect(expectedTotalProblem(38499, TOTALS, { required: true })!.code).toBe('cart_changed');
  });

  it('alan yoksa: zorunlu değilken geçer, zorunluyken 400 expected_total_missing', () => {
    expect(expectedTotalProblem(undefined, TOTALS, { required: false })).toBeNull();
    const err = expectedTotalProblem(undefined, TOTALS, { required: true });
    expect(err!.statusCode).toBe(400);
    expect(err!.code).toBe('expected_total_missing');
    // Müşteriye ne yapacağını söyler, teknik ayrıntı vermez
    expect(err!.message).toMatch(/yenile/i);
  });

  it('gel-al: teslimat ücreti olmayan toplamla da çalışır', () => {
    const pickup = { subtotalKurus: 37500, deliveryFeeKurus: 0, totalKurus: 37500 };
    expect(expectedTotalProblem(37500, pickup, { required: true })).toBeNull();
    expect(expectedTotalProblem(38500, pickup, { required: true })!.code).toBe('cart_changed');
  });
});
