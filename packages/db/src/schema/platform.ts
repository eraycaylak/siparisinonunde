// Platform, kiracı, kullanıcı, oturum, abonelik, admin tabloları (14 §4).

import {
  FEATURE_FLAG_KINDS,
  LEAD_STATUSES,
  LEGAL_DOCUMENTS,
  LIFECYCLE_STAGES,
  PAYMENT_METHODS,
  PLAN_CODES,
  PLATFORM_ROLES,
  SESSION_KINDS,
  SUBSCRIPTION_STATUSES,
  SUSPENSION_REASONS,
  TENANT_ROLES,
  WA_MODES,
  type FeatureFlagKind,
  type LeadStatus,
  type LegalDocument,
  type LifecycleStage,
  type MealCardBrand,
  type PaymentMethod,
  type PlanCode,
  type PlatformRole,
  type SessionKind,
  type SubscriptionStatus,
  type SuspensionReason,
  type TenantRole,
  type WaMode,
} from '@siparis/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, pk, tstz, updatedAt } from './_helpers';

export interface StatusMessagesSetting {
  received: boolean;
  accepted: boolean;
  preparing: boolean;
  ready: boolean;
  on_the_way: boolean;
  delivered: boolean;
}

export interface AlarmPolicy {
  /** 10–30 dk (00 §10) */
  auto_cancel_minutes: number;
  /** ≤ auto_cancel − 5 */
  customer_notice_minutes: number;
  platform_wa_enabled: boolean;
  sms_enabled: boolean;
}

/** branches.receipt_settings (04 §4.14 / §7.10); doğrulama şeması: core settings/contracts receiptSettingsSchema. */
export interface ReceiptSettings {
  width_mm?: 58 | 80;
  footer_text?: string;
  show_logo?: boolean;
  auto_print?: boolean;
  copies?: number;
  font_size?: 'normal' | 'large';
  show_wa_line?: boolean;
  print_kitchen?: boolean;
  print_delivery?: boolean;
}

export const DEFAULT_STATUS_MESSAGES: StatusMessagesSetting = {
  received: true,
  accepted: true,
  preparing: false,
  ready: true,
  on_the_way: true,
  delivered: true,
};

export const DEFAULT_ALARM_POLICY: AlarmPolicy = {
  auto_cancel_minutes: 15,
  customer_notice_minutes: 10,
  platform_wa_enabled: true,
  sms_enabled: true,
};

export const tenants = pgTable(
  'tenants',
  {
    id: pk(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    legalName: text('legal_name'),
    taxNo: text('tax_no'),
    taxOffice: text('tax_office'),
    phone: text('phone'),
    email: text('email'),
    /** Künye adresi */
    address: text('address'),
    lifecycleStage: text('lifecycle_stage').$type<LifecycleStage>().notNull().default('trial'),
    suspensionReason: text('suspension_reason').$type<SuspensionReason>(),
    orderingEnabled: boolean('ordering_enabled').notNull().default(true),
    smsFallbackEnabled: boolean('sms_fallback_enabled').notNull().default(true),
    botEnabled: boolean('bot_enabled').notNull().default(true),
    brandColor: text('brand_color'),
    logoUrl: text('logo_url'),
    coverUrl: text('cover_url'),
    /** Tasarruf raporu için pazaryeri kesinti oranı (baz puan; %25 = 2500) */
    marketplaceCommissionBp: integer('marketplace_commission_bp').notNull().default(2500),
    planCode: text('plan_code').$type<PlanCode>().notNull().default('esnaf'),
    trialEndsAt: tstz('trial_ends_at'),
    liveAt: tstz('live_at'),
    webLiveAt: tstz('web_live_at'),
    isDemo: boolean('is_demo').notNull().default(false),
    /**
     * Ortak numara (00 §12a madde 8; migrations/0900_shared_wa_number.sql, 0901): dükkan kodu (A–Z0–9, 3–12, en az bir
     * harf, tekil; QR'daki #KOD). Kayıtta slug'dan üretilir; yalnız platform yöneticisi değiştirir.
     */
    waCode: text('wa_code'),
    /** 'shared' (ortak platform numarası, varsayılan) | 'own' (işletmenin kendi numarası) */
    waMode: text('wa_mode').$type<WaMode>().notNull().default('shared'),
    /** Sipariş numarası sayacı; ilk sipariş 1001 */
    orderSeq: integer('order_seq').notNull().default(1000),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tenants_slug_uk').on(t.slug),
    uniqueIndex('tenants_wa_code_uk').on(t.waCode).where(sql`wa_code is not null`),
    enumCheck('tenants_wa_mode_ck', t.waMode, WA_MODES),
    // 0901: en az bir harf (yalnız rakam "#1047" sipariş numarasıyla karışır)
    check('tenants_wa_code_ck', sql`${t.waCode} is null or (${t.waCode} ~ '^[A-Z0-9]{3,12}$' and ${t.waCode} ~ '[A-Z]')`),
    index('tenants_lifecycle_idx').on(t.lifecycleStage),
    enumCheck('tenants_lifecycle_stage_ck', t.lifecycleStage, LIFECYCLE_STAGES),
    enumCheck('tenants_suspension_reason_ck', t.suspensionReason, SUSPENSION_REASONS),
    enumCheck('tenants_plan_code_ck', t.planCode, PLAN_CODES),
    check('tenants_slug_format_ck', sql`${t.slug} ~ '^[a-z0-9](-?[a-z0-9]){2,39}$'`),
    check('tenants_brand_color_ck', sql`${t.brandColor} is null or ${t.brandColor} ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

export const branches = pgTable(
  'branches',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(true),
    phone: text('phone'),
    addressLine: text('address_line'),
    neighborhood: text('neighborhood'),
    district: text('district').notNull().default('Merkez'),
    city: text('city').notNull().default('Yozgat'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    timezone: text('timezone').notNull().default('Europe/Istanbul'),
    pausedUntil: tstz('paused_until'),
    pauseReason: text('pause_reason'),
    busyExtraMinutes: integer('busy_extra_minutes').notNull().default(0),
    defaultPrepMinutes: integer('default_prep_minutes').notNull().default(20),
    usePreparingStep: boolean('use_preparing_step').notNull().default(false),
    acceptsDelivery: boolean('accepts_delivery').notNull().default(true),
    acceptsPickup: boolean('accepts_pickup').notNull().default(true),
    pickupMinOrderKurus: integer('pickup_min_order_kurus').notNull().default(0),
    paymentMethods: text('payment_methods')
      .array()
      .$type<PaymentMethod[]>()
      .notNull()
      .default(sql`'{cash_on_delivery,card_on_delivery}'::text[]`),
    mealCardBrands: text('meal_card_brands')
      .array()
      .$type<MealCardBrand[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    statusMessages: jsonb('status_messages').$type<StatusMessagesSetting>().notNull().default(DEFAULT_STATUS_MESSAGES),
    alarmPolicy: jsonb('alarm_policy').$type<AlarmPolicy>().notNull().default(DEFAULT_ALARM_POLICY),
    receiptSettings: jsonb('receipt_settings').$type<ReceiptSettings>().notNull().default({}),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('branches_tenant_idx').on(t.tenantId),
    check('branches_busy_ck', sql`${t.busyExtraMinutes} between 0 and 180`),
    check('branches_prep_ck', sql`${t.defaultPrepMinutes} between 1 and 240`),
    check('branches_payment_methods_ck', sql`${t.paymentMethods} <@ array[${sql.raw(PAYMENT_METHODS.map((m) => `'${m}'`).join(', '))}]::text[]`),
  ],
);

export const users = pgTable(
  'users',
  {
    id: pk(),
    /** Küçük harfe normalize edilmiş e-posta */
    email: text('email'),
    /** E.164 */
    phone: text('phone'),
    name: text('name').notNull(),
    /** scrypt (apps/api/src/lib/password.ts biçimi); kurye magic link kullanıyorsa boş olabilir */
    passwordHash: text('password_hash'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    platformRole: text('platform_role').$type<PlatformRole>(),
    /** Etkin TOTP sırrı (lib/encryption ile şifreli); yalnız totp_enabled_at doluysa geçerli */
    totpSecretEnc: text('totp_secret_enc'),
    /** İki adımlı doğrulama açıldığı an (null = kapalı) — 0600 */
    totpEnabledAt: tstz('totp_enabled_at'),
    /** Kurulumu süren (henüz doğrulanmamış) sır, şifreli — 0600 */
    totpPendingSecretEnc: text('totp_pending_secret_enc'),
    /** Son kabul edilen TOTP zaman adımı (floor(unix/30)); aynı ya da eski adım tekrar kabul edilmez — 0600 */
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    /** Tek kullanımlık kurtarma kodlarının SHA-256 özetleri (kod düz metin saklanmaz) — 0600 */
    totpRecoveryHashes: text('totp_recovery_hashes').array().notNull().default(sql`'{}'::text[]`),
    lastLoginAt: tstz('last_login_at'),
    disabledAt: tstz('disabled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uk').on(t.email),
    uniqueIndex('users_phone_uk').on(t.phone),
    enumCheck('users_platform_role_ck', t.platformRole, PLATFORM_ROLES),
    check('users_email_lower_ck', sql`${t.email} is null or ${t.email} = lower(${t.email})`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256(token) hex; ham token yalnız çerezde */
    tokenHash: text('token_hash').notNull(),
    kind: text('kind').$type<SessionKind>().notNull().default('user'),
    /** Seçili tenant */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    expiresAt: tstz('expires_at').notNull(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    impersonatorUserId: uuid('impersonator_user_id').references(() => users.id, { onDelete: 'set null' }),
    impersonationReason: text('impersonation_reason'),
    readOnly: boolean('read_only').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uk').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
    enumCheck('sessions_kind_ck', t.kind, SESSION_KINDS),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<TenantRole>().notNull(),
    /** null = tüm şubeler */
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    disabledAt: tstz('disabled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('memberships_tenant_user_uk').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
    enumCheck('memberships_role_ck', t.role, TENANT_ROLES),
  ],
);

export const courierLoginLinks = pgTable(
  'courier_login_links',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    /** Oluşturma + 15 dk */
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    createdByUserId: uuid('created_by_user_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('courier_login_links_token_uk').on(t.tokenHash), index('courier_login_links_tenant_idx').on(t.tenantId)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    planCode: text('plan_code').$type<PlanCode>().notNull(),
    status: text('status').$type<SubscriptionStatus>().notNull(),
    trialEndsAt: tstz('trial_ends_at'),
    currentPeriodEnd: tstz('current_period_end'),
    /** Kurucu üye indirimi (%30 = 3000) */
    founderDiscountBp: integer('founder_discount_bp'),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('subscriptions_tenant_active_uk').on(t.tenantId).where(sql`status <> 'cancelled'`),
    enumCheck('subscriptions_plan_code_ck', t.planCode, PLAN_CODES),
    enumCheck('subscriptions_status_ck', t.status, SUBSCRIPTION_STATUSES),
  ],
);

export const featureFlags = pgTable(
  'feature_flags',
  {
    key: text('key').primaryKey(),
    enabled: boolean('enabled').notNull().default(true),
    kind: text('kind').$type<FeatureFlagKind>().notNull(),
    description: text('description'),
    updatedByUserId: uuid('updated_by_user_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [enumCheck('feature_flags_kind_ck', t.kind, FEATURE_FLAG_KINDS)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: pk(),
    tenantId: uuid('tenant_id'),
    actorUserId: uuid('actor_user_id'),
    impersonatorUserId: uuid('impersonator_user_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt), index('audit_log_action_idx').on(t.action)],
);

export const adminNotes = pgTable(
  'admin_notes',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id'),
    body: text('body').notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [index('admin_notes_tenant_idx').on(t.tenantId, t.createdAt)],
);

export const leads = pgTable(
  'leads',
  {
    id: pk(),
    name: text('name'),
    businessName: text('business_name'),
    phone: text('phone'),
    email: text('email'),
    city: text('city'),
    source: text('source').notNull().default('demo_form'),
    calculatorInput: jsonb('calculator_input').$type<Record<string, unknown>>(),
    status: text('status').$type<LeadStatus>().notNull().default('new'),
    notes: text('notes'),
    tenantId: uuid('tenant_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('leads_status_idx').on(t.status, t.createdAt), enumCheck('leads_status_ck', t.status, LEAD_STATUSES)],
);

export const legalAcceptances = pgTable(
  'legal_acceptances',
  {
    id: pk(),
    userId: uuid('user_id'),
    tenantId: uuid('tenant_id'),
    orderId: uuid('order_id'),
    document: text('document').$type<LegalDocument>().notNull(),
    version: text('version').notNull(),
    acceptedAt: tstz('accepted_at').notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('legal_acceptances_tenant_idx').on(t.tenantId),
    index('legal_acceptances_order_idx').on(t.orderId),
    enumCheck('legal_acceptances_document_ck', t.document, LEGAL_DOCUMENTS),
    check('legal_acceptances_subject_ck', sql`${t.userId} is not null or ${t.orderId} is not null or ${t.tenantId} is not null`),
  ],
);
