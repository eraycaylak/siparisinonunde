import { describe, expect, it } from 'vitest';
import { founderMonthly, getPlan, withVat, yearlyMonthly, yearlyTotal } from './plans';

// 00 §8 ve 05 C.3.3 tablosu.
describe('paket fiyatları', () => {
  it('Esnaf', () => {
    const p = getPlan('esnaf');
    expect(withVat(p.monthlyTl)).toBe(1188);
    expect(yearlyTotal(p)).toBe(9504);
    expect(withVat(yearlyTotal(p))).toBe(11404.8);
    expect(yearlyMonthly(p)).toBe(792);
    expect(founderMonthly(p)).toBe(693);
    expect(withVat(founderMonthly(p))).toBe(831.6);
  });
  it('Pro', () => {
    const p = getPlan('pro');
    expect(withVat(p.monthlyTl)).toBe(2148);
    expect(yearlyTotal(p)).toBe(17184);
    expect(withVat(yearlyTotal(p))).toBe(20620.8);
    expect(yearlyMonthly(p)).toBe(1432);
    expect(founderMonthly(p)).toBe(1253);
    expect(withVat(founderMonthly(p))).toBe(1503.6);
  });
  it('Zincir', () => {
    const p = getPlan('zincir');
    expect(withVat(p.monthlyTl)).toBe(3588);
    expect(yearlyTotal(p)).toBe(28704);
    expect(withVat(yearlyTotal(p))).toBe(34444.8);
    expect(yearlyMonthly(p)).toBe(2392);
    expect(founderMonthly(p)).toBe(2093);
    expect(withVat(founderMonthly(p))).toBe(2511.6);
  });
});
