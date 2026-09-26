// Dilim 4 API sözleşmeleri (14 §6.3: Ayarlar, Personel, Müşteri, Rapor, Onboarding).
// Web ve API aynı şemaları kullanır. Kök alanlar camelCase; branches jsonb ayarları (statusMessages,
// alarmPolicy, receiptSettings) saklandıkları gibi snake_case anahtarlıdır.

import { z } from 'zod';
import {
  MEAL_CARD_BRANDS,
  PHASE1_PAYMENT_METHODS,
  lifecycleStageSchema,
  orderChannelSchema,
  orderStatusSchema,
  orderingStateSchema,
  planCodeSchema,
  tenantRoleSchema,
  fulfillmentTypeSchema,
  paymentMethodSchema,
  deliveryZoneKindSchema,
  testKindSchema,
} from '../enums';
import { DATE_PATTERN, HEX_COLOR_PATTERN, MARKETPLACE_COMMISSION_BP_MAX, PREP_MINUTES_LIMITS } from './validation';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmmSchema = z.string().regex(HHMM, 'Saat SS:DD biçiminde olmalı (ör. 11:00).');
const dateSchema = z.string().regex(DATE_PATTERN, 'Tarih YYYY-AA-GG biçiminde olmalı.');
const iso = z.string();
const isoNullable = z.string().nullable();
const uuid = z.uuid();

/** Görsel adresi: yüklenen dosya (/api/v1/uploads/…) ya da http(s) bağlantısı. */
export const imageUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('/api/v1/uploads/') || /^https?:\/\/\S+$/i.test(v), 'Geçerli bir görsel adresi girin.');

const optionalText = (max: number, min = 1) => z.string().trim().min(min, `En az ${min} karakter girin.`).max(max, `En fazla ${max} karakter.`);

// ---------------------------------------------------------------------------
// İşletme (tenant)

export const tenantSettingsSchema = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  legalName: z.string().nullable(),
  taxNo: z.string().nullable(),
  taxOffice: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  brandColor: z.string().nullable(),
  logoUrl: z.string().nullable(),
  coverUrl: z.string().nullable(),
  marketplaceCommissionBp: z.number().int(),
  lifecycleStage: lifecycleStageSchema,
  planCode: planCodeSchema,
  trialEndsAt: isoNullable,
  liveAt: isoNullable,
  webLiveAt: isoNullable,
  orderingEnabled: z.boolean(),
  /** Künye eksik alanları (08 §4.7) — boşsa tam */
  imprintMissing: z.array(z.string()),
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export const tenantPatchSchema = z
  .object({
    name: optionalText(80, 2).optional(),
    phone: z.string().trim().max(20).nullable().optional(),
    email: z.email('Geçerli bir e-posta girin.').trim().max(254).nullable().optional(),
    legalName: optionalText(160, 2).nullable().optional(),
    taxNo: z
      .string()
      .trim()
      .regex(/^\d{10,11}$/, 'Vergi/T.C. kimlik no 10 ya da 11 haneli olmalı.')
      .nullable()
      .optional(),
    taxOffice: optionalText(80, 2).nullable().optional(),
    address: optionalText(300, 5).nullable().optional(),
    brandColor: z.string().regex(HEX_COLOR_PATTERN, 'Renk #RRGGBB biçiminde olmalı.').nullable().optional(),
    logoUrl: imageUrlSchema.nullable().optional(),
    coverUrl: imageUrlSchema.nullable().optional(),
    marketplaceCommissionBp: z
      .number()
      .int()
      .min(0, 'Oran %0 ile %60 arasında olmalı.')
      .max(MARKETPLACE_COMMISSION_BP_MAX, 'Oran %0 ile %60 arasında olmalı.')
      .optional(),
    slug: z.string().trim().toLowerCase().min(3, 'Adres en az 3 karakter olmalı.').max(40, 'Adres en fazla 40 karakter.').optional(),
  })
  .strict();
export type TenantPatch = z.infer<typeof tenantPatchSchema>;

// ---------------------------------------------------------------------------
// Şube

export const statusMessagesSchema = z.object({
  received: z.boolean(),
  accepted: z.boolean(),
  preparing: z.boolean(),
  ready: z.boolean(),
  on_the_way: z.boolean(),
  delivered: z.boolean(),
});
export type StatusMessages = z.infer<typeof statusMessagesSchema>;
/** Kapatılamayan durum mesajları (04 §7.8). */
export const LOCKED_STATUS_MESSAGES = ['received', 'accepted'] as const;

export const alarmPolicySchema = z.object({
  auto_cancel_minutes: z.number().int(),
  customer_notice_minutes: z.number().int(),
  platform_wa_enabled: z.boolean(),
  sms_enabled: z.boolean(),
});
export type AlarmPolicyDto = z.infer<typeof alarmPolicySchema>;

export const alarmPolicyPatchSchema = z
  .object({
    auto_cancel_minutes: z.number().int().optional(),
    customer_notice_minutes: z.number().int().optional(),
    platform_wa_enabled: z.boolean().optional(),
    sms_enabled: z.boolean().optional(),
    /** t=0 panel sesi + Web Push — kapatılamaz (00 §10); false → 400 */
    panel_alarm_enabled: z.boolean().optional(),
    /** t=60 sn ses tekrarı — kapatılamaz; false → 400 */
    repeat_alarm_enabled: z.boolean().optional(),
  })
  .strict();

export const RECEIPT_FONT_SIZES = ['normal', 'large'] as const;
export const receiptSettingsSchema = z.object({
  width_mm: z.union([z.literal(58), z.literal(80)]).optional(),
  footer_text: z.string().max(200).optional(),
  show_logo: z.boolean().optional(),
  auto_print: z.boolean().optional(),
  copies: z.number().int().min(1).max(3).optional(),
  font_size: z.enum(RECEIPT_FONT_SIZES).optional(),
  show_wa_line: z.boolean().optional(),
  print_kitchen: z.boolean().optional(),
  print_delivery: z.boolean().optional(),
});
export type ReceiptSettingsDto = z.infer<typeof receiptSettingsSchema>;
export const DEFAULT_RECEIPT_SETTINGS: Required<ReceiptSettingsDto> = {
  width_mm: 80,
  footer_text: '',
  show_logo: true,
  auto_print: true,
  copies: 1,
  font_size: 'normal',
  show_wa_line: true,
  print_kitchen: true,
  print_delivery: true,
};

export const branchStateSchema = z.object({
  orderingState: orderingStateSchema,
  pausedUntil: isoNullable,
  busyExtraMinutes: z.number().int(),
  nextOpenAt: isoNullable,
  closesAt: isoNullable,
  isOpenBySchedule: z.boolean(),
});
export type BranchState = z.infer<typeof branchStateSchema>;

export const openingHourDtoSchema = z.object({ weekday: z.number().int(), opensAt: z.string(), closesAt: z.string() });
export type OpeningHourDto = z.infer<typeof openingHourDtoSchema>;

export const specialDayDtoSchema = z.object({
  id: uuid,
  date: z.string(),
  isClosed: z.boolean(),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  note: z.string().nullable(),
});
export type SpecialDayDto = z.infer<typeof specialDayDtoSchema>;

export const branchSettingsSchema = z.object({
  id: uuid,
  name: z.string(),
  phone: z.string().nullable(),
  addressLine: z.string().nullable(),
  neighborhood: z.string().nullable(),
  district: z.string(),
  city: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  timezone: z.string(),
  acceptsDelivery: z.boolean(),
  acceptsPickup: z.boolean(),
  pickupMinOrderKurus: z.number().int(),
  defaultPrepMinutes: z.number().int(),
  usePreparingStep: z.boolean(),
  paymentMethods: z.array(z.string()),
  mealCardBrands: z.array(z.string()),
  statusMessages: statusMessagesSchema,
  alarmPolicy: alarmPolicySchema,
  receiptSettings: receiptSettingsSchema,
  state: branchStateSchema,
  hours: z.array(openingHourDtoSchema),
  specialDays: z.array(specialDayDtoSchema),
});
export type BranchSettings = z.infer<typeof branchSettingsSchema>;

export const branchListItemSchema = z.object({ id: uuid, name: z.string(), isDefault: z.boolean(), state: branchStateSchema });

export const branchPatchSchema = z
  .object({
    name: optionalText(60, 2).optional(),
    phone: z.string().trim().max(20).nullable().optional(),
    addressLine: optionalText(300, 5).nullable().optional(),
    neighborhood: optionalText(60, 2).nullable().optional(),
    district: optionalText(60, 2).optional(),
    city: optionalText(60, 2).optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    acceptsDelivery: z.boolean().optional(),
    acceptsPickup: z.boolean().optional(),
    pickupMinOrderKurus: z.number().int().min(0).max(10_000_000).optional(),
    defaultPrepMinutes: z
      .number()
      .int()
      .min(PREP_MINUTES_LIMITS.min, `Hazırlık süresi ${PREP_MINUTES_LIMITS.min}–${PREP_MINUTES_LIMITS.max} dk olmalı.`)
      .max(PREP_MINUTES_LIMITS.max, `Hazırlık süresi ${PREP_MINUTES_LIMITS.min}–${PREP_MINUTES_LIMITS.max} dk olmalı.`)
      .optional(),
    usePreparingStep: z.boolean().optional(),
    paymentMethods: z.array(z.enum(PHASE1_PAYMENT_METHODS)).max(10).optional(),
    mealCardBrands: z.array(z.enum(MEAL_CARD_BRANDS)).max(10).optional(),
    statusMessages: statusMessagesSchema.partial().strict().optional(),
    alarmPolicy: alarmPolicyPatchSchema.optional(),
    receiptSettings: receiptSettingsSchema.strict().optional(),
  })
  .strict();
export type BranchPatch = z.infer<typeof branchPatchSchema>;

export const hoursPutSchema = z.object({
  days: z
    .array(
      z.object({
        weekday: z.number().int(),
        intervals: z.array(z.object({ opensAt: z.string(), closesAt: z.string() })).max(10),
      }),
    )
    .max(7),
});
export type HoursPut = z.infer<typeof hoursPutSchema>;

export const specialDayCreateSchema = z
  .object({
    date: dateSchema,
    /** Aralık ("Tadilat: 1–5 Ekim"), en çok 60 gün */
    endDate: dateSchema.optional(),
    isClosed: z.boolean(),
    opensAt: hhmmSchema.nullable().optional(),
    closesAt: hhmmSchema.nullable().optional(),
    note: z.string().trim().max(80).nullable().optional(),
  })
  .strict();
export type SpecialDayCreate = z.infer<typeof specialDayCreateSchema>;

export const specialDayPatchSchema = z
  .object({
    isClosed: z.boolean().optional(),
    opensAt: hhmmSchema.nullable().optional(),
    closesAt: hhmmSchema.nullable().optional(),
    note: z.string().trim().max(80).nullable().optional(),
  })
  .strict();

/** POST /branches/:id/pause — dakika (1–1440), null = yeniden aç, 'until_close' = kapanışa kadar, 'end_of_day' = bugün. */
export const pauseRequestSchema = z.object({
  minutes: z.union([z.number().int().min(1).max(1440), z.literal('until_close'), z.literal('end_of_day'), z.null()]),
  reason: z.string().trim().max(140).optional(),
});
export type PauseRequest = z.infer<typeof pauseRequestSchema>;

export const busyRequestSchema = z.object({ extraMinutes: z.number().int().min(0).max(120) });
export type BusyRequest = z.infer<typeof busyRequestSchema>;

// ---------------------------------------------------------------------------
// Teslimat bölgeleri

export const geoJsonPolygonInputSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.array(z.number()))),
});

export const zoneDtoSchema = z.object({
  id: uuid,
  branchId: uuid,
  name: z.string(),
  kind: deliveryZoneKindSchema,
  neighborhoods: z.array(z.string()),
  polygon: geoJsonPolygonInputSchema.nullable(),
  radiusM: z.number().int().nullable(),
  feeKurus: z.number().int(),
  minOrderKurus: z.number().int(),
  etaMinutes: z.number().int(),
  isActive: z.boolean(),
  sort: z.number().int(),
});
export type ZoneDto = z.infer<typeof zoneDtoSchema>;

const zoneBase = {
  name: optionalText(60, 1),
  kind: deliveryZoneKindSchema,
  neighborhoods: z.array(z.string().max(80)).max(300).optional(),
  polygon: geoJsonPolygonInputSchema.nullable().optional(),
  radiusM: z.number().int().nullable().optional(),
  feeKurus: z.number().int().min(0, 'Ücret negatif olamaz.').max(10_000_000),
  minOrderKurus: z.number().int().min(0, 'Minimum sepet negatif olamaz.').max(10_000_000),
  etaMinutes: z.number().int().min(0, 'Süre negatif olamaz.').max(600),
  isActive: z.boolean().optional(),
  sort: z.number().int().min(0).max(10_000).optional(),
};

export const zoneCreateSchema = z.object({ branchId: uuid.optional(), ...zoneBase }).strict();
export type ZoneCreate = z.infer<typeof zoneCreateSchema>;
export const zonePatchSchema = z
  .object({
    name: zoneBase.name.optional(),
    kind: zoneBase.kind.optional(),
    neighborhoods: zoneBase.neighborhoods,
    polygon: zoneBase.polygon,
    radiusM: zoneBase.radiusM,
    feeKurus: zoneBase.feeKurus.optional(),
    minOrderKurus: zoneBase.minOrderKurus.optional(),
    etaMinutes: zoneBase.etaMinutes.optional(),
    isActive: zoneBase.isActive,
    sort: zoneBase.sort,
  })
  .strict();
export type ZonePatch = z.infer<typeof zonePatchSchema>;

export const zoneCheckRequestSchema = z.object({
  branchId: uuid.optional(),
  neighborhood: z.string().trim().max(80).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
export const zoneCheckResponseSchema = z.object({
  match: z
    .object({
      zoneId: uuid,
      zoneName: z.string(),
      neighborhood: z.string().nullable(),
      via: deliveryZoneKindSchema,
      distanceM: z.number().nullable(),
      feeKurus: z.number().int(),
      minOrderKurus: z.number().int(),
      etaMinutes: z.number().int(),
    })
    .nullable(),
});

// ---------------------------------------------------------------------------
// Personel ve kuryeler

export const STAFF_ASSIGNABLE_ROLES = ['manager', 'cashier', 'kitchen', 'courier'] as const;
export const staffRoleSchema = z.enum(STAFF_ASSIGNABLE_ROLES);

export const staffDtoSchema = z.object({
  userId: uuid,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: tenantRoleSchema,
  branchId: uuid.nullable(),
  disabled: z.boolean(),
  lastLoginAt: isoNullable,
  createdAt: iso,
  isSelf: z.boolean(),
  /** Başka işletmelerde de üye: ad/parola buradan değiştirilemez */
  sharedAccount: z.boolean(),
});
export type StaffDto = z.infer<typeof staffDtoSchema>;

export const staffCreateSchema = z
  .object({
    name: optionalText(80, 2),
    email: z.email('Geçerli bir e-posta girin.').trim().max(254).optional(),
    phone: z.string().trim().max(20).optional(),
    role: staffRoleSchema,
    password: z.string().min(8, 'Parola en az 8 karakter olmalı.').max(200).optional(),
    branchId: uuid.nullable().optional(),
  })
  .strict();
export type StaffCreate = z.infer<typeof staffCreateSchema>;

export const staffPatchSchema = z
  .object({
    name: optionalText(80, 2).optional(),
    role: tenantRoleSchema.optional(),
    password: z.string().min(8, 'Parola en az 8 karakter olmalı.').max(200).optional(),
    disabled: z.boolean().optional(),
    branchId: uuid.nullable().optional(),
  })
  .strict();
export type StaffPatch = z.infer<typeof staffPatchSchema>;

export const courierLoginLinkResponseSchema = z.object({ url: z.string(), expiresAt: iso });
export type CourierLoginLink = z.infer<typeof courierLoginLinkResponseSchema>;

export const courierDtoSchema = z.object({
  userId: uuid,
  name: z.string(),
  phone: z.string().nullable(),
  disabled: z.boolean(),
  lastLoginAt: isoNullable,
  activeSession: z.boolean(),
  deliveredToday: z.number().int(),
  activeOrders: z.array(
    z.object({
      id: uuid,
      number: z.number().int(),
      status: orderStatusSchema,
      neighborhood: z.string().nullable(),
      customerName: z.string().nullable(),
      totalKurus: z.number().int(),
      paymentMethod: paymentMethodSchema,
      placedAt: iso,
    }),
  ),
});
export type CourierDto = z.infer<typeof courierDtoSchema>;

// ---------------------------------------------------------------------------
// Müşteriler

export const customerListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const customerListItemSchema = z.object({
  id: uuid,
  name: z.string().nullable(),
  phoneMasked: z.string().nullable(),
  orderCount: z.number().int(),
  lastOrderAt: isoNullable,
  totalSpentKurus: z.number().int(),
  avgBasketKurus: z.number().int(),
  isBlocked: z.boolean(),
  hasNotes: z.boolean(),
  hasWhatsapp: z.boolean(),
});
export type CustomerListItem = z.infer<typeof customerListItemSchema>;

export const customerAddressDtoSchema = z.object({
  id: uuid,
  label: z.string().nullable(),
  neighborhood: z.string().nullable(),
  addressLine: z.string().nullable(),
  directions: z.string().nullable(),
  lastUsedAt: isoNullable,
});

export const customerDetailSchema = z.object({
  id: uuid,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  phoneMasked: z.string().nullable(),
  waUsername: z.string().nullable(),
  hasWhatsapp: z.boolean(),
  notes: z.string().nullable(),
  isBlocked: z.boolean(),
  orderCount: z.number().int(),
  firstOrderAt: isoNullable,
  lastOrderAt: isoNullable,
  totalSpentKurus: z.number().int(),
  avgBasketKurus: z.number().int(),
  preferredFulfillment: fulfillmentTypeSchema.nullable(),
  preferredPaymentMethod: paymentMethodSchema.nullable(),
  topProducts: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
  addresses: z.array(customerAddressDtoSchema),
  openOrderCount: z.number().int(),
  createdAt: iso,
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

export const customerPatchSchema = z
  .object({
    notes: z.string().trim().max(140, 'Not en fazla 140 karakter.').nullable().optional(),
    isBlocked: z.boolean().optional(),
    /** Kara listeye alırken zorunlu (04 §2.4) */
    blockReason: z.string().trim().min(3, 'Kara liste sebebini yazın.').max(140).optional(),
  })
  .strict();
export type CustomerPatch = z.infer<typeof customerPatchSchema>;

export const customerOrderItemSchema = z.object({
  id: uuid,
  number: z.number().int(),
  status: orderStatusSchema,
  channel: orderChannelSchema,
  fulfillmentType: fulfillmentTypeSchema,
  totalKurus: z.number().int(),
  itemCount: z.number().int(),
  placedAt: iso,
  items: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
});
export type CustomerOrderItem = z.infer<typeof customerOrderItemSchema>;

// ---------------------------------------------------------------------------
// Raporlar

export const dailyReportSchema = z.object({
  date: z.string(),
  from: iso,
  to: iso,
  byStatus: z.record(z.string(), z.number().int()),
  receivedCount: z.number().int(),
  deliveredCount: z.number().int(),
  revenueKurus: z.number().int(),
  deliveryFeeKurus: z.number().int(),
  avgBasketKurus: z.number().int(),
  rejectedCount: z.number().int(),
  rejectedKurus: z.number().int(),
  cancelledCount: z.number().int(),
  cancelledKurus: z.number().int(),
  missedCount: z.number().int(),
  rejectionReasons: z.array(z.object({ reason: z.string(), count: z.number().int() })),
  cancelReasons: z.array(z.object({ reason: z.string(), count: z.number().int() })),
  byPaymentMethod: z.array(
    z.object({ paymentMethod: paymentMethodSchema, mealCardBrand: z.string().nullable(), count: z.number().int(), totalKurus: z.number().int() }),
  ),
  byChannel: z.array(z.object({ channel: orderChannelSchema, count: z.number().int(), revenueKurus: z.number().int() })),
  byCourier: z.array(
    z.object({
      courierUserId: uuid.nullable(),
      name: z.string().nullable(),
      deliveredCount: z.number().int(),
      cashKurus: z.number().int(),
      cardKurus: z.number().int(),
      mealCardKurus: z.number().int(),
    }),
  ),
  topProducts: z.array(z.object({ name: z.string(), quantity: z.number().int(), revenueKurus: z.number().int() })),
  avgAckSeconds: z.number().int().nullable(),
  slowAckCount: z.number().int(),
});
export type DailyReport = z.infer<typeof dailyReportSchema>;

export const summaryReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  totals: z.object({ receivedCount: z.number().int(), deliveredCount: z.number().int(), revenueKurus: z.number().int(), avgBasketKurus: z.number().int() }),
  previous: z.object({ receivedCount: z.number().int(), deliveredCount: z.number().int(), revenueKurus: z.number().int() }),
  series: z.array(z.object({ date: z.string(), receivedCount: z.number().int(), deliveredCount: z.number().int(), revenueKurus: z.number().int() })),
  byChannel: z.array(z.object({ channel: orderChannelSchema, count: z.number().int(), revenueKurus: z.number().int() })),
  /** heatmap[weekday 0=Pazar][hour 0–23] = sipariş sayısı (Europe/Istanbul) */
  heatmap: z.array(z.array(z.number().int())),
  topProducts: z.array(z.object({ name: z.string(), quantity: z.number().int(), revenueKurus: z.number().int() })),
});
export type SummaryReport = z.infer<typeof summaryReportSchema>;

export const savingsReportSchema = z.object({
  month: z.string(),
  orderCount: z.number().int(),
  basketTotalKurus: z.number().int(),
  commissionBp: z.number().int(),
  avoidedCommissionKurus: z.number().int(),
  avoidedCommissionWithVatKurus: z.number().int(),
  byChannel: z.array(z.object({ channel: orderChannelSchema, count: z.number().int(), basketKurus: z.number().int() })),
  includesPhoneOrders: z.boolean(),
  headline: z.string(),
  note: z.string(),
});
export type SavingsReport = z.infer<typeof savingsReportSchema>;

/** Kendi kanal siparişleri (04 §11.3: telefon siparişi ayarla dahil edilir). */
export const OWN_CHANNELS = ['wa_link', 'wa_ai', 'wa_reorder', 'web', 'table_qr', 'wa_flow'] as const;

// ---------------------------------------------------------------------------
// Onboarding

export const ONBOARDING_STEPS = ['business_info', 'menu', 'hours', 'zones', 'whatsapp', 'test_order', 'go_live'] as const;
export type OnboardingStepCode = (typeof ONBOARDING_STEPS)[number];
export const ONBOARDING_STEP_LABELS: Record<OnboardingStepCode, string> = {
  business_info: 'İşletme bilgileri',
  menu: 'Menü',
  hours: 'Çalışma saatleri',
  zones: 'Teslimat ve ödeme',
  whatsapp: 'WhatsApp',
  test_order: 'Test siparişi',
  go_live: 'Canlıya geç',
};

export const onboardingStepSchema = z.object({
  code: z.enum(ONBOARDING_STEPS),
  label: z.string(),
  done: z.boolean(),
  /** Web siparişine açılmak (Kapı 1) için zorunlu mu */
  requiredForWeb: z.boolean(),
  detail: z.string().nullable(),
  missing: z.array(z.string()),
  href: z.string(),
});
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export const onboardingStatusSchema = z.object({
  steps: z.array(onboardingStepSchema),
  doneCount: z.number().int(),
  totalCount: z.number().int(),
  whatsapp: z.object({
    connected: z.boolean(),
    whatsappless: z.boolean(),
    displayPhone: z.string().nullable(),
    /** 00 §12a madde 8: 'shared' ortak numara (kayıtta hazır), 'own' kendi numarası */
    mode: z.enum(['shared', 'own']).optional(),
    /** Ortak numarada dükkan kodu */
    code: z.string().nullable().optional(),
  }),
  testOrder: z.object({ id: uuid, number: z.number().int(), status: orderStatusSchema, testKind: testKindSchema }).nullable(),
  canGoLiveWeb: z.boolean(),
  canGoLiveFull: z.boolean(),
  missingForWeb: z.array(z.string()),
  missingForFull: z.array(z.string()),
  liveAt: isoNullable,
  webLiveAt: isoNullable,
  lifecycleStage: lifecycleStageSchema,
  slug: z.string(),
  branchId: uuid.nullable(),
});
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;

export const whatsapplessRequestSchema = z.object({ enabled: z.boolean() });
export const goLiveResponseSchema = z.object({
  webLive: z.boolean(),
  live: z.boolean(),
  liveAt: isoNullable,
  webLiveAt: isoNullable,
  lifecycleStage: lifecycleStageSchema,
  missingForFull: z.array(z.string()),
});
export type GoLiveResponse = z.infer<typeof goLiveResponseSchema>;
