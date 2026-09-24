// Admin ve herkese açık uç noktaların sözleşmeleri (14 §6.4, §6.5). API doğrular, web tipleri buradan alır.
// Yanıtlarda son müşteri adı/telefonu/adresi yoktur (05 §A.1 #9); sır/anahtar alanı yoktur (05 §A.1 #8).

import { z } from 'zod';
import {
  CANCEL_REASONS,
  CANCELLED_BY,
  FEATURE_FLAG_KINDS,
  FULFILLMENT_TYPES,
  JOB_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LIFECYCLE_STAGES,
  ORDER_CHANNELS,
  ORDER_STATUSES,
  ORDERING_STATES,
  PLAN_CODES,
  QUEUES,
  REJECTION_REASONS,
  SUBSCRIPTION_STATUSES,
  SUSPENSION_REASONS,
  TENANT_ROLES,
  TEST_KINDS,
  WA_ACCOUNT_STATUSES,
  WA_PROVIDERS,
} from '../enums';
import { SUPPORT_NOTE_TAGS } from './support-tags';

const id = z.uuid();
const iso = z.string();
const isoOrNull = z.string().nullable();
const int = z.number().int();

/** Admin yazmalarında gerekçe (05 §A.1 #6). */
export const adminReasonSchema = z
  .string()
  .trim()
  .min(10, 'Gerekçe en az 10 karakter olmalı.')
  .max(500, 'Gerekçe en fazla 500 karakter olabilir.');

const isoInput = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Geçerli bir tarih girin.');

/** Sayfalama (liste yanıtı `{items, nextCursor?}`). */
export const adminCursorQuerySchema = z.object({
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ---------------------------------------------------------------------------
// Özet (A-02)

export const adminOverviewSchema = z.object({
  generatedAt: iso,
  tenantsTotal: int,
  tenantsByStage: z.record(z.enum(LIFECYCLE_STAGES), int),
  newTenants7d: int,
  ordersToday: int,
  revenueTodayKurus: int,
  openNewOrders: int,
  lateNewOrders: int,
  missedOrders24h: int,
  failedJobs: int,
  pendingJobs: int,
  oldestPendingJobAgeSec: int.nullable(),
  waErrorAccounts: int,
  waSilentAccounts: int,
  leadsTotal: int,
  leadsNew: int,
  alerts: z.object({
    missedOrders: z.array(
      z.object({ orderId: id, tenantId: id, tenantName: z.string(), number: int, cancelledAt: isoOrNull }),
    ),
    waProblems: z.array(
      z.object({
        waAccountId: id,
        tenantId: id,
        tenantName: z.string(),
        status: z.enum(WA_ACCOUNT_STATUSES),
        lastError: z.string().nullable(),
        lastWebhookAt: isoOrNull,
        silent: z.boolean(),
      }),
    ),
    failedJobs: z.array(
      z.object({
        id,
        queue: z.string(),
        type: z.string(),
        lastError: z.string().nullable(),
        tenantId: id.nullable(),
        tenantName: z.string().nullable(),
        updatedAt: iso,
      }),
    ),
    newLeads: z.array(
      z.object({
        id,
        name: z.string().nullable(),
        businessName: z.string().nullable(),
        city: z.string().nullable(),
        source: z.string(),
        createdAt: iso,
      }),
    ),
  }),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

// ---------------------------------------------------------------------------
// İşletmeler (A-03, A-04)

export const adminTenantListQuerySchema = adminCursorQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  stage: z.enum(LIFECYCLE_STAGES).optional(),
});

export const adminTenantListItemSchema = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  lifecycleStage: z.enum(LIFECYCLE_STAGES),
  planCode: z.enum(PLAN_CODES),
  suspensionReason: z.enum(SUSPENSION_REASONS).nullable(),
  orderingEnabled: z.boolean(),
  isDemo: z.boolean(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  trialEndsAt: isoOrNull,
  liveAt: isoOrNull,
  createdAt: iso,
  lastOrderAt: isoOrNull,
  orders7d: int,
  waStatus: z.enum(WA_ACCOUNT_STATUSES).nullable(),
});
export type AdminTenantListItem = z.infer<typeof adminTenantListItemSchema>;

export const adminTenantListResponseSchema = z.object({
  items: z.array(adminTenantListItemSchema),
  nextCursor: z.string().optional(),
});
export type AdminTenantListResponse = z.infer<typeof adminTenantListResponseSchema>;

/** Admin sipariş satırı: müşteri adı/telefonu/adresi yok. */
export const adminOrderRowSchema = z.object({
  id,
  number: int,
  branchId: id,
  status: z.enum(ORDER_STATUSES),
  channel: z.enum(ORDER_CHANNELS),
  fulfillmentType: z.enum(FULFILLMENT_TYPES),
  totalKurus: int,
  testKind: z.enum(TEST_KINDS).nullable(),
  placedAt: iso,
  acceptedAt: isoOrNull,
  /** new → accepted süresi (sn) */
  approvalSeconds: int.nullable(),
  rejectionReason: z.enum(REJECTION_REASONS).nullable(),
  cancelReason: z.enum(CANCEL_REASONS).nullable(),
  cancelledBy: z.enum(CANCELLED_BY).nullable(),
});
export type AdminOrderRow = z.infer<typeof adminOrderRowSchema>;

export const adminTenantOrdersQuerySchema = adminCursorQuerySchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
});
export const adminTenantOrdersResponseSchema = z.object({
  items: z.array(adminOrderRowSchema),
  nextCursor: z.string().optional(),
});
export type AdminTenantOrdersResponse = z.infer<typeof adminTenantOrdersResponseSchema>;

export const adminWaAccountSchema = z.object({
  id,
  tenantId: id,
  tenantName: z.string(),
  tenantSlug: z.string(),
  branchId: id,
  branchName: z.string(),
  provider: z.enum(WA_PROVIDERS),
  /** Numara maskeli (05 A-06) */
  displayPhoneMasked: z.string().nullable(),
  status: z.enum(WA_ACCOUNT_STATUSES),
  lastWebhookAt: isoOrNull,
  lastError: z.string().nullable(),
  inbound24h: int,
  outbound24h: int,
  failed24h: int,
  /** Açık saatte 2 saattir webhook yok */
  silent: z.boolean(),
  /** Şube şu an çalışma saatinde mi */
  branchOpen: z.boolean(),
  health: z.enum(['red', 'yellow', 'green']),
});
export type AdminWaAccount = z.infer<typeof adminWaAccountSchema>;

export const adminWaListQuerySchema = z.object({
  problems: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});
export const adminWaListResponseSchema = z.object({
  items: z.array(adminWaAccountSchema),
  summary: z.object({ total: int, red: int, yellow: int, green: int, silent: int }),
});
export type AdminWaListResponse = z.infer<typeof adminWaListResponseSchema>;

export const adminNoteSchema = z.object({
  id,
  tenantId: id,
  body: z.string(),
  tags: z.array(z.string()),
  authorUserId: id.nullable(),
  authorName: z.string().nullable(),
  createdAt: iso,
});
export type AdminNote = z.infer<typeof adminNoteSchema>;

const noteTagSchema = z.string().refine((t) => SUPPORT_NOTE_TAGS.includes(t), 'Bilinmeyen etiket.');

export const adminNoteCreateSchema = z.object({
  body: z.string().trim().min(1, 'Not boş olamaz.').max(4000, 'Not en fazla 4000 karakter olabilir.'),
  tags: z.array(noteTagSchema).max(12).default([]),
});
export type AdminNoteCreate = z.input<typeof adminNoteCreateSchema>;

export const adminNoteUpdateSchema = z
  .object({
    body: z.string().trim().min(1, 'Not boş olamaz.').max(4000).optional(),
    tags: z.array(noteTagSchema).max(12).optional(),
  })
  .refine((v) => v.body !== undefined || v.tags !== undefined, 'Değiştirilecek alan yok.');
export type AdminNoteUpdate = z.input<typeof adminNoteUpdateSchema>;

export const adminNotesResponseSchema = z.object({ items: z.array(adminNoteSchema) });

export const adminSubscriptionSchema = z.object({
  id,
  planCode: z.enum(PLAN_CODES),
  status: z.enum(SUBSCRIPTION_STATUSES),
  trialEndsAt: isoOrNull,
  currentPeriodEnd: isoOrNull,
  founderDiscountBp: int.nullable(),
  notes: z.string().nullable(),
  updatedAt: iso,
});

export const adminTenantDetailSchema = z.object({
  tenant: z.object({
    id,
    name: z.string(),
    slug: z.string(),
    legalName: z.string().nullable(),
    taxNo: z.string().nullable(),
    taxOffice: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    lifecycleStage: z.enum(LIFECYCLE_STAGES),
    suspensionReason: z.enum(SUSPENSION_REASONS).nullable(),
    orderingEnabled: z.boolean(),
    smsFallbackEnabled: z.boolean(),
    botEnabled: z.boolean(),
    planCode: z.enum(PLAN_CODES),
    trialEndsAt: isoOrNull,
    liveAt: isoOrNull,
    webLiveAt: isoOrNull,
    isDemo: z.boolean(),
    createdAt: iso,
    updatedAt: iso,
  }),
  subscription: adminSubscriptionSchema.nullable(),
  branches: z.array(
    z.object({
      id,
      name: z.string(),
      city: z.string(),
      district: z.string(),
      neighborhood: z.string().nullable(),
      phone: z.string().nullable(),
      orderingState: z.enum(ORDERING_STATES),
      isOpenBySchedule: z.boolean(),
      pausedUntil: isoOrNull,
      busyExtraMinutes: int,
      acceptsDelivery: z.boolean(),
      acceptsPickup: z.boolean(),
    }),
  ),
  members: z.array(
    z.object({
      userId: id,
      name: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      role: z.enum(TENANT_ROLES),
      branchId: id.nullable(),
      lastLoginAt: isoOrNull,
      disabled: z.boolean(),
      hasTotp: z.boolean(),
    }),
  ),
  waAccounts: z.array(adminWaAccountSchema),
  recentOrders: z.array(adminOrderRowSchema),
  stats: z.object({
    ordersTotal: int,
    orders7d: int,
    lastOrderAt: isoOrNull,
    delivered30d: int,
    revenue30dKurus: int,
    missed30d: int,
  }),
  notes: z.array(adminNoteSchema),
  activeImpersonations: z.array(z.object({ sessionId: id, impersonatorName: z.string().nullable(), expiresAt: iso })),
  allowedLifecycleTransitions: z.array(z.enum(LIFECYCLE_STAGES)),
});
export type AdminTenantDetail = z.infer<typeof adminTenantDetailSchema>;

export const adminTenantPatchSchema = z.object({
  reason: adminReasonSchema,
  planCode: z.enum(PLAN_CODES).optional(),
  lifecycleStage: z.enum(LIFECYCLE_STAGES).optional(),
  suspensionReason: z.enum(SUSPENSION_REASONS).nullable().optional(),
  orderingEnabled: z.boolean().optional(),
  trialEndsAt: isoInput.nullable().optional(),
  subscription: z
    .object({
      status: z.enum(SUBSCRIPTION_STATUSES).optional(),
      founderDiscountBp: z.number().int().min(0).max(10000).nullable().optional(),
    })
    .optional(),
});
export type AdminTenantPatch = z.input<typeof adminTenantPatchSchema>;

// ---------------------------------------------------------------------------
// Impersonation (A-09; 00 §4)

export const adminImpersonateRequestSchema = z.object({
  reason: adminReasonSchema,
  /** Destek kaydı / not numarası */
  ticketRef: z.string().trim().max(60).optional(),
});
export type AdminImpersonateRequest = z.input<typeof adminImpersonateRequestSchema>;

export const adminImpersonateResponseSchema = z.object({
  ok: z.literal(true),
  sessionId: id,
  tenantId: id,
  readOnly: z.literal(true),
  expiresAt: iso,
  redirectTo: z.string(),
});
export type AdminImpersonateResponse = z.infer<typeof adminImpersonateResponseSchema>;

export const adminImpersonationEndResponseSchema = z.object({
  ok: z.literal(true),
  ended: int,
  restored: z.boolean(),
  redirectTo: z.string(),
});
export type AdminImpersonationEndResponse = z.infer<typeof adminImpersonationEndResponseSchema>;

// ---------------------------------------------------------------------------
// İşler / DLQ (A-11)

export const adminJobsQuerySchema = adminCursorQuerySchema.extend({
  status: z.enum(JOB_STATUSES).default('failed'),
  queue: z.enum(QUEUES).optional(),
  type: z.string().trim().max(100).optional(),
});

export const adminJobSchema = z.object({
  id,
  queue: z.string(),
  type: z.string(),
  status: z.enum(JOB_STATUSES),
  attempts: int,
  maxAttempts: int,
  runAt: iso,
  lastError: z.string().nullable(),
  tenantId: id.nullable(),
  tenantName: z.string().nullable(),
  dedupeKey: z.string().nullable(),
  /** Maskeli yük (telefon/adres alanları gizli) */
  payload: z.record(z.string(), z.unknown()),
  createdAt: iso,
  updatedAt: iso,
  finishedAt: isoOrNull,
});
export type AdminJob = z.infer<typeof adminJobSchema>;

export const adminJobsResponseSchema = z.object({
  items: z.array(adminJobSchema),
  nextCursor: z.string().optional(),
  counts: z.object({ pending: int, running: int, failed: int }),
});
export type AdminJobsResponse = z.infer<typeof adminJobsResponseSchema>;

// ---------------------------------------------------------------------------
// Bayraklar (A-13)

export const adminFlagSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  kind: z.enum(FEATURE_FLAG_KINDS),
  label: z.string(),
  description: z.string().nullable(),
  /** false: DB'de kayıt yok (varsayılan açık) */
  persisted: z.boolean(),
  updatedAt: isoOrNull,
  updatedByName: z.string().nullable(),
});
export type AdminFlag = z.infer<typeof adminFlagSchema>;

export const adminFlagsResponseSchema = z.object({ items: z.array(adminFlagSchema) });

export const adminFlagPatchSchema = z.object({
  key: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  /** Kill-switch kapatırken zorunlu (≥ 10 karakter) */
  reason: z.string().trim().max(500).optional(),
});
export type AdminFlagPatch = z.input<typeof adminFlagPatchSchema>;

// ---------------------------------------------------------------------------
// Lead'ler (A-20)

export const adminLeadsQuerySchema = adminCursorQuerySchema.extend({
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.string().trim().max(40).optional(),
  q: z.string().trim().max(100).optional(),
});

export const adminLeadSchema = z.object({
  id,
  name: z.string().nullable(),
  businessName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  city: z.string().nullable(),
  source: z.string(),
  status: z.enum(LEAD_STATUSES),
  notes: z.string().nullable(),
  calculatorInput: z.record(z.string(), z.unknown()).nullable(),
  tenantId: id.nullable(),
  tenantName: z.string().nullable(),
  createdAt: iso,
  updatedAt: iso,
});
export type AdminLead = z.infer<typeof adminLeadSchema>;

export const adminLeadsResponseSchema = z.object({
  items: z.array(adminLeadSchema),
  nextCursor: z.string().optional(),
  counts: z.record(z.enum(LEAD_STATUSES), int),
});
export type AdminLeadsResponse = z.infer<typeof adminLeadsResponseSchema>;

export const adminLeadPatchSchema = z
  .object({
    status: z.enum(LEAD_STATUSES).optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    /** `won` yalnız bir işletmeye bağlanarak kapanır (05 A-20) */
    tenantId: id.nullable().optional(),
    tenantSlug: z.string().trim().max(60).optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.notes !== undefined || v.tenantId !== undefined || v.tenantSlug !== undefined,
    'Değiştirilecek alan yok.',
  );
export type AdminLeadPatch = z.input<typeof adminLeadPatchSchema>;

// ---------------------------------------------------------------------------
// Denetim (A-18)

export const adminAuditQuerySchema = adminCursorQuerySchema.extend({
  tenantId: id.optional(),
  /** Aktör kullanıcı kimliği ya da e-postası */
  actor: z.string().trim().max(200).optional(),
  /** Aksiyon öneki (ör. 'admin.', 'order.') */
  action: z.string().trim().max(100).optional(),
  impersonation: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export const adminAuditEntrySchema = z.object({
  id,
  createdAt: iso,
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  tenantId: id.nullable(),
  tenantName: z.string().nullable(),
  actorUserId: id.nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  impersonatorUserId: id.nullable(),
  impersonatorName: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
});
export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>;

export const adminAuditResponseSchema = z.object({
  items: z.array(adminAuditEntrySchema),
  nextCursor: z.string().optional(),
});
export type AdminAuditResponse = z.infer<typeof adminAuditResponseSchema>;

// ---------------------------------------------------------------------------
// Herkese açık: demo talebi / hesaplayıcı lead'i (14 §6.5; 05 C.5.1, C.4.5)

export const PUBLIC_LEAD_SOURCES = ['demo_form', 'calculator'] as const satisfies readonly (typeof LEAD_SOURCES)[number][];

export const publicLeadRequestSchema = z.object({
  name: z.string().trim().min(2, 'Adını ve soyadını yaz.').max(120, 'Ad en fazla 120 karakter olabilir.'),
  businessName: z.string().trim().min(2, 'İşletmenin adını yaz.').max(160, 'İşletme adı çok uzun.'),
  phone: z.string().trim().min(10, 'Telefonu 0 (5xx) xxx xx xx biçiminde yaz.').max(30, 'Telefonu kontrol et.'),
  city: z.string().trim().min(2, 'İli yaz.').max(80, 'İl adı çok uzun.'),
  source: z.enum(PUBLIC_LEAD_SOURCES).default('demo_form'),
  notes: z.string().trim().max(2000, 'Not en fazla 2000 karakter olabilir.').optional(),
  calculatorInput: z.record(z.string(), z.unknown()).optional(),
  district: z.string().trim().max(80).optional(),
  email: z.email('Geçerli bir e-posta yaz.').max(200).optional(),
  waOptIn: z.boolean().optional(),
  /** Bal küpü: doluysa 204 döner, kayıt açılmaz. */
  website: z.string().max(500).optional(),
});
export type PublicLeadRequest = z.input<typeof publicLeadRequestSchema>;

export const publicLeadResponseSchema = z.object({ ok: z.literal(true) });

