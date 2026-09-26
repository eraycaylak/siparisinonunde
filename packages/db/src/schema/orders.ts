// Müşteri ve sipariş tabloları (14 §4; kolon anlamları 07 §3.3).

import {
  CANCELLATION_REQUEST_STATUSES,
  CANCEL_REASONS,
  CANCELLED_BY,
  FULFILLMENT_TYPES,
  MEAL_CARD_BRANDS,
  ORDER_CHANNELS,
  ORDER_EVENT_ACTOR_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  REJECTION_REASONS,
  REVIEW_RATINGS,
  TEST_KINDS,
  VERIFICATION_METHODS,
  type CancellationRequestStatus,
  type CancelReason,
  type CancelledBy,
  type FulfillmentType,
  type MealCardBrand,
  type OrderChannel,
  type OrderEventActorType,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type RejectionReason,
  type ReviewRating,
  type TestKind,
  type VerificationMethod,
} from '@siparis/core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  doublePrecision,
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
import { options, products } from './menu';
import { deliveryZones } from './operations';
import { branches, tenants, users } from './platform';

export const customers = pgTable(
  'customers',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** WhatsApp BSUID (kimlik; telefon nullable, 00 §6.8) */
    waBsuid: text('wa_bsuid'),
    phoneE164: text('phone_e164'),
    waUsername: text('wa_username'),
    name: text('name'),
    notes: text('notes'),
    isBlocked: boolean('is_blocked').notNull().default(false),
    orderCount: integer('order_count').notNull().default(0),
    lastOrderAt: tstz('last_order_at'),
    lastInboundAt: tstz('last_inbound_at'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('customers_tenant_bsuid_uk').on(t.tenantId, t.waBsuid).where(sql`wa_bsuid is not null`),
    uniqueIndex('customers_tenant_phone_uk').on(t.tenantId, t.phoneE164).where(sql`phone_e164 is not null`),
    index('customers_tenant_last_order_idx').on(t.tenantId, t.lastOrderAt),
  ],
);

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    label: text('label'),
    neighborhood: text('neighborhood'),
    addressLine: text('address_line'),
    directions: text('directions'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    lastUsedAt: tstz('last_used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('customer_addresses_customer_idx').on(t.tenantId, t.customerId)],
);

const OPEN_STATUS_SQL = sql.raw(`status in ('awaiting_customer','new','accepted','preparing','ready','on_the_way')`);

export const orders = pgTable(
  'orders',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    /** Tenant başına artan (tenants.order_seq); canary 0 */
    number: integer('number').notNull(),
    status: text('status').$type<OrderStatus>().notNull(),
    channel: text('channel').$type<OrderChannel>().notNull(),
    fulfillmentType: text('fulfillment_type').$type<FulfillmentType>().notNull(),
    testKind: text('test_kind').$type<TestKind>(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id'),
    linkTokenId: uuid('link_token_id'),
    verificationMethod: text('verification_method').$type<VerificationMethod>(),
    verifiedAt: tstz('verified_at'),
    /** Durum bildirimi kanalı: whatsapp | sms | none */
    statusNotifyChannel: text('status_notify_channel').notNull().default('whatsapp'),
    // Teslimat (snapshot)
    zoneId: uuid('zone_id').references(() => deliveryZones.id, { onDelete: 'set null' }),
    zoneName: text('zone_name'),
    neighborhood: text('neighborhood'),
    addressLine: text('address_line'),
    directions: text('directions'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    outOfZoneOverride: boolean('out_of_zone_override').notNull().default(false),
    customerName: text('customer_name'),
    /** E.164 */
    customerPhone: text('customer_phone'),
    // Tutarlar (kuruş)
    subtotalKurus: integer('subtotal_kurus').notNull(),
    deliveryFeeKurus: integer('delivery_fee_kurus').notNull().default(0),
    discountKurus: integer('discount_kurus').notNull().default(0),
    totalKurus: integer('total_kurus').notNull(),
    minOrderKurus: integer('min_order_kurus').notNull().default(0),
    currency: char('currency', { length: 3 }).notNull().default('TRY'),
    // Ödeme
    paymentMethod: text('payment_method').$type<PaymentMethod>().notNull(),
    paymentStatus: text('payment_status').$type<PaymentStatus>().notNull().default('unpaid'),
    mealCardBrand: text('meal_card_brand').$type<MealCardBrand>(),
    changeForKurus: integer('change_for_kurus'),
    paidAt: tstz('paid_at'),
    wantsCutlery: boolean('wants_cutlery').notNull().default(false),
    /** Müşteri notu (≤ 140) */
    note: text('note'),
    /** İşletme iç notu */
    internalNote: text('internal_note'),
    // Süre ve kurye
    etaMinutes: integer('eta_minutes'),
    estimatedReadyAt: tstz('estimated_ready_at'),
    courierUserId: uuid('courier_user_id').references(() => users.id, { onDelete: 'set null' }),
    // Zaman damgaları
    placedAt: tstz('placed_at').notNull().defaultNow(),
    firstAckedAt: tstz('first_acked_at'),
    acceptedAt: tstz('accepted_at'),
    preparingAt: tstz('preparing_at'),
    readyAt: tstz('ready_at'),
    onTheWayAt: tstz('on_the_way_at'),
    deliveredAt: tstz('delivered_at'),
    rejectedAt: tstz('rejected_at'),
    cancelledAt: tstz('cancelled_at'),
    acceptedByUserId: uuid('accepted_by_user_id'),
    createdByUserId: uuid('created_by_user_id'),
    // Ret / iptal
    rejectionReason: text('rejection_reason').$type<RejectionReason>(),
    rejectionNote: text('rejection_note'),
    /** Bekleyen ret (30 sn geri alma); doluysa durum 'new' kalır */
    rejectionScheduledAt: tstz('rejection_scheduled_at'),
    rejectionRequestedBy: uuid('rejection_requested_by'),
    cancelledBy: text('cancelled_by').$type<CancelledBy>(),
    cancelReason: text('cancel_reason').$type<CancelReason>(),
    cancelNote: text('cancel_note'),
    cancelRequestedAt: tstz('cancel_requested_at'),
    // Takip ve bildirim
    /** Final durum + 7 gün (token saklanmaz, 14 §7.4) */
    trackingExpiresAt: tstz('tracking_expires_at'),
    delayNoticeCount: smallint('delay_notice_count').notNull().default(0),
    waStatusMsgCount: smallint('wa_status_msg_count').notNull().default(0),
    /** Storefront idempotency anahtarı */
    idempotencyKey: text('idempotency_key'),
    confirmationIp: text('confirmation_ip'),
    confirmationUserAgent: text('confirmation_user_agent'),
    sourceMeta: jsonb('source_meta').$type<Record<string, unknown>>(),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_tenant_number_uk').on(t.tenantId, t.number).where(sql`test_kind is distinct from 'canary'`),
    uniqueIndex('orders_tenant_idempotency_uk').on(t.tenantId, t.idempotencyKey).where(sql`idempotency_key is not null`),
    index('orders_open_idx').on(t.tenantId, t.branchId, t.status).where(OPEN_STATUS_SQL),
    index('orders_branch_placed_idx').on(t.tenantId, t.branchId, t.placedAt),
    index('orders_customer_idx').on(t.tenantId, t.customerId, t.placedAt),
    index('orders_courier_idx').on(t.tenantId, t.courierUserId).where(sql`courier_user_id is not null`),
    index('orders_rejection_scheduled_idx').on(t.rejectionScheduledAt).where(sql`rejection_scheduled_at is not null`),
    enumCheck('orders_status_ck', t.status, ORDER_STATUSES),
    enumCheck('orders_channel_ck', t.channel, ORDER_CHANNELS),
    enumCheck('orders_fulfillment_type_ck', t.fulfillmentType, FULFILLMENT_TYPES),
    enumCheck('orders_test_kind_ck', t.testKind, TEST_KINDS),
    enumCheck('orders_verification_method_ck', t.verificationMethod, VERIFICATION_METHODS),
    enumCheck('orders_payment_method_ck', t.paymentMethod, PAYMENT_METHODS),
    enumCheck('orders_payment_status_ck', t.paymentStatus, PAYMENT_STATUSES),
    enumCheck('orders_meal_card_brand_ck', t.mealCardBrand, MEAL_CARD_BRANDS),
    enumCheck('orders_rejection_reason_ck', t.rejectionReason, REJECTION_REASONS),
    enumCheck('orders_cancelled_by_ck', t.cancelledBy, CANCELLED_BY),
    enumCheck('orders_cancel_reason_ck', t.cancelReason, CANCEL_REASONS),
    enumCheck('orders_status_notify_channel_ck', t.statusNotifyChannel, ['whatsapp', 'sms', 'none']),
    check('orders_total_ck', sql`${t.totalKurus} = ${t.subtotalKurus} + ${t.deliveryFeeKurus} - ${t.discountKurus}`),
    check('orders_amounts_ck', sql`${t.subtotalKurus} >= 0 and ${t.deliveryFeeKurus} >= 0 and ${t.discountKurus} >= 0`),
    check('orders_rejection_pending_ck', sql`${t.rejectionScheduledAt} is null or ${t.status} = 'new'`),
    check('orders_rejected_reason_ck', sql`${t.status} <> 'rejected' or ${t.rejectionReason} is not null`),
    check('orders_cancelled_reason_ck', sql`${t.status} <> 'cancelled' or (${t.cancelledBy} is not null and ${t.cancelReason} is not null)`),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    /** Snapshot */
    name: text('name').notNull(),
    categoryName: text('category_name'),
    unitPriceKurus: integer('unit_price_kurus').notNull(),
    optionsUnitKurus: integer('options_unit_kurus').notNull().default(0),
    quantity: integer('quantity').notNull(),
    lineTotalKurus: integer('line_total_kurus').notNull(),
    note: text('note'),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId, t.sort),
    index('order_items_tenant_idx').on(t.tenantId),
    check('order_items_quantity_ck', sql`${t.quantity} between 1 and 50`),
    check('order_items_line_total_ck', sql`${t.lineTotalKurus} >= 0`),
  ],
);

export const orderItemOptions = pgTable(
  'order_item_options',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id').references(() => options.id, { onDelete: 'set null' }),
    groupName: text('group_name').notNull(),
    optionName: text('option_name').notNull(),
    priceDeltaKurus: integer('price_delta_kurus').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('order_item_options_item_idx').on(t.orderItemId)],
);

/** Sipariş zaman çizelgesi (append-only). */
export const orderEvents = pgTable(
  'order_events',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** status_changed, created, rejection_scheduled, rejection_undone, eta_updated, delay_notified, courier_assigned, ... */
    type: text('type').notNull().default('status_changed'),
    fromStatus: text('from_status').$type<OrderStatus>(),
    toStatus: text('to_status').$type<OrderStatus>(),
    actorType: text('actor_type').$type<OrderEventActorType>().notNull(),
    actorUserId: uuid('actor_user_id'),
    reason: text('reason'),
    note: text('note'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('order_events_order_idx').on(t.tenantId, t.orderId, t.createdAt),
    enumCheck('order_events_actor_type_ck', t.actorType, ORDER_EVENT_ACTOR_TYPES),
    enumCheck('order_events_from_status_ck', t.fromStatus, ORDER_STATUSES),
    enumCheck('order_events_to_status_ck', t.toStatus, ORDER_STATUSES),
  ],
);

export const orderAcks = pgTable(
  'order_acks',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    userId: uuid('user_id'),
    deviceLabel: text('device_label'),
    ackedAt: tstz('acked_at').notNull().defaultNow(),
  },
  (t) => [index('order_acks_order_idx').on(t.orderId)],
);

/** Akış B sipariş kodu (WhatsApp). */
export const orderVerificationCodes = pgTable(
  'order_verification_codes',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** 6 karakter, alfabe ABCDEFGHJKLMNPQRSTUVWXYZ23456789 */
    code: text('code').notNull(),
    /** Oluşturma + 30 dk */
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('order_verification_codes_order_uk').on(t.orderId),
    uniqueIndex('order_verification_codes_pending_uk').on(t.tenantId, t.code).where(sql`used_at is null`),
    // Ortak numara (0900): bekleyen kod tüm işletmelerde tekil — yönlendirici kodu işletme bilmeden bulur
    uniqueIndex('order_verification_codes_pending_code_uk').on(t.code).where(sql`used_at is null`),
    index('order_verification_codes_code_idx').on(t.code, t.createdAt),
    check('order_verification_codes_code_ck', sql`${t.code} ~ '^[A-HJ-NP-Z2-9]{6}$'`),
  ],
);

/** SMS OTP (WhatsApp'sız mod). */
export const otpVerifications = pgTable(
  'otp_verifications',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    phoneE164: text('phone_e164').notNull(),
    /** Düz kod saklanmaz */
    codeHash: text('code_hash').notNull(),
    /** Oluşturma + 5 dk */
    expiresAt: tstz('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    verifiedAt: tstz('verified_at'),
    createdAt: createdAt(),
  },
  (t) => [index('otp_verifications_order_idx').on(t.orderId), index('otp_verifications_phone_idx').on(t.phoneE164, t.createdAt)],
);

/** Akış A "Menüyü aç" token'ları. */
export const storefrontLinkTokens = pgTable(
  'storefront_link_tokens',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id'),
    tokenHash: text('token_hash').notNull(),
    conversationId: uuid('conversation_id'),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
    /** Oluşturma + 2 sa */
    expiresAt: tstz('expires_at').notNull(),
    firstOpenedAt: tstz('first_opened_at'),
    exchangedAt: tstz('exchanged_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('storefront_link_tokens_hash_uk').on(t.tokenHash), index('storefront_link_tokens_tenant_idx').on(t.tenantId)],
);

export const reviews = pgTable(
  'reviews',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id'),
    rating: text('rating').$type<ReviewRating>().notNull(),
    comment: text('comment'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('reviews_order_uk').on(t.orderId),
    index('reviews_tenant_idx').on(t.tenantId, t.createdAt),
    enumCheck('reviews_rating_ck', t.rating, REVIEW_RATINGS),
  ],
);

/** Onay sonrası müşteri iptal talebi. */
export const cancellationRequests = pgTable(
  'cancellation_requests',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    requestedAt: tstz('requested_at').notNull().defaultNow(),
    reason: text('reason'),
    status: text('status').$type<CancellationRequestStatus>().notNull().default('pending'),
    decidedByUserId: uuid('decided_by_user_id'),
    decidedAt: tstz('decided_at'),
  },
  (t) => [
    uniqueIndex('cancellation_requests_pending_uk').on(t.orderId).where(sql`status = 'pending'`),
    index('cancellation_requests_tenant_idx').on(t.tenantId),
    enumCheck('cancellation_requests_status_ck', t.status, CANCELLATION_REQUEST_STATUSES),
  ],
);
