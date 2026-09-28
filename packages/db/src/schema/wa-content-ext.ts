// Dilim uzantısı: Twilio Content API kaynak önbelleği (16 §2.3). SQL: migrations/0902_wa_content_templates.sql
//
// KÜRESEL (tenant_id'siz) tablo — packages/db/test/schema.test.ts'te istisna olarak belgelidir: kaynaklar platformun
// Twilio hesabına aittir (ortak numara, 00 §12a madde 8), işletmeye değil. Kişisel veri içermez: yalnız kaynak adı ve
// Twilio kimliği (HX…); mesaj metinleri gönderimde değişken olarak gider, burada saklanmaz.

import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, pk, updatedAt } from './_helpers';

/** Kaynak türü: katalogdaki etkileşimli şablon ya da WhatsApp onayına gönderilen mesaj şablonu. */
export const WA_CONTENT_KINDS = ['interactive', 'template'] as const;
export type WaContentKind = (typeof WA_CONTENT_KINDS)[number];

export const waContentTemplates = pgTable(
  'wa_content_templates',
  {
    id: pk(),
    /** Şimdilik yalnız 'twilio' (Content API'si olan tek sağlayıcı) */
    provider: text('provider').notNull(),
    /** Twilio'daki friendly_name: katalogda yg_qr2 / yg_list5d…, şablonda şablon adı */
    friendlyName: text('friendly_name').notNull(),
    /** HX ile başlayan Twilio içerik kimliği */
    contentSid: text('content_sid').notNull(),
    kind: text('kind').$type<WaContentKind>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('wa_content_templates_name_uk').on(t.provider, t.friendlyName),
    index('wa_content_templates_kind_idx').on(t.kind),
    check('wa_content_templates_provider_ck', sql`${t.provider} in ('twilio')`),
    check('wa_content_templates_kind_ck', sql`${t.kind} in ('interactive', 'template')`),
  ],
);
