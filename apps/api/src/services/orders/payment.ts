// Ödeme yöntemi kuralları (03 §6): yalnız şubenin açtığı yöntemler; gel-alda kasada ödeme; yemek kartı markası
// zorunlu ve kabul edilenlerden; nakitte para üstü tutarı toplamdan az olamaz.

import type { FulfillmentType, PaymentMethod } from '@siparis/core';
import { AppError } from '../../lib/errors';
import type { BranchRow } from './store-context';

export function fieldError(path: string, message: string, code = 'validation_error'): AppError {
  return new AppError(400, code, message, { issues: [{ path: `/${path}`, message }] });
}

/** Ödeme yöntemi şubede açık mı; yemek kartı markası ve para üstü kuralları (03 §6). */
export function validatePayment(
  branch: Pick<BranchRow, 'paymentMethods' | 'mealCardBrands'>,
  input: { fulfillmentType: FulfillmentType; paymentMethod: PaymentMethod; mealCardBrand?: string | null; changeForKurus?: number | null },
  totalKurus: number,
): void {
  const allowed = new Set<PaymentMethod>(branch.paymentMethods.filter((m) => m !== 'online_card'));
  if (input.fulfillmentType === 'pickup') allowed.add('pay_at_counter');
  else allowed.delete('pay_at_counter');
  if (!allowed.has(input.paymentMethod)) {
    throw new AppError(422, 'payment_method_unavailable', 'Bu ödeme yöntemi bu sipariş için kullanılamıyor.', {
      issues: [{ path: '/paymentMethod', message: 'Bu ödeme yöntemi bu sipariş için kullanılamıyor.' }],
    });
  }
  if (input.paymentMethod === 'meal_card_on_delivery') {
    if (!input.mealCardBrand) throw fieldError('mealCardBrand', 'Yemek kartı markasını seçin.');
    if (branch.mealCardBrands.length && !branch.mealCardBrands.includes(input.mealCardBrand as never)) {
      throw new AppError(422, 'meal_card_brand_unavailable', 'Bu yemek kartı bu işletmede geçmiyor.', {
        issues: [{ path: '/mealCardBrand', message: 'Bu yemek kartı bu işletmede geçmiyor.' }],
      });
    }
  }
  if (input.paymentMethod === 'cash_on_delivery' && input.changeForKurus != null && input.changeForKurus > 0 && input.changeForKurus < totalKurus) {
    throw new AppError(422, 'invalid_change', 'Para üstü tutarı sipariş toplamından az olamaz.', {
      issues: [{ path: '/changeForKurus', message: 'Para üstü tutarı sipariş toplamından az olamaz.' }],
    });
  }
}

