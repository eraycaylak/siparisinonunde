// Dilim uzantısı: yeni tablo/kolonlar buraya eklenir (mevcut kolonlar değiştirilmez).
// SQL karşılığı ayrı migration dosyasında (14 §2 numara aralıkları).
//
// Dilim 3 (WhatsApp + SMS): konuşma motorunun bot durumu (soğuma süreleri, alıcı başı gönderim aralığı,
// opt-out anı). Mevcut `conversations` tablosunu değiştirmemek için ayrı 1:1 tablo.
// SQL: migrations/0300_whatsapp_bot_state.sql

import { integer, index, jsonb, pgTable, uuid } from 'drizzle-orm/pg-core';
import { tstz } from './_helpers';
import { tenants } from './platform';
import { conversations } from './whatsapp';

/** Soğuma anahtarı → son gönderim zamanı (ISO). Ör. { paused: '…', unavailable: '…', voice: '…' } */
export type BotCooldowns = Record<string, string>;

export const conversationBotState = pgTable(
  'conversation_bot_state',
  {
    conversationId: uuid('conversation_id')
      .primaryKey()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Alıcı başı ~6 sn aralık (02 §7.6): bir sonraki giden mesajın en erken zamanı */
    nextSendAt: tstz('next_send_at'),
    /** Tek tip otomatik yanıtların son gönderimi (replyOnce) */
    cooldowns: jsonb('cooldowns').$type<BotCooldowns>().notNull().default({}),
    /** Hatalı sipariş kodu denemeleri (10 dk'da en çok 5) */
    codeFailCount: integer('code_fail_count').notNull().default(0),
    codeFailSince: tstz('code_fail_since'),
    /** "DUR" (kampanya) anı */
    marketingOptOutAt: tstz('marketing_opt_out_at'),
    /** "Evet, hepsini durdur" anı: bundan önce verilmiş siparişlerin bildirimleri gitmez (02 §6.9) */
    optedOutAt: tstz('opted_out_at'),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('conversation_bot_state_tenant_idx').on(t.tenantId)],
);
