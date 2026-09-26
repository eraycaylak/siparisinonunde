// Dilim uzantısı: ortak WhatsApp numarası (00 §12a madde 8). Mevcut tablolar değiştirilmez.
// SQL: migrations/0900_shared_wa_number.sql
//
// İki KÜRESEL (tenant_id'siz) tablo — packages/db/test/schema.test.ts'te istisna olarak belgelidir:
// - shared_wa_routes: ortak numaraya yazan kişinin hangi dükkanla konuştuğu (yönlendirme durumu). Kişisel veridir
//   (BSUID/telefon + dükkan listesi); platform genelinde müşteri profili DEĞİLDİR: ad, adres, sipariş tutmaz. 24 ay
//   hareketsizlikte silinir (cron.retention → retention.shared_wa_routes); bir dükkan müşterisini KVKK ile silince o
//   dükkan kaydın listesinden çıkarılır (services/customers eraseCustomer).
// - shared_wa_messages: hiçbir dükkanın sohbetine girmeyen platform düzeyi mesajlar (dükkan seçici, "kod bulunamadı",
//   dükkana yönlenmemiş gelen mesaj). 30 gün sonra silinir (retention.technical.shared_wa_messages).

import {
  MESSAGE_DIRECTIONS,
  MESSAGE_KINDS,
  MESSAGE_STATUSES,
  type MessageDirection,
  type MessageKind,
  type MessageStatus,
} from '@siparis/core';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, pk, tstz, updatedAt } from './_helpers';
import { tenants } from './platform';

export const sharedWaRoutes = pgTable(
  'shared_wa_routes',
  {
    id: pk(),
    /** WhatsApp işletme kapsamlı kullanıcı kimliği (platform portföyünde) */
    waBsuid: text('wa_bsuid'),
    /** E.164; BSUID yoksa anahtar */
    phoneE164: text('phone_e164'),
    /** Son yönlendirilen dükkan (24 saat içinde etkinlik varsa kodsuz mesaj buraya gider) */
    currentTenantId: uuid('current_tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    /** Son konuşulan dükkanlar (en yeni başta, en çok 5); silinen tenant okuma anında elenir */
    recentTenantIds: uuid('recent_tenant_ids').array().notNull().default(sql`'{}'::uuid[]`),
    lastRoutedAt: tstz('last_routed_at'),
    lastInboundAt: tstz('last_inbound_at'),
    /** Son otomatik dükkan seçici (aynı kişiye kısa sürede tekrar gönderilmez) */
    lastPickerAt: tstz('last_picker_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('shared_wa_routes_bsuid_uk').on(t.waBsuid).where(sql`wa_bsuid is not null`),
    uniqueIndex('shared_wa_routes_phone_uk').on(t.phoneE164).where(sql`phone_e164 is not null`),
    index('shared_wa_routes_last_inbound_idx').on(t.lastInboundAt),
    check('shared_wa_routes_key_ck', sql`${t.waBsuid} is not null or ${t.phoneE164} is not null`),
  ],
);

/** Giden platform mesajının yükü (outbox; services/messaging/shared-router.ts). */
export interface SharedWaMessagePayload {
  /** P01–P05 */
  code?: string | null;
  /** Gönderim tanımı (OutboundSpec ile aynı biçim) */
  spec?: Record<string, unknown>;
  /** Alıcı (giden) */
  to?: { phone?: string; bsuid?: string };
  /** Sağlayıcıya giden gövde (gönderimden sonra) */
  request?: Record<string, unknown>;
  /** Gelen: buton/liste yanıt kimliği, tür */
  type?: string;
  id?: string;
  error?: { code: string; message: string } | null;
  [key: string]: unknown;
}

export const sharedWaMessages = pgTable(
  'shared_wa_messages',
  {
    id: pk(),
    routeId: uuid('route_id').references(() => sharedWaRoutes.id, { onDelete: 'cascade' }),
    direction: text('direction').$type<MessageDirection>().notNull(),
    /** WhatsApp mesaj kimliği (UNIQUE; idempotency) */
    wamid: text('wamid'),
    kind: text('kind').$type<MessageKind>().notNull(),
    body: text('body'),
    payload: jsonb('payload').$type<SharedWaMessagePayload>(),
    status: text('status').$type<MessageStatus>(),
    errorCode: text('error_code'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('shared_wa_messages_wamid_uk').on(t.wamid),
    index('shared_wa_messages_route_idx').on(t.routeId, t.createdAt),
    index('shared_wa_messages_created_idx').on(t.createdAt),
    enumCheck('shared_wa_messages_direction_ck', t.direction, MESSAGE_DIRECTIONS),
    enumCheck('shared_wa_messages_kind_ck', t.kind, MESSAGE_KINDS),
    enumCheck('shared_wa_messages_status_ck', t.status, MESSAGE_STATUSES),
  ],
);
