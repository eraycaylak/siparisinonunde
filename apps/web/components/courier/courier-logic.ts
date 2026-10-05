// Kurye ekranı saf mantığı (04 §9.2): teslimde seçilebilen ödeme yöntemleri, 5 sn "Geri al" penceresi ve
// "teslim edilemedi" metinleri. Ekrandan ayrı tutulur ki birim testi olsun (apps/web test kuralı).

import type { CourierOrder } from '@siparis/core/orders/contracts';
import { COURIER_COLLECTED_PAYMENT_METHODS, type CourierCollectedPaymentMethod, type MealCardBrand } from '@siparis/core/enums';
import { DELIVERY_FAILURE_REASON_LABELS, type DeliveryFailureReason } from '@siparis/core/orders/delivery';

/** Durum geçişlerindeki "Geri al" penceresi (04 §4.8 ile aynı): 5 sn. */
export const DELIVER_UNDO_MS = 5_000;

export type DeliverMode = 'as_ordered' | CourierCollectedPaymentMethod;

/** "Farklı yöntemle" seçeneklerinin kısa etiketleri (büyük buton metni, UI-03). */
const OTHER_METHOD_LABELS: Record<CourierCollectedPaymentMethod, string> = {
  cash_on_delivery: 'Farklı yöntemle: nakit',
  card_on_delivery: 'Farklı yöntemle: kart',
  meal_card_on_delivery: 'Farklı yöntemle: yemek kartı',
};

export type CourierPaymentFields = Pick<CourierOrder, 'paymentMethod' | 'allowedPaymentMethods'>;

/**
 * Teslim alt sayfasındaki seçenekler: siparişteki yöntem ("olduğu gibi") + sunucunun izin verdiği diğer
 * yöntemler. Liste sunucudan gelir (şubede açık + kapıda tahsil edilebilen): ekranda kapalı bir yöntem
 * önerilmez, kurye uçta 422 yemez.
 */
export function deliverOptions(order: CourierPaymentFields): { value: DeliverMode; label: string }[] {
  const others = COURIER_COLLECTED_PAYMENT_METHODS.filter(
    (m) => m !== order.paymentMethod && order.allowedPaymentMethods.includes(m),
  );
  return others.map((m) => ({ value: m as DeliverMode, label: OTHER_METHOD_LABELS[m] }));
}

/** Yemek kartı seçildiyse marka zorunlu (sunucu da zorunlu tutar). */
export function deliverReady(mode: DeliverMode, brand: MealCardBrand | ''): boolean {
  return mode !== 'meal_card_on_delivery' || brand !== '';
}

/** POST /courier/orders/:id/delivered gövdesi. */
export function deliverBody(mode: DeliverMode, brand: MealCardBrand | ''): Record<string, string> {
  if (mode === 'as_ordered') return {};
  return { paidWith: mode, ...(mode === 'meal_card_on_delivery' && brand ? { mealCardBrand: brand } : {}) };
}

/** "Teslim edilemedi" bildirilebilir mi: yalnız yolda olan paket siparişi (sunucu da aynı kapıyı uygular). */
export function canReportUndeliverable(order: Pick<CourierOrder, 'status' | 'fulfillmentType'>): boolean {
  return order.fulfillmentType === 'delivery' && order.status === 'on_the_way';
}

/** Kart üstündeki bildirim metni: "Teslim edilemedi bildirildi · Adres bulunamadı". */
export function deliveryFailureText(failure: CourierOrder['lastDeliveryFailure'], attempts: number): string | null {
  if (!failure) return null;
  const label = DELIVERY_FAILURE_REASON_LABELS[failure.reason as DeliveryFailureReason] ?? failure.reason;
  const times = attempts > 1 ? ` · ${attempts} kez` : '';
  return `Teslim edilemedi bildirildi · ${label}${times}`;
}
