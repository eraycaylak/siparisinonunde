// Paket ve fiyat yapılandırması (00 §8, 01 §6.2–§6.3). Fiyatlar KDV hariç TL.
// Liste fiyatı değişince yalnız bu dosya güncellenir; sayfalar ve hesaplayıcı buradan okur.

import type { PlanCode } from '@siparis/core/enums';

export const VAT_RATE = 0.2;
export const YEARLY_DISCOUNT = 0.2;
export const FOUNDER_DISCOUNT = 0.3;
export const FOUNDER_MONTHS = 12;
export const FOUNDER_SLOTS = 100;
export const TRIAL_DAYS = 14;
export const SETUP_FEE_TL = 1990;

/** Meta (WhatsApp) mesaj tarifesi — konfigürasyon, teyit edilmeli (01 §6.5). */
export const META_PRICING = {
  serviceRateUsd: 0.0009,
  freeServiceMessagesPerMonth: 1000,
  messagesPerOrder: 5,
  usdTry: 48.4,
} as const;

export interface Plan {
  code: PlanCode;
  name: string;
  monthlyTl: number;
  perBranch: boolean;
  audience: string;
  smsQuota: string;
  highlights: string[];
  /** Faz 1'de satışta mı? (Zincir "Yakında") */
  availableNow: boolean;
  recommended?: boolean;
}

export const PLANS: readonly Plan[] = [
  {
    code: 'esnaf',
    name: 'Esnaf',
    monthlyTl: 990,
    perBranch: false,
    audience: 'Günde 5–20 sipariş, tek şube',
    smsQuota: 'Ayda 100 SMS',
    highlights: [
      'WhatsApp sipariş hattı',
      'Fotoğraflı web menü ve QR',
      'Sesli uyarı ve kademeli alarm',
      'Otomatik WhatsApp bildirimleri',
      'Tarayıcıdan fiş yazdırma',
      'En fazla 3 teslimat bölgesi, 2 kullanıcı',
    ],
    availableNow: true,
  },
  {
    code: 'pro',
    name: 'Pro',
    monthlyTl: 1790,
    perBranch: false,
    audience: 'Günde 20–80 sipariş, tek şube',
    smsQuota: 'Ayda 300 SMS',
    highlights: [
      'Esnaf paketinin tümü',
      'Kurye ekranı ve kurye atama',
      'Sınırsız teslimat bölgesi ve kullanıcı',
      'Yakında: online ödeme, AI ile sipariş, kupon ve sadakat, POS entegrasyonu',
    ],
    availableNow: true,
    recommended: true,
  },
  {
    code: 'zincir',
    name: 'Zincir',
    monthlyTl: 2990,
    perBranch: true,
    audience: '2 ve daha fazla şube',
    smsQuota: 'Şube başına ayda 300 SMS',
    highlights: ['Pro paketinin tümü', 'Merkezi menü ve fiyat', 'Şube bazlı raporlar', '5+ şube için özel teklif'],
    availableNow: false,
  },
];

export function getPlan(code: PlanCode): Plan {
  const plan = PLANS.find((p) => p.code === code);
  if (!plan) throw new Error(`Bilinmeyen paket: ${code}`);
  return plan;
}

/** Kuruş hassasiyetinde yuvarlama. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function withVat(amountTl: number): number {
  return round2(amountTl * (1 + VAT_RATE));
}

/** Yıllık peşin toplam (KDV hariç). */
export function yearlyTotal(plan: Plan): number {
  return round2(plan.monthlyTl * 12 * (1 - YEARLY_DISCOUNT));
}

/** Yıllık peşinin aylık karşılığı (KDV hariç). */
export function yearlyMonthly(plan: Plan): number {
  return round2(plan.monthlyTl * (1 - YEARLY_DISCOUNT));
}

/** Kurucu üye aylık fiyatı (bugünkü liste fiyatıyla, KDV hariç). */
export function founderMonthly(plan: Plan): number {
  return round2(plan.monthlyTl * (1 - FOUNDER_DISCOUNT));
}

export type MatrixCell = boolean | string;

export interface MatrixRow {
  label: string;
  esnaf: MatrixCell;
  pro: MatrixCell;
  zincir: MatrixCell;
  /** Ziyaretçiye faz adı söylenmez; gelecek özellik "Yakında" etiketi alır (05 C.3). */
  soon?: boolean;
}

export interface MatrixGroup {
  title: string;
  rows: MatrixRow[];
}

/** Paket içerik matrisi (01 §6.3, öneri). */
export const PLAN_MATRIX: readonly MatrixGroup[] = [
  {
    title: 'Sipariş kanalları',
    rows: [
      { label: 'WhatsApp sipariş hattı (resmi altyapı; mevcut numaran ya da yeni numara)', esnaf: true, pro: true, zincir: 'Şube başı numara' },
      { label: 'Fotoğraflı web menü, seçenekler ve sepet', esnaf: true, pro: true, zincir: true },
      { label: 'WhatsApp sohbetinden menü linkiyle sipariş, doğrudan web siparişi, telefon siparişi girişi', esnaf: true, pro: true, zincir: true },
      { label: 'WhatsApp’sız mod: SMS koduyla sipariş doğrulama', esnaf: true, pro: true, zincir: true },
      { label: '“Son siparişin” kartıyla aynısından tekrar', esnaf: true, pro: true, zincir: true },
      { label: 'Sohbet içinde tek dokunuşla tekrar sipariş', esnaf: true, pro: true, zincir: true, soon: true },
      { label: 'Yazılı mesajdan AI ile sipariş (adil kullanım)', esnaf: false, pro: true, zincir: true, soon: true },
      { label: 'Masa QR ile sipariş', esnaf: false, pro: true, zincir: true, soon: true },
    ],
  },
  {
    title: 'Operasyon',
    rows: [
      { label: 'Canlı sipariş ekranı, sesli uyarı ve kademeli alarm', esnaf: true, pro: true, zincir: true },
      { label: 'Otomatik WhatsApp durum bildirimleri ve takip sayfası', esnaf: true, pro: true, zincir: true },
      { label: 'WhatsApp gelen kutusu: görme, yanıtlama, bot/insan modu', esnaf: true, pro: true, zincir: true },
      { label: 'SMS doğrulama ve kritik durum SMS’leri (adil kullanım)', esnaf: 'Ayda 100', pro: 'Ayda 300', zincir: 'Şube başına 300' },
      { label: 'Teslimat bölgeleri (min. sepet, ücret, tahmini süre)', esnaf: 'En fazla 3', pro: 'Sınırsız', zincir: 'Sınırsız' },
      { label: 'Kapıda ödeme (nakit, kart, yemek kartı), gel-alda kasada', esnaf: true, pro: true, zincir: true },
      { label: 'Tarayıcıdan fiş yazdırma', esnaf: true, pro: true, zincir: true },
      { label: 'Kurye ekranı (uygulama indirmeden) ve kurye atama', esnaf: false, pro: true, zincir: true },
      { label: 'Otomatik mutfak ve kasa fişi', esnaf: false, pro: true, zincir: true, soon: true },
      { label: 'Online kartla ödeme (kendi ödeme kuruluşu hesabınla)', esnaf: false, pro: true, zincir: true, soon: true },
      { label: 'POS entegrasyonu (SambaPOS, Adisyo)', esnaf: false, pro: true, zincir: true, soon: true },
    ],
  },
  {
    title: 'Müşteri ve pazarlama',
    rows: [
      { label: 'Müşteri listesi: sipariş geçmişi, adresler, not', esnaf: true, pro: true, zincir: true },
      { label: 'QR stand, paket kartı ve magnet şablonları', esnaf: true, pro: true, zincir: true },
      { label: 'Kupon ve sadakat (damga kartı)', esnaf: false, pro: true, zincir: true, soon: true },
      { label: 'İzinli müşterilere kampanya (maliyet önizlemeli)', esnaf: false, pro: true, zincir: true, soon: true },
    ],
  },
  {
    title: 'Yönetim ve raporlar',
    rows: [
      { label: 'Kullanıcılar ve roller', esnaf: '2 kullanıcı', pro: 'Sınırsız, tüm roller', zincir: 'Sınırsız, tüm roller' },
      { label: 'Gün sonu, kanal karması, tahmini tasarruf, Meta’ya tahmini ödeme', esnaf: true, pro: true, zincir: true },
      { label: 'Gelişmiş raporlar (ürün, saat, müşteri)', esnaf: false, pro: true, zincir: true, soon: true },
      { label: 'Çoklu şube: merkezi menü ve şube raporları', esnaf: false, pro: false, zincir: true, soon: true },
    ],
  },
  {
    title: 'Destek',
    rows: [
      {
        label: 'Destek',
        esnaf: 'Panel içi yardım + WhatsApp destek hattı',
        pro: '+ akşam yoğun saatlerinde canlı destek',
        zincir: '+ öncelikli yanıt, hesap sorumlusu',
      },
    ],
  },
];
