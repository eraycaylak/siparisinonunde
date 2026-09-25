'use client';

// Panel sipariş API çağrıları ve sorgu anahtarları (14 §6.3). Tutarları her zaman sunucu hesaplar.

import type { QueryClient } from '@tanstack/react-query';
import type { OrderEventPayload } from '@siparis/core/contracts/events';
import type { OrderSummary } from '@siparis/core/contracts/orders';
import type {
  ActiveOrdersResponse,
  OrderCard,
  OrderCardResponse,
  PanelCancelRequest,
  PanelRejectRequest,
  RejectOrderResponse,
} from '@siparis/core/orders/contracts';
import { apiFetch } from '@/lib/api';
import { RECEIPT_WINDOW_FEATURES, receiptUrl, receiptWindowName } from '@/components/live/receipt-window';

export const ORDERS_ACTIVE_KEY = ['panel', 'orders', 'active'] as const;
export const orderDetailKey = (id: string) => ['panel', 'orders', 'detail', id] as const;
export const ORDERS_LIST_KEY = ['panel', 'orders', 'list'] as const;
export const COURIERS_KEY = ['panel', 'orders', 'couriers'] as const;

const base = (id: string) => `/panel/orders/${id}`;

export const orderActions = {
  ack: (id: string, deviceLabel?: string) => apiFetch<OrderCardResponse>(`${base(id)}/ack`, { method: 'POST', body: deviceLabel ? { deviceLabel } : {} }),
  accept: (id: string, etaMinutes: number, version?: number) =>
    apiFetch<OrderCardResponse>(`${base(id)}/accept`, { method: 'POST', body: { etaMinutes, ...(version ? { version } : {}) } }),
  reject: (id: string, body: PanelRejectRequest) => apiFetch<RejectOrderResponse>(`${base(id)}/reject`, { method: 'POST', body }),
  undoReject: (id: string) => apiFetch<OrderCardResponse>(`${base(id)}/undo-reject`, { method: 'POST', body: {} }),
  advance: (id: string, to: 'preparing' | 'ready' | 'on_the_way' | 'delivered', version?: number) =>
    apiFetch<OrderCardResponse>(`${base(id)}/advance`, { method: 'POST', body: { to, ...(version ? { version } : {}) } }),
  cancel: (id: string, body: PanelCancelRequest) => apiFetch<OrderCardResponse>(`${base(id)}/cancel`, { method: 'POST', body }),
  delay: (id: string, extraMinutes: number) => apiFetch<OrderCardResponse>(`${base(id)}/delay`, { method: 'POST', body: { extraMinutes } }),
  assignCourier: (id: string, userId: string | null, onTheWay = false) =>
    apiFetch<OrderCardResponse>(`${base(id)}/assign-courier`, { method: 'POST', body: { userId, onTheWay } }),
  verify: (id: string) => apiFetch<OrderCardResponse>(`${base(id)}/verify`, { method: 'POST', body: {} }),
  decideCancelRequest: (id: string, reqId: string, approve: boolean) =>
    apiFetch<OrderCardResponse>(`${base(id)}/cancellation-request/${reqId}/decide`, { method: 'POST', body: { approve } }),
};

const FINAL = new Set(['delivered', 'rejected', 'cancelled']);

/** Sunucudan gelen güncel kartı canlı liste önbelleğine yazar (final durumlar Tamamlanan'a geçer). */
export function upsertCard(qc: QueryClient, card: OrderCard): void {
  qc.setQueryData<ActiveOrdersResponse>(ORDERS_ACTIVE_KEY, (prev) => {
    if (!prev) return prev;
    const items = prev.items.filter((c) => c.id !== card.id);
    const completed = prev.completed.filter((c) => c.id !== card.id);
    if (FINAL.has(card.status)) completed.unshift(card);
    else items.push(card);
    return { ...prev, items, completed };
  });
}

/**
 * SSE olayındaki özeti (kalemler yok) mevcut karta işler. Kart yoksa false döner (çağıran listeyi tazeler).
 * Sürümü eski olan olay yok sayılır.
 */
export function applySummary(qc: QueryClient, summary: OrderSummary): boolean {
  let found = false;
  qc.setQueryData<ActiveOrdersResponse>(ORDERS_ACTIVE_KEY, (prev) => {
    if (!prev) return prev;
    const existing = prev.items.find((c) => c.id === summary.id) ?? prev.completed.find((c) => c.id === summary.id);
    if (!existing) return prev;
    found = true;
    if (existing.version > summary.version) return prev;
    const merged: OrderCard = { ...existing, ...summary };
    const items = prev.items.filter((c) => c.id !== summary.id);
    const completed = prev.completed.filter((c) => c.id !== summary.id);
    if (FINAL.has(merged.status)) completed.unshift(merged);
    else items.push(merged);
    return { ...prev, items, completed };
  });
  return found;
}

export function isOrderEventPayload(data: unknown): data is OrderEventPayload {
  return Boolean(data && typeof data === 'object' && 'order' in data && (data as { order?: { id?: unknown } }).order?.id);
}

export type ReceiptKind = 'kitchen' | 'delivery';

/**
 * Fiş yazdırma penceresi (80/58 mm; 04 §4.14). Birden çok tür verilirse tek pencerede art arda basılır
 * (ör. onayda mutfak + paket fişi). Kullanıcı jesti içinde çağrılmalı (açılır pencere engeli).
 */
export function openReceipt(orderId: string, type: ReceiptKind | readonly ReceiptKind[]): void {
  if (typeof window === 'undefined') return;
  const types = (Array.isArray(type) ? type : [type]) as readonly ReceiptKind[];
  if (!types.length) return;
  // Adres, pencere adı ve boyutu onaydaki otomatik fişle aynı (live/receipt-window): yeniden basış aynı pencereyi kullanır
  window.open(receiptUrl(orderId, types), receiptWindowName(orderId, types), RECEIPT_WINDOW_FEATURES);
}

/**
 * Onayda otomatik basılacak fişler (şube fiş ayarı: print_kitchen, print_delivery). Paket (kurye) fişi yalnız
 * paket servis siparişinde basılır.
 */
export function autoPrintKinds(plan: { printKitchen: boolean; printDelivery: boolean } | null | undefined, fulfillmentType: string): ReceiptKind[] {
  const p = plan ?? { printKitchen: true, printDelivery: false };
  const out: ReceiptKind[] = [];
  if (p.printKitchen) out.push('kitchen');
  if (p.printDelivery && fulfillmentType === 'delivery') out.push('delivery');
  return out;
}
