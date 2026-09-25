// Dilim uzantısı: saklama ve imha koşu kayıtları (08 §2.8 "Kabul kriterleri (otomatik silme)", satır 18).
// Mevcut tablolar değiştirilmez.
// SQL: migrations/0800_retention_runs.sql

import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { pk, tstz } from './_helpers';
import { tenants } from './platform';

/**
 * İmha tutanağı: cron.retention'ın her adımı bir satır yazar. `tenant_id` tenant bazlı adımda
 * (retention.customer_inactive) dolu, tüm tabloya uygulanan SQL adımlarında ve koşu özetinde (cron.retention) boştur.
 * En az 3 yıl saklanır; saklama işleri bu tabloyu silmez. Tenant silinse de satır kalır (tenant_id NULL olur).
 */
export const retentionRuns = pgTable(
  'retention_runs',
  {
    id: pk(),
    /** 08 §2.8 iş adı (ör. retention.order_notes, retention.technical.sms_messages) ya da koşu özeti cron.retention */
    jobName: text('job_name').notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    /** Silinen ya da anonimleşen kayıt sayısı */
    affectedCount: integer('affected_count').notNull().default(0),
    startedAt: tstz('started_at').notNull(),
    finishedAt: tstz('finished_at').notNull(),
    durationMs: integer('duration_ms').notNull(),
    /** Hata özeti (kişisel veri içermez; uzun rakam dizileri maskelenir) */
    error: text('error'),
  },
  (t) => [
    index('retention_runs_job_started_idx').on(t.jobName, t.startedAt),
    index('retention_runs_tenant_started_idx').on(t.tenantId, t.startedAt).where(sql`tenant_id is not null`),
    check('retention_runs_counts_ck', sql`${t.affectedCount} >= 0 and ${t.durationMs} >= 0`),
  ],
);
