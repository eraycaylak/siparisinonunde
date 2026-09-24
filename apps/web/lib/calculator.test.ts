import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALCULATOR_INPUT,
  calculateSavings,
  commissionRateFromBreakdown,
  compareSwitchRates,
  decodeCalculatorInput,
  encodeCalculatorInput,
  metaMonthlyCost,
  suggestPlan,
  type CalculatorInput,
} from './calculator';

// Referans değerler: 01 §6.7 ve 05 C.4.6 (birebir).
const base: CalculatorInput = { ...DEFAULT_CALCULATOR_INPUT };

describe('hesaplayıcı — 01 §6.7 senaryoları', () => {
  it('A: kendi kuryesi, k=%15, t=%5 → 3.722,5 TL, başa baş 59', () => {
    const r = calculateSavings({ ...base, commissionRate: 0.15, incentiveRate: 0.05 });
    expect(r.net).toBe(3722.5);
    expect(r.breakEven?.ordersPerMonth).toBe(59);
    expect(r.breakEven?.raw).toBe(58.4);
  });

  it('B (varsayılanlar): k=%25, t=%10 → 6.872,5 TL, başa baş 38', () => {
    const r = calculateSavings(base);
    expect(r.monthlyRevenue).toBe(315000);
    expect(r.monthlyCut).toBe(78750);
    expect(r.monthlyCash).toBe(94500);
    expect(r.yearlyCash).toBe(1134000);
    expect(r.movedOrders).toBe(180);
    expect(r.movedRevenue).toBe(63000);
    expect(r.avoidedCommission).toBe(15750);
    expect(r.incentiveCost).toBe(6300);
    expect(r.cardCost).toBe(787.5);
    expect(r.metaCost).toBe(0);
    expect(r.net).toBe(6872.5);
    expect(r.breakEven?.ordersPerMonth).toBe(38);
    expect(r.breakEven?.raw).toBe(37.2);
  });

  it('C: platform kuryesi, k=%35, t=%10, K=40 → 5.972,5 TL, başa baş 42', () => {
    const r = calculateSavings({ ...base, commissionRate: 0.35, courierModel: 'platform', extraCourierCostTl: 40 });
    expect(r.courierCost).toBe(7200);
    expect(r.net).toBe(5972.5);
    expect(r.breakEven?.ordersPerMonth).toBe(42);
    expect(r.breakEven?.raw).toBe(41.5);
  });

  it('kısa referans: k=%25, t=o=K=0 → ayda 21 sipariş', () => {
    const r = calculateSavings({ ...base, incentiveRate: 0, cardShare: 0 });
    expect(r.breakEven?.ordersPerMonth).toBe(21);
    expect(r.breakEven?.raw).toBe(20.5);
  });

  it('k=%15, t=%10 → ayda 103 sipariş; t=%10, k=%25, o=0 → 35', () => {
    expect(calculateSavings({ ...base, commissionRate: 0.15, cardShare: 0 }).breakEven?.ordersPerMonth).toBe(103);
    expect(calculateSavings({ ...base, cardShare: 0 }).breakEven?.ordersPerMonth).toBe(35);
  });
});

describe('hesaplayıcı — kenar durumları', () => {
  it('payda ≤ 0 → başa baş yok', () => {
    const r = calculateSavings({ ...base, commissionRate: 0.1, incentiveRate: 0.1 });
    expect(r.denominatorNonPositive).toBe(true);
    expect(r.breakEven).toBeNull();
  });

  it('net negatif dürüstçe negatif döner', () => {
    const r = calculateSavings({ ...base, dailyOrders: 2 });
    expect(r.net).toBeLessThan(0);
  });

  it('Meta tahmini: 1.000 ücretsiz mesajdan sonrası ücretli', () => {
    expect(metaMonthlyCost(180)).toBe(0);
    // 900 sipariş × 5 = 4.500 → 3.500 ücretli × 0,0009 $ × 48,4
    expect(metaMonthlyCost(900)).toBe(152.46);
  });

  it('KDV indiremiyorsa kaçınılan komisyon ve abonelik KDV dahil', () => {
    const r = calculateSavings({ ...base, vatDeductible: false });
    expect(r.avoidedCommission).toBe(18900);
    expect(r.subscription).toBe(2148);
  });

  it('karşılaştırma şeridi %10/%20/%30', () => {
    const rows = compareSwitchRates(base);
    expect(rows.map((x) => x.rate)).toEqual([0.1, 0.2, 0.3]);
    expect(rows[1]?.net).toBe(6872.5);
  });

  it('kesinti dökümünden oran', () => {
    const k = commissionRateFromBreakdown(
      100000,
      { commission: 20000, advertising: 3000, campaign: 2000, delivery: 0, paymentService: 0, other: 0 },
      false,
    );
    expect(k).toBeCloseTo(0.25);
    const kVat = commissionRateFromBreakdown(
      100000,
      { commission: 24000, advertising: 0, campaign: 0, delivery: 0, paymentService: 0, other: 0 },
      true,
    );
    expect(kVat).toBeCloseTo(0.2);
  });

  it('paket önerisi', () => {
    expect(suggestPlan(19)).toBe('esnaf');
    expect(suggestPlan(20)).toBe('pro');
    expect(suggestPlan(50, 2)).toBe('zincir');
    expect(suggestPlan(50, 5)).toBe('custom');
  });

  it('paylaşım linki gidiş-dönüş', () => {
    const input: CalculatorInput = { ...base, dailyOrders: 42, commissionRate: 0.3, courierModel: 'platform', vatDeductible: false };
    const decoded = decodeCalculatorInput(encodeCalculatorInput(input));
    expect(decoded).toMatchObject({ dailyOrders: 42, commissionRate: 0.3, courierModel: 'platform', vatDeductible: false });
  });
});
