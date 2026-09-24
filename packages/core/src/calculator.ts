// Komisyon hesaplayıcı (01 §6.7 / 05 C.4 birebir). Hesap kuruş hassasiyetinde; N* her zaman yukarı yuvarlanır.
// Paket fiyatı, KDV, rate card ve kur parametre olarak gelir (kodda sabit değil; varsayılanlar yalnız öneri).

import { roundHalfUp } from './money';

export interface CalculatorConfig {
  /** Paket liste fiyatları, KDV hariç, kuruş. */
  planPricesKurus: { esnaf: number; pro: number; zincir: number };
  /** KDV oranı (0,20). */
  vatRate: number;
  /** Sipariş başı mesaj (4 durum + 1 karşılama). */
  messagesPerOrder: number;
  /** Numara başına aylık ücretsiz service mesajı. */
  freeMessagesPerMonth: number;
  /** Service/utility rate card, USD/mesaj. */
  rateUsd: number;
  /** USD/TRY kuru. */
  usdTry: number;
  /** Kurucu üye indirimi oranı (0,30). */
  founderDiscount: number;
}

/** 00 §8 ve 01 §6.7 varsayımları (konfigürasyonla ezilebilir). */
export const DEFAULT_CALCULATOR_CONFIG: CalculatorConfig = {
  planPricesKurus: { esnaf: 99000, pro: 179000, zincir: 299000 },
  vatRate: 0.2,
  messagesPerOrder: 5,
  freeMessagesPerMonth: 1000,
  rateUsd: 0.0009,
  usdTry: 48.4,
  founderDiscount: 0.3,
};

export interface CalculatorInput {
  /** S: günlük pazaryeri siparişi */
  dailyOrders: number;
  /** B: ortalama sepet, kuruş */
  avgBasketKurus: number;
  /** g: aylık gün (varsayılan 30) */
  daysPerMonth?: number;
  /** k: efektif kesinti oranı, KDV hariç (0,25) */
  commissionRate: number;
  /** p: kendi kanala geçiş oranı (0,20) */
  shiftRate: number;
  /** t: doğrudan kanala teşvik, sepetin yüzdesi (0,10) */
  incentiveRate: number;
  /** o: kartla ödenen sipariş payı (0,50) */
  cardShare: number;
  /** c: kart/POS komisyon oranı (0,025) */
  cardFeeRate: number;
  /** K: sipariş başı ek kurye maliyeti, kuruş (yalnız platform kuryesinden geçişte) */
  extraCourierKurus?: number;
  /** U: abonelik (KDV hariç), kuruş */
  subscriptionKurus: number;
  /** false: basit usul — kaçınılan komisyon ve abonelik KDV dahil hesaplanır. */
  vatDeductible?: boolean;
  /** Meta tahminini zorla (verilmezse hesaplanır). */
  metaKurusOverride?: number;
}

export interface CalculatorResult {
  /** C = S × B × g */
  monthlyMarketplaceRevenueKurus: number;
  /** Kes = C × k (KDV hariç, gerçek maliyet) */
  monthlyCommissionKurus: number;
  /** Kes × (1 + KDV) */
  monthlyCashOutKurus: number;
  yearlyCommissionKurus: number;
  yearlyCashOutKurus: number;
  /** N = S × g × p */
  movedOrders: number;
  /** Cp = N × B */
  movedRevenueKurus: number;
  avoidedCommissionKurus: number;
  incentiveCostKurus: number;
  cardCostKurus: number;
  courierCostKurus: number;
  subscriptionCostKurus: number;
  metaEstimateKurus: number;
  netMonthlyKurus: number;
  netYearlyKurus: number;
  /** N*: başa baş sipariş/ay (yukarı yuvarlanmış); payda ≤ 0 ise null */
  breakEvenOrders: number | null;
  /** Ham N* (yuvarlanmamış) */
  breakEvenRaw: number | null;
  /** Günlük karşılık (N* / g) */
  breakEvenPerDay: number | null;
  warnings: CalculatorWarning[];
}

export type CalculatorWarning = 'no_break_even' | 'negative_net';

export const CALCULATOR_WARNING_TEXTS: Record<CalculatorWarning, string> = {
  no_break_even: 'Bu varsayımlarla kendi kanal kendini amorti etmez. Teşviki düşürmeyi dene.',
  negative_net: 'Bu varsayımlarla net kazanç negatif. Teşviki %5’e ya da ücretsiz içeceğe düşür.',
};

/** Meta tahmini (kuruş): max(0, N × m − ücretsiz) × r × kur. */
export function metaEstimateKurus(movedOrders: number, cfg: CalculatorConfig = DEFAULT_CALCULATOR_CONFIG): number {
  const billable = Math.max(0, movedOrders * cfg.messagesPerOrder - cfg.freeMessagesPerMonth);
  return roundHalfUp(billable * cfg.rateUsd * cfg.usdTry * 100);
}

/** Kayan nokta gürültüsüne dayanıklı yukarı yuvarlama. */
function ceilSafe(x: number): number {
  return Math.ceil(x - 1e-9);
}

export function calculateSavings(input: CalculatorInput, cfg: CalculatorConfig = DEFAULT_CALCULATOR_CONFIG): CalculatorResult {
  const g = input.daysPerMonth ?? 30;
  const S = input.dailyOrders;
  const B = input.avgBasketKurus;
  const k = input.commissionRate;
  const p = input.shiftRate;
  const t = input.incentiveRate;
  const o = input.cardShare;
  const c = input.cardFeeRate;
  const K = input.extraCourierKurus ?? 0;
  const vatFactor = input.vatDeductible === false ? 1 + cfg.vatRate : 1;
  const U = roundHalfUp(input.subscriptionKurus * vatFactor);

  const C = roundHalfUp(S * B * g);
  const Kes = roundHalfUp(C * k);
  const cashOut = roundHalfUp(Kes * (1 + cfg.vatRate));

  const N = S * g * p;
  const Cp = roundHalfUp(N * B);
  const avoided = roundHalfUp(Cp * k * vatFactor);
  const incentive = roundHalfUp(Cp * t);
  const card = roundHalfUp(Cp * o * c);
  const courier = roundHalfUp(N * K);
  const M = input.metaKurusOverride ?? metaEstimateKurus(N, cfg);
  const net = avoided - incentive - card - courier - U - M;

  // N* = (U + M) / (B × (k − t − o×c) − K); M önce M=0 ile bulunan N* için hesaplanır, sonra bir kez yeniden.
  const perOrder = B * (k * vatFactor - t - o * c) - K;
  let breakEvenRaw: number | null = null;
  let breakEvenOrders: number | null = null;
  const warnings: CalculatorWarning[] = [];
  if (perOrder <= 0) {
    warnings.push('no_break_even');
  } else {
    const n0 = ceilSafe(U / perOrder);
    const m0 = input.metaKurusOverride ?? metaEstimateKurus(n0, cfg);
    breakEvenRaw = (U + m0) / perOrder;
    breakEvenOrders = ceilSafe(breakEvenRaw);
  }
  if (net < 0) warnings.push('negative_net');

  return {
    monthlyMarketplaceRevenueKurus: C,
    monthlyCommissionKurus: Kes,
    monthlyCashOutKurus: cashOut,
    yearlyCommissionKurus: Kes * 12,
    yearlyCashOutKurus: cashOut * 12,
    movedOrders: N,
    movedRevenueKurus: Cp,
    avoidedCommissionKurus: avoided,
    incentiveCostKurus: incentive,
    cardCostKurus: card,
    courierCostKurus: courier,
    subscriptionCostKurus: U,
    metaEstimateKurus: M,
    netMonthlyKurus: net,
    netYearlyKurus: net * 12,
    breakEvenOrders,
    breakEvenRaw,
    breakEvenPerDay: breakEvenOrders == null ? null : breakEvenOrders / g,
    warnings,
  };
}

/** %10 / %20 / %30 geçiş karşılaştırma şeridi. */
export function compareShiftRates(
  input: CalculatorInput,
  rates: readonly number[] = [0.1, 0.2, 0.3],
  cfg: CalculatorConfig = DEFAULT_CALCULATOR_CONFIG,
): { shiftRate: number; netMonthlyKurus: number }[] {
  return rates.map((r) => ({ shiftRate: r, netMonthlyKurus: calculateSavings({ ...input, shiftRate: r }, cfg).netMonthlyKurus }));
}

export type RecommendedPlan = 'esnaf' | 'pro' | 'zincir' | 'custom';

/** Önerilen paket (05 C.4.3): günlük < 20 → Esnaf; ≥ 20 → Pro; 2+ şube → Zincir; 5+ şube → özel teklif. */
export function recommendPlan(totalDailyOrders: number, branchCount = 1): RecommendedPlan {
  if (branchCount >= 5) return 'custom';
  if (branchCount >= 2) return 'zincir';
  return totalDailyOrders < 20 ? 'esnaf' : 'pro';
}

/** Kurucu üye indirimli fiyat (liste × (1 − oran)). */
export function founderPriceKurus(listKurus: number, cfg: CalculatorConfig = DEFAULT_CALCULATOR_CONFIG): number {
  return roundHalfUp(listKurus * (1 - cfg.founderDiscount));
}

/** 01 §6.7 varsayılan girdileri (B senaryosu). */
export const DEFAULT_CALCULATOR_INPUT: CalculatorInput = {
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
  vatDeductible: true,
};

/** Platform kuryesi seçildiğinde varsayılan K (01 §6.7: 25–45 TL bandından 40 TL). */
export const DEFAULT_PLATFORM_COURIER_KURUS = 4000;
