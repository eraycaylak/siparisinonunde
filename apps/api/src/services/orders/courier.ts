// Kurye teslim akışı servisi (04 §9.2; denetim H10/H11/H13): kapıda ödeme yöntemi doğrulaması, yöntem değişikliğinin
// olay günlüğüne yazılması ve "teslim edilemedi" bildirimi. Kurallar `@siparis/core/orders/delivery` içinde saftır;
// burada yalnız veritabanı ve hata kodları var.

import type { CourierCollectedPaymentMethod, MealCardBrand } from '@siparis/core';
import {
  courierCanChangePayment,
  courierPaymentMethods,
  deliveryFailureNoteRequired,
  type DeliveryFailureReason,
} from '@siparis/core/orders/delivery';
import { branches, orderDeliveryAttempts, orderEvents, type Database } from '@siparis/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors';
import { appendBranchEvent } from '../../lib/events';
import { fieldError, validatePayment } from './payment';
import { loadOrderSummary, type OrderRow } from './summary';
import type { BranchRow } from './store-context';

export interface CourierPaymentPatch {
  paymentMethod: CourierCollectedPaymentMethod;
  mealCardBrand: MealCardBrand | null;
}

/** Siparişin şubesi (tenant süzgeciyle; yoksa 409 — sipariş şubesiz olamaz). */
export async function loadOrderBranch(db: Database, order: OrderRow): Promise<BranchRow> {
  const [b] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, order.branchId), eq(branches.tenantId, order.tenantId)));
  if (!b) throw new AppError(409, 'branch_missing', 'Siparişin şubesi bulunamadı.');
  return b;
}

/** Siparişlerin şubelerinin ödeme ayarları (liste DTO'su için; tenant süzgeciyle). */
export async function loadBranchPaymentMap(
  db: Database,
  tenantId: string,
  branchIds: string[],
): Promise<Map<string, Pick<BranchRow, 'paymentMethods' | 'mealCardBrands'>>> {
  const map = new Map<string, Pick<BranchRow, 'paymentMethods' | 'mealCardBrands'>>();
  if (!branchIds.length) return map;
  const rows = await db
    .select({ id: branches.id, paymentMethods: branches.paymentMethods, mealCardBrands: branches.mealCardBrands })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), inArray(branches.id, branchIds)));
  for (const r of rows) map.set(r.id, { paymentMethods: r.paymentMethods, mealCardBrands: r.mealCardBrands });
  return map;
}

/**
 * Teslimde bildirilen ödeme yöntemini doğrular ve değişiklik varsa yazılacak alanları döner (yoksa null).
 * Kapılar: (1) yöntem kapıda tahsil edilebilir olmalı (şema), (2) ŞUBEDE AÇIK olmalı ve teslim türüne uygun olmalı,
 * (3) siparişin mevcut yöntemi kapıda tahsil edilen bir yöntem olmalı — online/kasada ödenmiş sipariş kapıda
 * değiştirilemez, (4) yemek kartında marka zorunlu ve işletmenin kabul ettiği markalardan olmalı.
 */
export function resolveCourierPayment(
  branch: Pick<BranchRow, 'paymentMethods' | 'mealCardBrands'>,
  order: Pick<OrderRow, 'paymentMethod' | 'mealCardBrand' | 'fulfillmentType' | 'totalKurus'>,
  body: { paidWith?: CourierCollectedPaymentMethod; mealCardBrand?: MealCardBrand } | undefined,
): CourierPaymentPatch | null {
  const paidWith = body?.paidWith;
  if (!paidWith) return null;
  const brand = paidWith === 'meal_card_on_delivery' ? (body?.mealCardBrand ?? (order.mealCardBrand as MealCardBrand | null) ?? null) : null;
  if (paidWith === order.paymentMethod && brand === (order.mealCardBrand ?? null)) return null;

  if (!courierCanChangePayment(order.paymentMethod)) {
    throw new AppError(422, 'payment_method_locked', 'Bu siparişin ödemesi kapıda alınmıyor; yöntem değiştirilemez.');
  }
  const allowed = courierPaymentMethods({ branchPaymentMethods: branch.paymentMethods, fulfillmentType: order.fulfillmentType });
  if (!allowed.includes(paidWith)) {
    throw new AppError(422, 'payment_method_unavailable', 'Bu ödeme yöntemi bu sipariş için kullanılamıyor.', {
      issues: [{ path: '/paidWith', message: 'Bu ödeme yöntemi bu sipariş için kullanılamıyor.' }],
    });
  }
  // changeForKurus bilerek verilmez: para üstü kuralı sipariş anında doğrulanır, teslimde yöntem değişikliğini engellemez.
  validatePayment(branch, { fulfillmentType: 'delivery', paymentMethod: paidWith, mealCardBrand: brand }, order.totalKurus);
  return { paymentMethod: paidWith, mealCardBrand: brand };
}

/**
 * Ödeme yöntemi değişikliğini olay günlüğüne yazar (denetim H10: eski değer kaybolmasın). İşletme bunu panel
 * zaman çizelgesinde görür; gün sonu kasa raporundaki kurye kırılımı buradan denetlenebilir.
 */
export async function recordPaymentMethodChange(
  tx: Database,
  input: { order: OrderRow; patch: CourierPaymentPatch; actorUserId: string; now: Date },
): Promise<void> {
  await tx.insert(orderEvents).values({
    tenantId: input.order.tenantId,
    orderId: input.order.id,
    type: 'payment_method_changed',
    actorType: 'user',
    actorUserId: input.actorUserId,
    // reason: panel zaman çizelgesinde gösterilen YENİ yöntem; eski değer `data`da (olay DTO'su `data` taşımıyor)
    reason: input.patch.paymentMethod,
    data: {
      by: 'courier',
      from: input.order.paymentMethod,
      to: input.patch.paymentMethod,
      fromMealCardBrand: input.order.mealCardBrand ?? null,
      toMealCardBrand: input.patch.mealCardBrand,
    },
    createdAt: input.now,
  });
}

/**
 * "Teslim edilemedi" bildirimi (04 §9.2): sipariş DURUM DEĞİŞTİRMEZ (karar işletmede: tekrar dene ya da
 * `courier_issue` ile iptal). Deneme satırı + olay günlüğü + panele SSE olayı aynı transaction'da yazılır.
 */
export async function recordDeliveryFailure(
  tx: Database,
  input: { order: OrderRow; reason: DeliveryFailureReason; note?: string | null; actorUserId: string; now: Date },
): Promise<void> {
  const note = input.note?.trim() || null;
  if (deliveryFailureNoteRequired(input.reason, note)) {
    throw fieldError('note', '"Diğer" sebebi için kısa bir açıklama yazın.');
  }
  await tx.insert(orderDeliveryAttempts).values({
    tenantId: input.order.tenantId,
    orderId: input.order.id,
    courierUserId: input.actorUserId,
    reason: input.reason,
    note,
    createdAt: input.now,
  });
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orderDeliveryAttempts)
    .where(and(eq(orderDeliveryAttempts.tenantId, input.order.tenantId), eq(orderDeliveryAttempts.orderId, input.order.id)));
  const attempts = Number(count?.n ?? 1);
  await tx.insert(orderEvents).values({
    tenantId: input.order.tenantId,
    orderId: input.order.id,
    type: 'delivery_failed',
    actorType: 'user',
    actorUserId: input.actorUserId,
    reason: input.reason,
    note,
    createdAt: input.now,
  });
  // Panelde uyarı + ses (04 §9.2, §13 SES-06): sipariş kartı aynı SSE olayıyla tazelenir. Sebep ve deneme sayısı
  // payload'a yazılır ki panel bildirimi ikinci bir sorgu olmadan metinleyebilsin. `emitOrderUpdated` yerine
  // doğrudan yazılır çünkü o yardımcı ek alan taşımıyor; zarf (order/change/from/to) onunla birebir aynı.
  // Serbest metin açıklama BİLEREK yüke konmaz: SSE mutfak projeksiyonunda yalnız bilinen kişisel alan adları
  // temizlenir (`scrubPersonal`), tanımadığı bir `note` alanı fiyatsız mutfak ekranına düşerdi. İşletme açıklamayı
  // zaman çizelgesinden ve `order_delivery_attempts`ten okur.
  const summary = await loadOrderSummary(tx, input.order);
  await appendBranchEvent(tx, {
    tenantId: input.order.tenantId,
    branchId: input.order.branchId,
    type: 'order.updated',
    payload: { order: summary, change: 'delivery_failed', from: null, to: null, reason: input.reason, attempts },
  });
}

export interface DeliveryFailureInfo {
  attempts: number;
  last: { reason: DeliveryFailureReason; note: string | null; at: Date } | null;
}

/** Siparişlerin teslim edilemedi bildirimleri (sayı + en son kayıt). */
export async function loadDeliveryFailures(db: Database, tenantId: string, orderIds: string[]): Promise<Map<string, DeliveryFailureInfo>> {
  const map = new Map<string, DeliveryFailureInfo>();
  if (!orderIds.length) return map;
  const rows = await db
    .select()
    .from(orderDeliveryAttempts)
    .where(and(eq(orderDeliveryAttempts.tenantId, tenantId), inArray(orderDeliveryAttempts.orderId, orderIds)))
    .orderBy(desc(orderDeliveryAttempts.createdAt));
  for (const r of rows) {
    const cur = map.get(r.orderId);
    if (cur) {
      map.set(r.orderId, { attempts: cur.attempts + 1, last: cur.last });
      continue;
    }
    map.set(r.orderId, { attempts: 1, last: { reason: r.reason, note: r.note ?? null, at: r.createdAt } });
  }
  return map;
}
