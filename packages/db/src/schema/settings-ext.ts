// Dilim uzantısı (işletme ayarları + onboarding + müşteriler, dilim 4).
// SQL karşılığı: migrations/0400_settings_onboarding.sql. Mevcut kolonlar değiştirilmez.

import { pgTable, text, uuid, index } from 'drizzle-orm/pg-core';
import { createdAt, tstz, updatedAt } from './_helpers';
import { customers } from './orders';
import { tenants } from './platform';

/** Onboarding ilerlemesi (04 §3). */
export const tenantOnboarding = pgTable('tenant_onboarding', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** Son tamamlanan adım kodu (05 §A.2.2: profile_done, menu_done, ops_done, wa_connected, wa_test_done, web_live, live) */
  step: text('step'),
  /** "WhatsApp'sız başla" seçildi (04 §3.6) */
  whatsapplessAt: tstz('whatsappless_at'),
  testOrderId: uuid('test_order_id'),
  completedAt: tstz('completed_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** KVKK silme/anonimleştirme kaydı (08 §2.10). */
export const customerErasures = pgTable(
  'customer_erasures',
  {
    customerId: uuid('customer_id')
      .primaryKey()
      .references(() => customers.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    erasedAt: tstz('erased_at').notNull().defaultNow(),
    erasedByUserId: uuid('erased_by_user_id'),
  },
  (t) => [index('customer_erasures_tenant_idx').on(t.tenantId)],
);
