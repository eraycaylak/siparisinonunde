// Hesaplayıcı formu için uyarlayıcı. Formüller tek kaynaktan: @siparis/core/calculator (01 §6.7, 05 C.4).
// Bu dosya yalnız: TL ↔ kuruş dönüşümü, yapılandırma (lib/plans), "kesinti dökümü" modu ve paylaşım linki.

import {
  CALCULATOR_WARNING_TEXTS,
  calculateSavings as coreCalculate,
  metaEstimateKurus,
  recommendPlan,
  type CalculatorConfig,
  type CalculatorInput as CoreCalculatorInput,
  type CalculatorWarning,
} from '@siparis/core/calculator';
import { tlToKurus } from '@siparis/core/money';
import { META_PRICING, PLANS, VAT_RATE, FOUNDER_DISCOUNT, round2 } from './plans';

export { CALCULATOR_WARNING_TEXTS, type CalculatorWarning };

/** lib/plans'tan türetilen yapılandırma (fiyat/KDV/rate card/kur kodda tek yerde). */
export const CALCULATOR_CONFIG: CalculatorConfig = {
  planPricesKurus: {
    esnaf: tlToKurus(PLANS.find((p) => p.code === 'esnaf')?.monthlyTl ?? 0),
    pro: tlToKurus(PLANS.find((p) => p.code === 'pro')?.monthlyTl ?? 0),
    zincir: tlToKurus(PLANS.find((p) => p.code === 'zincir')?.monthlyTl ?? 0),
  },
  vatRate: VAT_RATE,
  messagesPerOrder: META_PRICING.messagesPerOrder,
  freeMessagesPerMonth: META_PRICING.freeServiceMessagesPerMonth,
  rateUsd: META_PRICING.serviceRateUsd,
  usdTry: META_PRICING.usdTry,
  founderDiscount: FOUNDER_DISCOUNT,
};

export type CourierModel = 'own' | 'platform';

/** Form durumu: oranlar 0–1, tutarlar TL. */
export interface CalculatorInput {
  /** S: günlük pazaryeri siparişi */
  dailyOrders: number;
  /** B: ortalama sepet (TL) */
  avgBasketTl: number;
  /** g: aylık gün */
  daysPerMonth: number;
  /** k: efektif kesinti oranı (KDV hariç) */
  commissionRate: number;
  /** p: kendi kanala geçiş oranı */
  switchRate: number;
  /** t: doğrudan kanal teşviki */
  incentiveRate: number;
  /** o: kartla ödenen sipariş payı */
  cardShare: number;
  /** c: kart/POS komisyon oranı */
  cardFeeRate: number;
  courierModel: CourierModel;
  /** K: sipariş başı ek kurye maliyeti (yalnız platform kuryesinden geçişte) */
  extraCourierCostTl: number;
  /** U: abonelik (KDV hariç, TL) */
  subscriptionTl: number;
  /** "KDV indirebiliyorum" */
  vatDeductible: boolean;
  /** Kesinti dökümü modunda aylık pazaryeri cirosu (S×B×g yerine). */
  monthlyRevenueOverrideTl?: number | null;
}

export interface BreakEven {
  /** N*: yukarı yuvarlanmış sipariş/ay */
  ordersPerMonth: number;
  /** Ham değer, 1 ondalık (ör. 58,4) */
  raw: number;
  /** Günde yaklaşık (1 ondalık) */
  ordersPerDay: number;
}

/** Çıktılar (TL). */
export interface CalculatorResult {
  monthlyRevenue: number;
  monthlyCut: number;
  monthlyCash: number;
  yearlyCut: number;
  yearlyCash: number;
  movedOrders: number;
  movedRevenue: number;
  avoidedCommission: number;
  incentiveCost: number;
  cardCost: number;
  courierCost: number;
  subscription: number;
  metaCost: number;
  net: number;
  yearlyNet: number;
  breakEven: BreakEven | null;
  denominatorNonPositive: boolean;
  warnings: CalculatorWarning[];
}

export const DEFAULT_CALCULATOR_INPUT: CalculatorInput = {
  dailyOrders: 30,
  avgBasketTl: 350,
  daysPerMonth: 30,
  commissionRate: 0.25,
  switchRate: 0.2,
  incentiveRate: 0.1,
  cardShare: 0.5,
  cardFeeRate: 0.025,
  courierModel: 'own',
  extraCourierCostTl: 40,
  subscriptionTl: 1790,
  vatDeductible: true,
  monthlyRevenueOverrideTl: null,
};

const toTl = (kurus: number) => round2(kurus / 100);

function toCoreInput(input: CalculatorInput): CoreCalculatorInput {
  return {
    dailyOrders: Math.max(0, input.dailyOrders),
    avgBasketKurus: tlToKurus(Math.max(0, input.avgBasketTl)),
    daysPerMonth: Math.max(0, input.daysPerMonth),
    commissionRate: input.commissionRate,
    shiftRate: input.switchRate,
    incentiveRate: input.incentiveRate,
    cardShare: input.cardShare,
    cardFeeRate: input.cardFeeRate,
    extraCourierKurus: input.courierModel === 'platform' ? tlToKurus(input.extraCourierCostTl) : 0,
    subscriptionKurus: tlToKurus(input.subscriptionTl),
    vatDeductible: input.vatDeductible,
  };
}

/** Tüm çıktılar (core formülleri; dökümlü modda "bugün" satırları girilen cirodan). */
export function calculateSavings(input: CalculatorInput): CalculatorResult {
  const r = coreCalculate(toCoreInput(input), CALCULATOR_CONFIG);
  let monthlyRevenue = toTl(r.monthlyMarketplaceRevenueKurus);
  let monthlyCut = toTl(r.monthlyCommissionKurus);
  let monthlyCash = toTl(r.monthlyCashOutKurus);
  const override = input.monthlyRevenueOverrideTl;
  if (override && override > 0) {
    monthlyRevenue = round2(override);
    monthlyCut = round2(override * input.commissionRate);
    monthlyCash = round2(monthlyCut * (1 + VAT_RATE));
  }
  const g = Math.max(0, input.daysPerMonth);
  return {
    monthlyRevenue,
    monthlyCut,
    monthlyCash,
    yearlyCut: round2(monthlyCut * 12),
    yearlyCash: round2(monthlyCash * 12),
    movedOrders: round2(r.movedOrders),
    movedRevenue: toTl(r.movedRevenueKurus),
    avoidedCommission: toTl(r.avoidedCommissionKurus),
    incentiveCost: toTl(r.incentiveCostKurus),
    cardCost: toTl(r.cardCostKurus),
    courierCost: toTl(r.courierCostKurus),
    subscription: toTl(r.subscriptionCostKurus),
    metaCost: toTl(r.metaEstimateKurus),
    net: toTl(r.netMonthlyKurus),
    yearlyNet: toTl(r.netYearlyKurus),
    breakEven:
      r.breakEvenOrders != null && r.breakEvenRaw != null
        ? {
            ordersPerMonth: r.breakEvenOrders,
            raw: Math.round(r.breakEvenRaw * 10) / 10,
            ordersPerDay: g > 0 ? Math.round((r.breakEvenOrders / g) * 10) / 10 : 0,
          }
        : null,
    denominatorNonPositive: r.warnings.includes('no_break_even'),
    warnings: r.warnings,
  };
}

/** Meta tahmini (TL). */
export function metaMonthlyCost(movedOrders: number): number {
  return toTl(metaEstimateKurus(movedOrders, CALCULATOR_CONFIG));
}

/** %10 / %20 / %30 geçiş karşılaştırma şeridi. */
export function compareSwitchRates(input: CalculatorInput, rates: readonly number[] = [0.1, 0.2, 0.3]) {
  return rates.map((rate) => ({ rate, net: calculateSavings({ ...input, switchRate: rate }).net }));
}

export interface BreakdownItems {
  commission: number;
  advertising: number;
  campaign: number;
  delivery: number;
  paymentService: number;
  other: number;
}

/** "Kesinti dökümümü gir": k = kalemler toplamı (KDV hariç) ÷ ciro. */
export function commissionRateFromBreakdown(monthlyRevenueTl: number, items: BreakdownItems, amountsIncludeVat: boolean): number {
  if (!(monthlyRevenueTl > 0)) return 0;
  const total = items.commission + items.advertising + items.campaign + items.delivery + items.paymentService + items.other;
  const exVat = amountsIncludeVat ? total / (1 + VAT_RATE) : total;
  return exVat / monthlyRevenueTl;
}

export type PlanSuggestion = ReturnType<typeof recommendPlan>;

/** Önerilen paket: < 20 → Esnaf; ≥ 20 → Pro; 2+ şube → Zincir; 5+ şube → özel teklif. */
export function suggestPlan(totalDailyOrders: number, branches = 1): PlanSuggestion {
  return recommendPlan(totalDailyOrders, branches);
}

// ---------------------------------------------------------------------------
// Paylaşım linki (kişisel veri yok)

const PARAM_MAP: Array<[keyof CalculatorInput, string]> = [
  ['dailyOrders', 's'],
  ['avgBasketTl', 'b'],
  ['daysPerMonth', 'g'],
  ['commissionRate', 'k'],
  ['switchRate', 'p'],
  ['incentiveRate', 't'],
  ['cardShare', 'o'],
  ['cardFeeRate', 'c'],
  ['extraCourierCostTl', 'kk'],
  ['subscriptionTl', 'u'],
];

export function encodeCalculatorInput(input: CalculatorInput): string {
  const sp = new URLSearchParams();
  for (const [key, param] of PARAM_MAP) sp.set(param, String(input[key]));
  sp.set('kur', input.courierModel === 'platform' ? '1' : '0');
  sp.set('kdv', input.vatDeductible ? '1' : '0');
  return sp.toString();
}

export function decodeCalculatorInput(search: string | URLSearchParams, base: CalculatorInput = DEFAULT_CALCULATOR_INPUT): CalculatorInput {
  const sp = typeof search === 'string' ? new URLSearchParams(search) : search;
  const out: CalculatorInput = { ...base };
  for (const [key, param] of PARAM_MAP) {
    const raw = sp.get(param);
    if (raw === null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) (out[key] as number) = n;
  }
  if (sp.get('kur') !== null) out.courierModel = sp.get('kur') === '1' ? 'platform' : 'own';
  if (sp.get('kdv') !== null) out.vatDeductible = sp.get('kdv') !== '0';
  return out;
}

/** Linkte en az bir hesaplayıcı parametresi var mı (noindex / lead için). */
export function hasCalculatorParams(search: string | URLSearchParams): boolean {
  const sp = typeof search === 'string' ? new URLSearchParams(search) : search;
  return PARAM_MAP.some(([, p]) => sp.has(p));
}
