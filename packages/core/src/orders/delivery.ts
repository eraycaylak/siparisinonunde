// Kurye teslim akışı kuralları (04 §9.2): kapıda tahsil edilebilen ödeme yöntemleri ve "teslim edilemedi"
// sebepleri. Saf fonksiyonlar; sunucu (doğrulama) ve kurye ekranı (seçenek listesi) aynı kaynaktan beslenir.
// Not: sebep listesi enums.ts'e değil buraya yazılır — kurye dilimine aittir ve DB CHECK'i buradan üretilir.

import { z } from 'zod';
import { COURIER_COLLECTED_PAYMENT_METHODS, type CourierCollectedPaymentMethod, type FulfillmentType, type PaymentMethod } from '../enums';

/** "Teslim edilemedi" sebepleri (04 §9.2 sebep çipleri; `other` → açıklama zorunlu, 12 §UI-03). */
export const DELIVERY_FAILURE_REASONS = [
  'customer_absent',
  'customer_unreachable',
  'address_not_found',
  'customer_refused',
  'other',
] as const;
export type DeliveryFailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];
export const deliveryFailureReasonSchema = z.enum(DELIVERY_FAILURE_REASONS);
export const DELIVERY_FAILURE_REASON_LABELS: Record<DeliveryFailureReason, string> = {
  customer_absent: 'Müşteri kapıyı açmadı',
  customer_unreachable: 'Telefonla ulaşılamadı',
  address_not_found: 'Adres bulunamadı',
  customer_refused: 'Müşteri almadı',
  other: 'Diğer',
};

/** `other` sebebinde açıklama zorunlu; not en çok 140 karakter (müşteri notuyla aynı sınır). */
export const DELIVERY_FAILURE_NOTE_MAX = 140;

export function deliveryFailureNoteRequired(reason: DeliveryFailureReason, note?: string | null): boolean {
  return reason === 'other' && !note?.trim();
}

/**
 * Kuryenin teslimde seçebileceği ödeme yöntemleri: şubede AÇIK **ve** kapıda tahsil edilebilen yöntemler
 * (00 §5 `payment_methods`; 04 §9.2). `online_card` müşteri tarafından önceden ödenir, `pay_at_counter`
 * kasada ödenir: ikisi de kuryeye seçtirilmez. Gel-al/masada siparişte kurye tahsilatı yoktur → boş liste.
 * `orderPaymentMethod` verilirse siparişin kendi yöntemi de sınanır: önceden/kasada ödenmiş siparişin yöntemi
 * kapıda değiştirilemez (`/delivered` 422 `payment_method_locked`), ekran da alternatif önermemeli → boş liste.
 */
export function courierPaymentMethods(input: {
  branchPaymentMethods: readonly (PaymentMethod | string)[];
  fulfillmentType: FulfillmentType | string;
  orderPaymentMethod?: PaymentMethod | string | null;
}): CourierCollectedPaymentMethod[] {
  if (input.fulfillmentType !== 'delivery') return [];
  if (input.orderPaymentMethod != null && !courierCanChangePayment(input.orderPaymentMethod)) return [];
  const open = new Set(input.branchPaymentMethods);
  return COURIER_COLLECTED_PAYMENT_METHODS.filter((m) => open.has(m));
}

/** Sipariş hangi yöntemle ödendiyse kurye onu kapıda değiştirebilir mi (online/kasada ödemede hayır). */
export function courierCanChangePayment(orderPaymentMethod: PaymentMethod | string): boolean {
  return (COURIER_COLLECTED_PAYMENT_METHODS as readonly string[]).includes(orderPaymentMethod);
}
