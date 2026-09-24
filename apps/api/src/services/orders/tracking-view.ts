// Takip sayfası görünümü (03 §3.0, §7): durum çizelgesi, etiket, kalemler, iptal/değerlendirme bayrakları.

import {
  cancelReasonText,
  formatClockTR,
  isFinal,
  maskPhone,
  rejectionReasonText,
  trackingStatusLabel,
  type OrderStatus,
} from '@siparis/core';
import { branches, cancellationRequests, orderItemOptions, orderItems, reviews, users, type Database } from '@siparis/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { trackResponseExtSchema, type TrackResponseExt } from '@siparis/core/orders/contracts';
import { normalizeAlarmPolicy } from './alarm-policy';
import type { TenantRow } from './store-context';
import type { OrderRow } from './summary';
import { buildWaLink, findVerificationCode, loadVerificationChannels } from './verification';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

interface TimelineEntry {
  status: OrderStatus;
  label: string;
  at: string | null;
}

/** Adım çubuğu: Alındı → Onaylandı → (Hazırlanıyor) → Yolda / Hazır → Teslim edildi (03 §3.0). */
export function buildTimeline(order: OrderRow, usePreparingStep: boolean): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const reachedNew =
    order.verifiedAt != null || order.acceptedAt != null || (order.status !== 'awaiting_customer' && order.status !== 'cancelled');
  if (!reachedNew) {
    out.push({ status: 'awaiting_customer', label: 'Onayınız bekleniyor', at: iso(order.placedAt) });
  }
  const negative = order.status === 'rejected' || order.status === 'cancelled';
  const newAt = reachedNew ? (order.verifiedAt ?? order.placedAt) : null;
  const steps: TimelineEntry[] = [
    { status: 'new', label: 'Alındı', at: iso(newAt) },
    { status: 'accepted', label: 'Onaylandı', at: iso(order.acceptedAt) },
  ];
  if (usePreparingStep || order.preparingAt) steps.push({ status: 'preparing', label: 'Hazırlanıyor', at: iso(order.preparingAt) });
  if (order.fulfillmentType === 'delivery') steps.push({ status: 'on_the_way', label: 'Yolda', at: iso(order.onTheWayAt) });
  else steps.push({ status: 'ready', label: 'Hazır', at: iso(order.readyAt) });
  steps.push({ status: 'delivered', label: 'Teslim edildi', at: iso(order.deliveredAt) });
  for (const s of steps) {
    if (negative && !s.at) continue;
    out.push(s);
  }
  if (order.status === 'rejected') out.push({ status: 'rejected', label: 'Reddedildi', at: iso(order.rejectedAt) });
  if (order.status === 'cancelled') out.push({ status: 'cancelled', label: 'İptal edildi', at: iso(order.cancelledAt) });
  return out;
}

export function reasonTextOf(order: OrderRow): string | null {
  if (order.status === 'rejected' && order.rejectionReason) return rejectionReasonText(order.rejectionReason, order.rejectionNote);
  if (order.status === 'cancelled' && order.cancelReason) return cancelReasonText(order.cancelReason, order.cancelNote);
  return null;
}

const firstName = (name: string | null | undefined) => (name ? (name.trim().split(/\s+/)[0] ?? null) : null);

export async function buildTrackView(
  db: Database,
  input: { order: OrderRow; tenant: TenantRow; now?: Date },
): Promise<TrackResponseExt> {
  const { order, tenant } = input;
  const now = input.now ?? new Date();
  const [branch] = await db.select().from(branches).where(eq(branches.id, order.branchId));
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.sort));
  const itemIds = items.map((i) => i.id);
  const opts = itemIds.length ? await db.select().from(orderItemOptions).where(inArray(orderItemOptions.orderItemId, itemIds)) : [];
  const [review] = await db.select().from(reviews).where(eq(reviews.orderId, order.id));
  const [cancelReq] = await db
    .select()
    .from(cancellationRequests)
    .where(eq(cancellationRequests.orderId, order.id))
    .orderBy(desc(cancellationRequests.requestedAt))
    .limit(1);
  let courierName: string | null = null;
  if (order.courierUserId && (order.status === 'on_the_way' || order.status === 'delivered')) {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, order.courierUserId));
    courierName = firstName(u?.name);
  }

  const reasonText = reasonTextOf(order);
  const channels = await loadVerificationChannels(db, tenant, order.branchId);
  let verification: TrackResponseExt['order']['verification'] = null;
  if (order.status === 'awaiting_customer') {
    const code = channels.waConnected ? await findVerificationCode(db, tenant.id, order.id) : undefined;
    const method = code && channels.waDisplayPhone ? 'wa_code' : channels.smsAvailable ? 'sms_otp' : null;
    verification = {
      method,
      code: method === 'wa_code' ? (code?.code ?? null) : null,
      waLink: method === 'wa_code' && code && channels.waDisplayPhone ? buildWaLink(channels.waDisplayPhone, code.code) : null,
      smsAvailable: channels.smsAvailable,
      expiresAt: new Date(order.placedAt.getTime() + 30 * 60_000).toISOString(),
    };
  }

  let approvalDelay: TrackResponseExt['order']['approvalDelay'] = null;
  if (order.status === 'new' && !order.testKind) {
    const policy = normalizeAlarmPolicy(branch?.alarmPolicy);
    const newAt = (order.verifiedAt ?? order.placedAt).getTime();
    approvalDelay = {
      noticeAt: new Date(newAt + policy.customerNoticeMinutes * 60_000).toISOString(),
      autoCancelAt: new Date(newAt + policy.autoCancelMinutes * 60_000).toISOString(),
    };
  }

  const cancellable = order.status === 'awaiting_customer' || order.status === 'new';
  const requestable =
    (order.status === 'accepted' || order.status === 'preparing' || order.status === 'ready' || order.status === 'on_the_way') &&
    cancelReq?.status !== 'pending';

  const smsMode = verification?.method === 'sms_otp';
  const statusLabel = trackingStatusLabel(order.status, {
    fulfillmentType: order.fulfillmentType,
    etaClock: order.estimatedReadyAt ? formatClockTR(order.estimatedReadyAt, branch?.timezone ?? undefined) : null,
    courierName,
    reasonText,
    smsMode,
  });

  const waConnectedForBusiness = channels.waDisplayPhone;
  return {
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      statusLabel,
      channel: order.channel,
      placedAt: order.placedAt.toISOString(),
      timeline: buildTimeline(order, branch?.usePreparingStep ?? false),
      items: items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        options: opts.filter((o) => o.orderItemId === i.id).map((o) => o.optionName),
        lineTotalKurus: i.lineTotalKurus,
      })),
      totals: { subtotalKurus: order.subtotalKurus, deliveryFeeKurus: order.deliveryFeeKurus, totalKurus: order.totalKurus },
      fulfillmentType: order.fulfillmentType,
      paymentMethod: order.paymentMethod,
      etaAt: iso(order.estimatedReadyAt),
      canCancel: cancellable,
      canRequestCancel: requestable,
      cancelRequested: cancelReq?.status === 'pending',
      review: review ? { rating: review.rating, comment: review.comment } : null,
      reasonText,
      courierName,
      neighborhood: order.neighborhood,
      addressMasked: order.fulfillmentType === 'delivery' ? (order.neighborhood ? `${order.neighborhood} Mah.` : 'Teslimat adresi') : null,
      phoneMasked: order.customerPhone ? maskPhone(order.customerPhone) : null,
      mealCardBrand: order.mealCardBrand,
      changeForKurus: order.changeForKurus,
      note: order.note,
      readyAt: iso(order.readyAt),
      cancelRequestStatus: cancelReq ? cancelReq.status : null,
      approvalDelay,
      verification,
    },
    business: {
      name: tenant.name,
      phone: branch?.phone ?? tenant.phone ?? null,
      slug: tenant.slug,
      waPhone: waConnectedForBusiness,
    },
    expired: false,
  };
}

/** Süresi dolmuş mu (final + 7 gün; 00 §7). */
export function isTrackingExpired(order: OrderRow, now = new Date()): boolean {
  return Boolean(order.trackingExpiresAt && order.trackingExpiresAt.getTime() <= now.getTime() && isFinal(order.status));
}


export { trackResponseExtSchema };
export type { TrackResponseExt };
