// Tasarruf raporu oran aritmetiği (denetim "Para" maddesi · docs/04 §11.3 · FAZ 2.5). Veritabanı gerektirmez.
//
// Kapı: oran işletmece girilmemişse rapor TUTAR GÖSTERMEZ. Eski davranış girilmemiş oran yerine kolonun
// varsayılanını (%25) kullanıp somut TL yazıyordu; 04 §11.3 bunu açıkça yasaklıyor ("Girilmezse kart
// 'Oranınızı girin' der; varsayılan uydurulmaz").

import { describe, expect, it } from 'vitest';
import {
  COMMISSION_NOT_ENTERED_BP,
  avoidedCommissionKurus,
  resolveCommissionBp,
  withVatKurus,
} from '../src/services/reports/savings-rate';

describe('resolveCommissionBp', () => {
  it('girilmiş oranı baz puan olarak döndürür', () => {
    expect(resolveCommissionBp(2500)).toBe(2500);
    expect(resolveCommissionBp(1)).toBe(1);
    expect(resolveCommissionBp(6000)).toBe(6000);
  });

  it('girilmemiş oranı null yapar: null, 0 ve negatif', () => {
    expect(resolveCommissionBp(null)).toBeNull();
    expect(resolveCommissionBp(undefined)).toBeNull();
    expect(resolveCommissionBp(COMMISSION_NOT_ENTERED_BP)).toBeNull();
    expect(resolveCommissionBp(-100)).toBeNull();
  });

  it('sayı olmayan değere varsayılan uydurmaz', () => {
    expect(resolveCommissionBp(Number.NaN)).toBeNull();
    expect(resolveCommissionBp(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('üst sınırı sessizce kırpmaz: saklanan oran raporda olduğu gibi görünür', () => {
    expect(resolveCommissionBp(9000)).toBe(9000);
  });
});

describe('avoidedCommissionKurus', () => {
  it('sepet × oran, kuruş tamsayısı (yarım yukarı)', () => {
    expect(avoidedCommissionKurus(140_000, 2500)).toBe(35_000);
    // 63.000 TL × %25 = 15.750 TL (04 §11.3 örneği)
    expect(avoidedCommissionKurus(6_300_000, 2500)).toBe(1_575_000);
    // 1 kuruşun yarısı yukarı yuvarlanır: 1 × %5 = 0,05 kuruş → 0; 10 × %5 = 0,5 → 1
    expect(avoidedCommissionKurus(10, 500)).toBe(1);
  });

  it('oran yoksa 0 değil null döner ("bilinmiyor" ile "tasarruf yok" aynı şey değil)', () => {
    expect(avoidedCommissionKurus(140_000, null)).toBeNull();
  });

  it('negatif sepet toplamına izin vermez', () => {
    expect(avoidedCommissionKurus(-500, 2500)).toBe(0);
  });
});

describe('withVatKurus', () => {
  it('KDV dahil nakit etkisi (×1,20) ve null geçirgenliği', () => {
    expect(withVatKurus(35_000)).toBe(42_000);
    expect(withVatKurus(1)).toBe(1);
    expect(withVatKurus(null)).toBeNull();
  });
});
