// Yeni siparişin ekran okuyucuya söylenen hâli (12 §11.1 ölçüt 4.1.3, WCAG 2.2 AA).
//
// Neden ayrı bir metin: banttaki görsel yazı "YENİ SİPARİŞ #1052 · 285,00 TL" ekran okuyucuda "diyez 1052" gibi
// okunur, ürün adedini ve teslim türünü hiç söylemez. Bant zaten `role="alert"` (components/ui/banner.tsx) olduğu
// için İKİNCİ bir canlı bölge eklenmez — duyuru iki kez okunurdu. Bunun yerine bandın içindeki görsel yazı
// `aria-hidden`, yanına da bu cümle `sr-only` olarak konur: tek canlı bölge, tam cümle.

import type { OrderCard } from '@siparis/core/orders/contracts';
import { FULFILLMENT_TYPE_LABELS } from '@/lib/labels';
import { formatMoney } from '@/lib/format';

export type AnnounceCard = Pick<OrderCard, 'id' | 'number' | 'itemCount' | 'totalKurus' | 'fulfillmentType'>;

/** Tek siparişin okunuşu: "1052 numaralı sipariş, 3 ürün, 285,00 TL, paket servis". */
function describe(card: AnnounceCard): string {
  const parts = [`${card.number} numaralı sipariş`, `${card.itemCount} ürün`];
  // Mutfak projeksiyonunda tutar yoktur (CLAUDE.md kural: kitchen fiyat görmez) → cümleye hiç girmez.
  if (card.totalKurus != null) parts.push(formatMoney(card.totalKurus));
  parts.push(FULFILLMENT_TYPE_LABELS[card.fulfillmentType].toLocaleLowerCase('tr-TR'));
  return parts.join(', ');
}

/**
 * Bantta duyurulacak cümle. Boş listede boş metin döner (canlı bölge temizlenir).
 * Tek sipariş tam okunur; birden fazlada en yenisi okunur ve kalanın sayısı söylenir (ekran okuyucu uzun listede
 * kullanıcıyı kilitlemesin).
 */
export function newOrderAnnouncement(cards: readonly AnnounceCard[]): string {
  const [first, ...rest] = cards;
  if (!first) return '';
  const head = `Yeni sipariş: ${describe(first)}.`;
  if (rest.length === 0) return head;
  return `${head} Onay bekleyen ${rest.length} sipariş daha var.`;
}
