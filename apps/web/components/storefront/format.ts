// Storefront metin yardımcıları: sipariş alma durumu, teslimat özeti, Türkçe saat ekleri (03 §4.1, §4.7, §5.4).

import { formatNextOpenTR } from '@siparis/core/hours';
import { etaRange } from '@siparis/core/pricing';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { formatMoney, formatTime } from '@/lib/format';

const LAST_WORD_SUFFIX: Record<number, string> = {
  0: 'da', // sıfır
  1: 'de', // bir
  2: 'de', // iki
  3: 'te', // üç
  4: 'te', // dört
  5: 'te', // beş
  6: 'da', // altı
  7: 'de', // yedi
  8: 'de', // sekiz
  9: 'da', // dokuz
  10: 'da', // on
  20: 'de', // yirmi
  30: 'da', // otuz
  40: 'ta', // kırk
  50: 'de', // elli
};

/** Saat için bulunma eki: "10.00" → "'da", "11.00" → "'de", "13.30" → "'da", "14.00" → "'te". */
export function clockLocative(clock: string): string {
  const m = /(\d{1,2})[.:](\d{2})$/.exec(clock.trim());
  if (!m) return "'de";
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const n = mm === 0 ? hh : mm;
  const ones = n % 10;
  const key = n === 0 ? 0 : ones !== 0 ? ones : n;
  return `'${LAST_WORD_SUFFIX[key] ?? 'de'}`;
}

export type OrderingTone = 'open' | 'busy' | 'closed';

export interface OrderingStatusText {
  tone: OrderingTone;
  /** Kısa rozet: "Açık", "Yoğun (+15 dk)", "Kapalı", "Şu an sipariş almıyoruz". */
  label: string;
  /** Ek bilgi: "Kapanış 23.30", "Yarın 10.00'da açılıyor". */
  detail: string | null;
  /** Bant metni (yoğun/kapalı/durduruldu); açıkken null. */
  band: string | null;
  acceptsOrders: boolean;
}

/** 03 §4.7 S-09 varyantları. */
export function orderingStatus(store: StorefrontView, now: Date = new Date()): OrderingStatusText {
  const b = store.branch;
  const prepPlusBusy = (b.prepMinutes ?? 20) + (b.busyExtraMinutes ?? 0);
  if (store.orderingEnabled === false) {
    return {
      tone: 'closed',
      label: 'Şu an online sipariş alınmıyor',
      detail: null,
      band: 'Şu an online sipariş alınmıyor. Sipariş için lütfen işletmeyi arayın.',
      acceptsOrders: false,
    };
  }
  switch (b.orderingState) {
    case 'open':
      return { tone: 'open', label: 'Açık', detail: closingText(b.closesAt, now), band: null, acceptsOrders: true };
    case 'busy': {
      const extra = b.busyExtraMinutes ?? 0;
      const eta = deliveryEtaText(store);
      return {
        tone: 'busy',
        label: extra > 0 ? `Yoğun (+${extra} dk)` : 'Yoğun',
        detail: closingText(b.closesAt, now),
        band: eta ? `Yoğunuz · Tahmini ${eta}` : `Yoğunuz · Tahminen ${prepPlusBusy} dk'da hazır`,
        acceptsOrders: true,
      };
    }
    case 'paused': {
      const next = b.nextOpenAt ? nextOpenText(b.nextOpenAt, now) : null;
      return {
        tone: 'closed',
        label: 'Şu an sipariş almıyoruz',
        detail: next,
        band: next ? `Kısa süreliğine sipariş almıyoruz · ${next}` : 'Kısa süreliğine sipariş almıyoruz.',
        acceptsOrders: false,
      };
    }
    default: {
      const next = b.nextOpenAt ? nextOpenText(b.nextOpenAt, now) : null;
      return {
        tone: 'closed',
        label: 'Kapalı',
        detail: next,
        band: next ? `Şu an kapalıyız · ${next}` : 'Şu an kapalıyız.',
        acceptsOrders: false,
      };
    }
  }
}

/** "Kapanış 23.30" — yalnız 24 saat içinde kapanıyorsa (7/24 açıkta gösterilmez). */
function closingText(closesAt: string | null | undefined, now: Date): string | null {
  if (!closesAt) return null;
  const at = new Date(closesAt);
  return at.getTime() - now.getTime() < 24 * 3600_000 ? `Kapanış ${formatTime(at)}` : null;
}

/** "Yarın 10.00'da açılıyor" (saat eki doğru ünlü uyumuyla). */
export function nextOpenText(iso: string, now: Date = new Date()): string {
  const text = formatNextOpenTR(new Date(iso), now);
  return `${text}${clockLocative(text)} açılıyor`;
}

/** Paket servis süre aralığı (tüm bölgeler, hazırlık + yoğun ek süre dahil): "30–50 dk"; paket yoksa null. */
export function deliveryEtaText(store: StorefrontView): string | null {
  const b = store.branch;
  if (!b.acceptsDelivery || !store.zones.length) return null;
  const busy = b.busyExtraMinutes ?? 0;
  const etas = store.zones.map((z) => z.etaMinutes);
  const lo = etaRange({ zoneEtaMinutes: Math.min(...etas), prepMinutes: b.prepMinutes, busyExtraMinutes: busy }).minMinutes;
  const hi = etaRange({ zoneEtaMinutes: Math.max(...etas), prepMinutes: b.prepMinutes, busyExtraMinutes: busy }).maxMinutes;
  return `${lo}–${hi} dk`;
}

export interface SummaryItem {
  kind: 'eta' | 'fee' | 'min' | 'pickup';
  text: string;
}

/** S-01 teslimat özeti (03 §5.4, adres seçilmemiş): "30–40 dk", "Teslimat 0–25 TL", "Min. sepet 150 TL'den", gel-al. */
export function deliverySummary(store: StorefrontView): SummaryItem[] {
  const b = store.branch;
  const out: SummaryItem[] = [];
  const busy = b.busyExtraMinutes ?? 0;
  const eta = deliveryEtaText(store);
  if (eta) {
    out.push({ kind: 'eta', text: eta });
    const range = deliveryFeeRange(store);
    if (range) out.push({ kind: 'fee', text: range === 'ücretsiz' ? 'Teslimat ücretsiz' : `Teslimat ${range}` });
    const mins = store.zones.map((z) => z.minOrderKurus).filter((m) => m > 0);
    if (mins.length) out.push({ kind: 'min', text: `Min. sepet ${formatMoney(Math.min(...mins), 'short')}'den` });
  }
  if (b.acceptsPickup) {
    out.push({ kind: 'pickup', text: `Gel-al · ${(b.prepMinutes ?? 20) + busy} dk'da hazır` });
  }
  return out;
}

/** Paket servis için en düşük minimum sepet (kuruş); paket servis yoksa 0. Sepet ipucu için. */
export function deliveryMinOrderKurus(store: StorefrontView): number {
  if (!store.branch.acceptsDelivery || !store.zones.length) return 0;
  return Math.min(...store.zones.map((z) => z.minOrderKurus));
}

/** Tüm bölgelerin teslimat ücreti aralığı: "0–25 TL" / "20 TL" / null. */
export function deliveryFeeRange(store: StorefrontView): string | null {
  if (!store.branch.acceptsDelivery || !store.zones.length) return null;
  const fees = store.zones.map((z) => z.feeKurus);
  const fMin = Math.min(...fees);
  const fMax = Math.max(...fees);
  if (fMin === fMax) return fMax === 0 ? 'ücretsiz' : formatMoney(fMax, 'short');
  return `${formatMoney(fMin, 'short').replace(/\s?TL$/, '')}–${formatMoney(fMax, 'short')}`;
}

/** Fiyat farkı: "+25,00 TL" / "−40,00 TL". */
export function formatDelta(kurus: number): string {
  if (kurus === 0) return '';
  return `${kurus > 0 ? '+' : '−'}${formatMoney(Math.abs(kurus))}`;
}
