// Yeni sipariş alarmının saf kuralları (04 §4.5): hangi sipariş çalar, bant hangi siparişi gösterir, ses ne zaman
// yükselir, sekme başlığındaki sayaç. Panel kabuğundaki genel alarm ve canlı ekran aynı kuralları kullanır.

import type { OrderCard } from '@siparis/core/orders/contracts';

/** Bu süre dolunca döngüsel ses yükselir (00 §10: t + 60 sn). */
export const ALARM_ESCALATE_MS = 60_000;

export type AlarmCard = Pick<OrderCard, 'id' | 'number' | 'status' | 'channel' | 'rejectionScheduledAt' | 'testKind' | 'verifiedAt' | 'placedAt' | 'alarmStep'>;

/** Açık `new` siparişler (kanarya hariç). */
export function newOrdersOf<T extends AlarmCard>(items: readonly T[]): T[] {
  return items.filter((c) => c.status === 'new' && c.testKind !== 'canary');
}

/**
 * Bantta gösterilen yeni siparişler: ret geri sayımındakiler ve telefon siparişleri (kasiyer kendisi girdi) hariç.
 * Mutfak onay vermediği için bant ve alarm görmez.
 */
export function bandOrdersOf<T extends AlarmCard>(items: readonly T[], kitchen: boolean): T[] {
  if (kitchen) return [];
  return newOrdersOf(items).filter((c) => !c.rejectionScheduledAt && c.channel !== 'manual');
}

/** Döngüsel sesi çalan siparişler: bant siparişlerinden "Gördüm" ile susturulmamış olanlar. */
export function alarmingOrdersOf<T extends AlarmCard>(items: readonly T[], silenced: ReadonlySet<string>, kitchen: boolean): T[] {
  return bandOrdersOf(items, kitchen).filter((c) => !silenced.has(c.id));
}

/** Yükselen ses: sunucu alarmı 2. adıma geçtiyse ya da sipariş 60 sn'dir bekliyorsa. */
export function isHighLevel(alarming: readonly AlarmCard[], escalated: ReadonlySet<string>, now: number): boolean {
  return alarming.some(
    (c) => escalated.has(c.id) || (c.alarmStep ?? 0) >= 2 || now - new Date(c.verifiedAt ?? c.placedAt).getTime() >= ALARM_ESCALATE_MS,
  );
}

const TITLE_PREFIX_RE = /^\(\d+\) Yeni sipariş · /;

/** Sekme başlığına "(2) Yeni sipariş · " ön eki koyar ya da kaldırır; sayfanın kendi başlığı korunur. */
export function withNewOrderCount(title: string, count: number): string {
  const base = title.replace(TITLE_PREFIX_RE, '');
  return count > 0 ? `(${count}) Yeni sipariş · ${base}` : base;
}

/** Bant bağlantısı: canlı ekrandaki ilgili kart (başka ekrandan da oraya götürür). */
export function orderAnchorHref(orderId: string): string {
  return `/panel#siparis-${orderId}`;
}
