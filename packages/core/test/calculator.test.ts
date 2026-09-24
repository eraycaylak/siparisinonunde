import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALCULATOR_INPUT,
  calculateSavings,
  compareShiftRates,
  founderPriceKurus,
  metaEstimateKurus,
  recommendPlan,
  type CalculatorInput,
} from '../src/calculator';

const base: CalculatorInput = {
  dailyOrders: 30,
  avgBasketKurus: 35000,
  daysPerMonth: 30,
  commissionRate: 0.25,
  shiftRate: 0.2,
  incentiveRate: 0.1,
  cardShare: 0.5,
  cardFeeRate: 0.025,
  extraCourierKurus: 0,
  subscriptionKurus: 179000,
};

describe('komisyon hesaplayıcı (01 §6.7 referans değerleri)', () => {
  it('A: k=%15, t=%5 → net 3.722,5 TL, başa baş 59', () => {
    const r = calculateSavings({ ...base, commissionRate: 0.15, incentiveRate: 0.05 });
    expect(r.netMonthlyKurus).toBe(372250);
    expect(r.breakEvenOrders).toBe(59);
    expect(r.breakEvenRaw).toBeCloseTo(58.45, 1);
  });

  it('B: k=%25, t=%10 → net 6.872,5 TL, başa baş 38', () => {
    const r = calculateSavings(base);
    expect(r.netMonthlyKurus).toBe(687250);
    expect(r.breakEvenOrders).toBe(38);
    expect(r.monthlyMarketplaceRevenueKurus).toBe(31500000);
    expect(r.monthlyCommissionKurus).toBe(7875000);
    expect(r.monthlyCashOutKurus).toBe(9450000);
    expect(r.movedOrders).toBe(180);
    expect(r.movedRevenueKurus).toBe(6300000);
    expect(r.avoidedCommissionKurus).toBe(1575000);
    expect(r.incentiveCostKurus).toBe(630000);
    expect(r.cardCostKurus).toBe(78750);
    expect(r.metaEstimateKurus).toBe(0);
  });

  it('C: k=%35, t=%10, K=40 TL → net 5.972,5 TL, başa baş 42', () => {
    const r = calculateSavings({ ...base, commissionRate: 0.35, extraCourierKurus: 4000 });
    expect(r.netMonthlyKurus).toBe(597250);
    expect(r.courierCostKurus).toBe(720000);
    expect(r.breakEvenOrders).toBe(42);
  });

  it('kısa referans: k=%25, t=o=K=0 → 21', () => {
    const r = calculateSavings({ ...base, incentiveRate: 0, cardShare: 0, extraCourierKurus: 0 });
    expect(r.breakEvenOrders).toBe(21);
    expect(calculateSavings({ ...base, incentiveRate: 0.1, cardShare: 0 }).breakEvenOrders).toBe(35);
    expect(calculateSavings({ ...base, commissionRate: 0.15, incentiveRate: 0.1, cardShare: 0 }).breakEvenOrders).toBe(103);
  });

  it('varsayılan girdi B senaryosunu üretir', () => {
    expect(calculateSavings(DEFAULT_CALCULATOR_INPUT).netMonthlyKurus).toBe(687250);
  });

  it('payda ≤ 0 → başa baş yok + uyarı; negatif net uyarısı', () => {
    const r = calculateSavings({ ...base, commissionRate: 0.1, incentiveRate: 0.1 });
    expect(r.breakEvenOrders).toBeNull();
    expect(r.warnings).toContain('no_break_even');
    expect(r.warnings).toContain('negative_net');
    expect(r.netMonthlyKurus).toBeLessThan(0);
  });

  it('Meta tahmini ücretsiz kotayı aşınca', () => {
    expect(metaEstimateKurus(180)).toBe(0);
    // 300 × 5 − 1000 = 500 mesaj × 0,0009 $ × 48,4 = 21,78 TL
    expect(metaEstimateKurus(300)).toBe(2178);
  });

  it('karşılaştırma şeridi, paket önerisi, kurucu fiyatı', () => {
    const strip = compareShiftRates(base);
    expect(strip.map((s) => s.shiftRate)).toEqual([0.1, 0.2, 0.3]);
    expect(strip[1]!.netMonthlyKurus).toBe(687250);
    expect(recommendPlan(10)).toBe('esnaf');
    expect(recommendPlan(20)).toBe('pro');
    expect(recommendPlan(50, 2)).toBe('zincir');
    expect(recommendPlan(50, 5)).toBe('custom');
    expect(founderPriceKurus(179000)).toBe(125300);
  });
});
