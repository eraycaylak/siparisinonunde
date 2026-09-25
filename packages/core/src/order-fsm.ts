// Sipariş durum makinesi (00 §5, 07 §4.1). Tablo güdümlü, saf fonksiyonlar.

import {
  CANCEL_REASONS,
  CANCELLED_BY,
  FINAL_ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  REJECTION_REASONS,
  type CancelReason,
  type CancelledBy,
  type FulfillmentType,
  type OrderStatus,
  type RejectionReason,
} from './enums';

/** Kanonik geçiş tablosu (00 §5 birebir). */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  awaiting_customer: ['new', 'cancelled'],
  new: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'ready', 'on_the_way', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['on_the_way', 'delivered', 'cancelled'],
  on_the_way: ['delivered', 'cancelled'],
  delivered: [],
  rejected: [],
  cancelled: [],
};

/** Geçişte doldurulan zaman damgası kolonu (orders tablosu, camelCase). */
export const STATUS_TIMESTAMP_FIELD: Readonly<Partial<Record<OrderStatus, string>>> = {
  accepted: 'acceptedAt',
  preparing: 'preparingAt',
  ready: 'readyAt',
  on_the_way: 'onTheWayAt',
  delivered: 'deliveredAt',
  rejected: 'rejectedAt',
  cancelled: 'cancelledAt',
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isFinal(status: OrderStatus): boolean {
  return (FINAL_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
}

export function isOpen(status: OrderStatus): boolean {
  return !isFinal(status);
}

export interface NextActionsContext {
  /** Gel-al/masada "yolda" adımı yoktur (07 §4.1 geçiş 10: yalnız delivery). */
  fulfillmentType?: FulfillmentType;
  /** Şube "hazırlanıyor" adımını kullanmıyorsa gizlenir (UI ipucu). */
  usePreparingStep?: boolean;
  /** Bekleyen ret varken onay verilemez. */
  rejectionPending?: boolean;
}

/** Duruma göre olası hedef durumlar (UI butonları için; bağlama göre süzülür). */
export function nextActions(status: OrderStatus, ctx: NextActionsContext = {}): OrderStatus[] {
  let targets = [...ORDER_TRANSITIONS[status]];
  if (ctx.fulfillmentType && ctx.fulfillmentType !== 'delivery') {
    targets = targets.filter((t) => t !== 'on_the_way');
  }
  if (ctx.usePreparingStep === false) {
    targets = targets.filter((t) => t !== 'preparing');
  }
  if (ctx.rejectionPending) {
    targets = targets.filter((t) => t !== 'accepted' && t !== 'rejected');
  }
  return targets;
}

/** 14 §2'deki ad; nextActions ile aynı. */
export const allowedActions = nextActions;

export class OrderTransitionError extends Error {
  constructor(
    public readonly code: 'invalid_transition' | 'reason_required' | 'note_required' | 'cancelled_by_required',
    message: string,
  ) {
    super(message);
    this.name = 'OrderTransitionError';
  }
}

export interface TransitionInput {
  reason?: string | null;
  note?: string | null;
  cancelledBy?: CancelledBy | null;
}

/**
 * Geçiş ve zorunlu alanları doğrular (07 §4.1): ret → rejection_reason; iptal → cancelled_by + cancel_reason;
 * sebep 'other' ise not zorunlu. Hata yoksa null döner.
 */
export function validateTransition(
  from: OrderStatus,
  to: OrderStatus,
  input: TransitionInput = {},
): OrderTransitionError | null {
  if (!canTransition(from, to)) {
    // Kullanıcıya giden metin: durum kodları değil Türkçe etiketler (ör. "Hazırlanıyor" → "Yolda")
    return new OrderTransitionError(
      'invalid_transition',
      `Bu sipariş "${ORDER_STATUS_LABELS[from]}" durumundan "${ORDER_STATUS_LABELS[to]}" durumuna geçemez.`,
    );
  }
  const note = input.note?.trim() ?? '';
  if (to === 'rejected') {
    if (!input.reason || !(REJECTION_REASONS as readonly string[]).includes(input.reason)) {
      return new OrderTransitionError('reason_required', 'Ret sebebi seçilmeli.');
    }
    if ((input.reason as RejectionReason) === 'other' && !note) {
      return new OrderTransitionError('note_required', '"Diğer" sebebi için açıklama yazılmalı.');
    }
  }
  if (to === 'cancelled') {
    if (!input.cancelledBy || !(CANCELLED_BY as readonly string[]).includes(input.cancelledBy)) {
      return new OrderTransitionError('cancelled_by_required', 'İptal edenin kim olduğu belirtilmeli.');
    }
    if (!input.reason || !(CANCEL_REASONS as readonly string[]).includes(input.reason)) {
      return new OrderTransitionError('reason_required', 'İptal sebebi seçilmeli.');
    }
    if ((input.reason as CancelReason) === 'other' && !note) {
      return new OrderTransitionError('note_required', '"Diğer" sebebi için açıklama yazılmalı.');
    }
  }
  return null;
}

/** Geçersizse OrderTransitionError fırlatır. */
export function assertTransition(from: OrderStatus, to: OrderStatus, input: TransitionInput = {}): void {
  const err = validateTransition(from, to, input);
  if (err) throw err;
}

/** Takip linki geçerlilik süresi: final durum + 7 gün (00 §7). */
export const TRACKING_TTL_AFTER_FINAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Bekleyen ret penceresi: 30 sn (00 §7). */
export const REJECTION_UNDO_WINDOW_MS = 30 * 1000;

/** Akış B doğrulama zaman aşımı: 30 dk (00 §5). */
export const AWAITING_CUSTOMER_TIMEOUT_MS = 30 * 60 * 1000;
