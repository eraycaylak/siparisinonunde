// Operasyon: saatler, özel günler, teslimat bölgeleri, olay günlüğü, işler, bildirimler (14 §4).

import {
  DELIVERY_ZONE_KINDS,
  JOB_STATUSES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  QUEUES,
  type DeliveryZoneKind,
  type GeoJsonPolygon,
  type JobStatus,
  type NotificationChannel,
  type NotificationStatus,
  type Queue,
} from '@siparis/core';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, pk, tstz, updatedAt } from './_helpers';
import { branches, tenants } from './platform';

const HHMM_RE = `'^([01][0-9]|2[0-3]):[0-5][0-9]$'`;

export const openingHours = pgTable(
  'opening_hours',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    /** 0 = Pazar … 6 = Cumartesi */
    weekday: smallint('weekday').notNull(),
    /** 'HH:MM'; closes_at < opens_at ⇒ gece yarısını aşar */
    opensAt: text('opens_at').notNull(),
    closesAt: text('closes_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('opening_hours_branch_idx').on(t.branchId, t.weekday),
    index('opening_hours_tenant_idx').on(t.tenantId),
    check('opening_hours_weekday_ck', sql`${t.weekday} between 0 and 6`),
    check('opening_hours_opens_ck', sql`${t.opensAt} ~ ${sql.raw(HHMM_RE)}`),
    check('opening_hours_closes_ck', sql`${t.closesAt} ~ ${sql.raw(HHMM_RE)}`),
  ],
);

export const specialDays = pgTable(
  'special_days',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    isClosed: boolean('is_closed').notNull().default(true),
    opensAt: text('opens_at'),
    closesAt: text('closes_at'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('special_days_branch_date_uk').on(t.branchId, t.date),
    index('special_days_tenant_idx').on(t.tenantId),
    check('special_days_opens_ck', sql`${t.opensAt} is null or ${t.opensAt} ~ ${sql.raw(HHMM_RE)}`),
    check('special_days_closes_ck', sql`${t.closesAt} is null or ${t.closesAt} ~ ${sql.raw(HHMM_RE)}`),
  ],
);

export const deliveryZones = pgTable(
  'delivery_zones',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').$type<DeliveryZoneKind>().notNull(),
    neighborhoods: text('neighborhoods').array().notNull().default(sql`'{}'::text[]`),
    /** GeoJSON Polygon ([lng, lat]) */
    polygon: jsonb('polygon').$type<GeoJsonPolygon>(),
    /** Yarıçap bölgesi; merkez şube konumu */
    radiusM: integer('radius_m'),
    feeKurus: integer('fee_kurus').notNull().default(0),
    minOrderKurus: integer('min_order_kurus').notNull().default(0),
    etaMinutes: integer('eta_minutes').notNull().default(30),
    isActive: boolean('is_active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    deletedAt: tstz('deleted_at'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('delivery_zones_branch_sort_idx').on(t.tenantId, t.branchId, t.sort),
    enumCheck('delivery_zones_kind_ck', t.kind, DELIVERY_ZONE_KINDS),
    check('delivery_zones_fee_ck', sql`${t.feeKurus} >= 0 and ${t.minOrderKurus} >= 0`),
    check('delivery_zones_radius_ck', sql`${t.radiusM} is null or ${t.radiusM} > 0`),
  ],
);

/** SSE olay günlüğü (00 §10 "sipariş kaçmaz"): seq = SSE id; 7 gün saklanır. */
export const branchEvents = pgTable(
  'branch_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('branch_events_branch_seq_idx').on(t.branchId, t.seq), index('branch_events_created_idx').on(t.createdAt)],
);

/** Arka plan işleri (14 §7.2): FOR UPDATE SKIP LOCKED ile çekilir. */
export const jobs = pgTable(
  'jobs',
  {
    id: pk(),
    queue: text('queue').$type<Queue>().notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    runAt: tstz('run_at').notNull().defaultNow(),
    status: text('status').$type<JobStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedAt: tstz('locked_at'),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    /** Tekillik anahtarı; iptal edilen işte serbest bırakılır */
    dedupeKey: text('dedupe_key'),
    tenantId: uuid('tenant_id'),
    finishedAt: tstz('finished_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('jobs_dedupe_key_uk').on(t.dedupeKey),
    index('jobs_pending_run_at_idx').on(t.runAt).where(sql`status = 'pending'`),
    index('jobs_running_locked_idx').on(t.lockedAt).where(sql`status = 'running'`),
    index('jobs_status_idx').on(t.status, t.createdAt),
    index('jobs_type_idx').on(t.type),
    enumCheck('jobs_queue_ck', t.queue, QUEUES),
    enumCheck('jobs_status_ck', t.status, JOB_STATUSES),
  ],
);

/** Platformdan işletmeye uyarılar (14 §4). */
export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id'),
    orderId: uuid('order_id'),
    recipientUserId: uuid('recipient_user_id'),
    kind: text('kind').notNull(),
    channel: text('channel').$type<NotificationChannel>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').$type<NotificationStatus>().notNull().default('pending'),
    providerRef: text('provider_ref'),
    error: text('error'),
    sentAt: tstz('sent_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('notifications_order_idx').on(t.orderId),
    enumCheck('notifications_channel_ck', t.channel, NOTIFICATION_CHANNELS),
    enumCheck('notifications_status_ck', t.status, NOTIFICATION_STATUSES),
  ],
);
