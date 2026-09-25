// Dilim uzantısı: Web Push abonelikleri (00 §10 alarm t=0, 04 §4.5) ve panel varlığı (06 §7.7 panel çevrimdışı
// dedektörü). Mevcut tablolar değiştirilmez.
// SQL: migrations/0700_web_push.sql

import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, tstz, updatedAt } from './_helpers';
import { branches, sessions, tenants, users } from './platform';

/**
 * Cihaz (tarayıcı) başına push aboneliği. `endpoint` tekildir: aynı cihaz yeniden abone olunca satır güncellenir
 * (kullanıcı/işletme/şube/oturum bağı yenilenir, disabled_at temizlenir). Oturum silinince abonelik de silinir.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Abone olunurken seçili şube (null = üyeliğin eriştiği tüm şubeler) */
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    /** İstemci genel anahtarı (base64url) */
    p256dh: text('p256dh').notNull(),
    /** İstemci kimlik sırrı (base64url) */
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastSuccessAt: tstz('last_success_at'),
    failedAt: tstz('failed_at'),
    /** Son hata (durum kodu + kısa açıklama; kişisel veri içermez) */
    lastError: text('last_error'),
    /** İtme servisi aboneliği sildi (404/410) ya da kullanıcı kapattı */
    disabledAt: tstz('disabled_at'),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_uk').on(t.endpoint),
    index('push_subscriptions_tenant_idx').on(t.tenantId),
    index('push_subscriptions_user_idx').on(t.userId),
    index('push_subscriptions_session_idx').on(t.sessionId),
  ],
);

/** Şube başına sipariş ekranı varlığı (SSE akışı açıkken dakikada bir dokunulur). */
export const branchPanelPresence = pgTable(
  'branch_panel_presence',
  {
    branchId: uuid('branch_id')
      .primaryKey()
      .references(() => branches.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Son görülme (null = cron'un açtığı, hiç görülmemiş şube satırı) */
    lastSeenAt: tstz('last_seen_at'),
    /** Son "panel çevrimdışı" uyarısı (60 dk'da en çok 1) */
    offlineAlertedAt: tstz('offline_alerted_at'),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('branch_panel_presence_tenant_idx').on(t.tenantId)],
);
