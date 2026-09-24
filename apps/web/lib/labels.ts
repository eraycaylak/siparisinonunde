// Kanonik enum değerleri ve Türkçe etiketleri tek kaynaktan: @siparis/core/enums (00 §4, §5, §7).
// Burada yalnız panel mikro metinleri (04 §14.3) ve UI yardımcıları bulunur.

export {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  OPEN_ORDER_STATUSES,
  FINAL_ORDER_STATUSES,
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  CANCEL_REASONS,
  CANCEL_REASON_LABELS,
  TENANT_CANCEL_REASONS,
  CANCELLED_BY_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  FULFILLMENT_TYPES,
  FULFILLMENT_TYPE_LABELS,
  ORDER_CHANNELS,
  ORDER_CHANNEL_LABELS,
  ORDERING_STATES,
  ORDERING_STATE_LABELS,
  LIFECYCLE_STAGES,
  LIFECYCLE_STAGE_LABELS,
  PLAN_CODES,
  PLAN_CODE_LABELS,
  TENANT_ROLES,
  TENANT_ROLE_LABELS,
  PLATFORM_ROLES,
  PLATFORM_ROLE_LABELS,
  BRANCH_EVENT_TYPES,
  labelOf,
} from '@siparis/core/enums';

export type {
  OrderStatus,
  RejectionReason,
  CancelReason,
  PaymentMethod,
  PaymentStatus,
  FulfillmentType,
  OrderChannel,
  OrderingState,
  LifecycleStage,
  PlanCode,
  TenantRole,
  PlatformRole,
  BranchEventType,
} from '@siparis/core/enums';

import type { OrderChannel, OrderingState } from '@siparis/core/enums';

/** Üst bar sipariş alma anahtarı metinleri (04 §2.2, §14.3). */
export const ORDERING_STATE_UI_LABELS: Record<OrderingState, string> = {
  open: 'Sipariş alıyor',
  busy: 'Yoğun',
  paused: 'Durduruldu',
  closed: 'Kapalı',
};

/** Kısa kanal rozeti metinleri (04 §14.3; 12 §3.5). */
export const CHANNEL_BADGE_LABELS: Record<OrderChannel, string> = {
  wa_link: 'WhatsApp',
  wa_ai: 'AI ile',
  web: 'Web · QR',
  table_qr: 'Masa',
  wa_flow: 'Flows',
  wa_reorder: 'Sohbetten tekrar',
  manual: 'Telefon',
};
