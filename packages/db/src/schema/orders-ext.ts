// Dilim uzantısı: yeni tablo/kolonlar buraya eklenir (mevcut kolonlar değiştirilmez).
// SQL karşılığı ayrı migration dosyasında (14 §2 numara aralıkları).

import { DELIVERY_FAILURE_REASONS, type DeliveryFailureReason } from '@siparis/core/orders/delivery';
import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, pk } from './_helpers';
import { orders } from './orders';
import { tenants, users } from './platform';

/**
 * "Teslim edilemedi" bildirimleri (04 §9.2; migrations/0200_courier_delivery_attempt.sql). Kurye kapıda teslim
 * edemezse sipariş DURUM DEĞİŞTİRMEZ — karar işletmededir (tekrar dene ya da `courier_issue` ile iptal) — ama
 * her deneme buraya bir satır yazar. Append-only: sipariş birden çok kez denenebilir.
 */
export const orderDeliveryAttempts = pgTable(
  'order_delivery_attempts',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** Bildiren kurye (hesap silinirse satır kalır) */
    courierUserId: uuid('courier_user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason').$type<DeliveryFailureReason>().notNull(),
    /** `other` sebebinde zorunlu, ≤ 140 karakter; işletmeye gösterilir */
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('order_delivery_attempts_order_idx').on(t.tenantId, t.orderId, t.createdAt),
    enumCheck('order_delivery_attempts_reason_ck', t.reason, DELIVERY_FAILURE_REASONS),
  ],
);
