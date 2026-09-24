// Sipariş bildirimleri (00 §6.5, §7; 02 §4.3, §4.4, §6.11; 03 §9.6).
// Kancalar (onOrderCreated / onOrderTransition) yalnız outbox işi yazar (aynı transaction); mesajı `order.notify_customer`
// işi üretir: bütçe (≤ 4 durum mesajı), pencere (24 sa → serbest, değilse şablon), WhatsApp'sız mod (SMS),
// yerine geçme (supersede), canary sessiz. Akış A "alındı" 60 sn debounce: `order.received_debounced`; 60 sn içinde
// onay gelirse iş iptal edilir ve birleşik M06c gider. Akış B'de "alındı" (M05) konuşma motorundan anında gider.

import {
  CUSTOMER_TEMPLATES,
  UNKNOWN_CUSTOMER_NAME,
  cancelReasonText,
  formatClockTR,
  formatItemsList,
  formatOrderNo,
  formatPhone,
  formatTL,
  greetingName,
  m05Received,
  m06AcceptedCombined,
  m06AcceptedDelivery,
  m06AcceptedPickup,
  m07Preparing,
  m08ReadyPickup,
  m09OnTheWay,
  m10Delivered,
  m11Rejected,
  m12Cancelled,
  m13ApprovalDelay,
  m34Delay,
  paymentDetailText,
  paymentText,
  rejectionReasonText,
  sms02Accepted,
  sms03aRejected,
  sms03bCancelled,
  templateForStatus,
  templateParams,
  type CustomerTemplateName,
  type OrderStatus,
  type WaDraft,
} from '@siparis/core';
import { conversationBotState, conversations, customers, messages, orders, users, waAccounts, type Database } from '@siparis/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../../config';
import { isFlagEnabled } from '../../lib/flags';
import { cancelJobs, enqueueJob } from '../../lib/jobs';
import { createTrackingToken } from '../../lib/tracking';
import { onOrderCreated, onOrderTransition } from '../orders/transition';
import { releaseStatusBudget, reserveStatusBudget } from './budget';
import {
  branchShortAddress,
  contactPhone,
  loadBranch,
  loadTenant,
  orderMessageItems,
  orderTrackingUrl,
  storefrontUrl,
  type BranchRow,
  type OrderRow,
  type TenantRow,
} from './context';
import { upsertConversation, windowOpen, type ConversationRow } from './customers';
import { draftToSpec, queueOutbound, type OutboundSpec, type TemplateSpec } from './outbound';

export interface NotifyDeps {
  db: Database;
  config: Config;
  log: FastifyBaseLogger;
}

export type NotifyEvent = 'status' | 'approval_delay' | 'delay';

export interface NotifyCustomerPayload {
  orderId: string;
  event: NotifyEvent;
  /** event = 'status': hedef durum */
  to?: OrderStatus;
  from?: OrderStatus | null;
  /** Akış A: 60 sn içinde onay → birleşik M06c */
  combined?: boolean;
  /** event = 'delay': ek dakika */
  extraMinutes?: number;
  /** event = 'approval_delay': otomatik iptale kalan dakika (sipariş dilimi verir; yoksa hesaplanır) */
  remainingMinutes?: number | null;
}

export const RECEIVED_DEBOUNCE_MS = 60_000;
const SMS_CRITICAL: ReadonlySet<OrderStatus> = new Set(['accepted', 'rejected', 'cancelled']);
/** Bütçeye sayılan durumlar */
const BUDGETED: ReadonlySet<OrderStatus> = new Set(['new', 'accepted', 'preparing', 'ready', 'on_the_way', 'delivered']);
const PROGRESS_RANK: Partial<Record<OrderStatus, number>> = { new: 0, accepted: 1, preparing: 2, ready: 3, on_the_way: 4, delivered: 5 };

// ---------------------------------------------------------------------------
// Kancalar (sipariş dilimi transitionOrder / recordOrderCreated çağırdığında, aynı transaction)

export function registerMessagingHooks(): void {
  onOrderCreated('messaging.notify', async ({ tx, order }) => {
    if (order.testKind === 'canary') return;
    if (order.status === 'new') {
      if (order.verificationMethod === 'wa_link' || order.channel === 'wa_link') {
        // Akış A: storefront ekranı zaten "alındı" gösterir → 60 sn debounce
        await enqueueJob(tx, {
          queue: 'notify',
          type: 'order.received_debounced',
          payload: { orderId: order.id },
          delayMs: RECEIVED_DEBOUNCE_MS,
          dedupeKey: `received_debounced:${order.id}`,
          tenantId: order.tenantId,
        });
        return;
      }
      if (order.verificationMethod === 'sms_otp' || order.statusNotifyChannel !== 'whatsapp') return;
      // Akış E (telefon siparişi) vb.: debounce yok
      await enqueueNotify(tx, order, 'new', null, false);
      return;
    }
    if (order.status === 'accepted') await enqueueNotify(tx, order, 'accepted', null, false);
  });

  onOrderTransition('messaging.notify', async ({ tx, order, from, to }) => {
    if (order.testKind === 'canary') return;
    if (to === 'new') return; // Akış B (wa_code) M05'i motor anında gönderir; sms_otp'de "alındı" gitmez
    if (from === 'awaiting_customer') return; // doğrulanmamış sipariş (Akış B zaman aşımı / vazgeçme): mesaj yok
    let combined = false;
    if (to === 'accepted' || to === 'rejected' || to === 'cancelled') {
      const cancelled = await cancelJobs(tx, { dedupeKey: `received_debounced:${order.id}` });
      combined = to === 'accepted' && cancelled > 0;
    }
    await enqueueNotify(tx, order, to, from, combined);
  });
}

async function enqueueNotify(tx: Database, order: OrderRow, to: OrderStatus, from: OrderStatus | null, combined: boolean): Promise<void> {
  const payload: NotifyCustomerPayload = { orderId: order.id, event: 'status', to, from, combined };
  await enqueueJob(tx, {
    queue: 'notify',
    type: 'order.notify_customer',
    payload: payload as unknown as Record<string, unknown>,
    dedupeKey: `notify:${order.id}:${to}`,
    tenantId: order.tenantId,
  });
}

// ---------------------------------------------------------------------------
// Hedef çözümleme

interface Target {
  tenant: TenantRow;
  branch: BranchRow;
  order: OrderRow;
  conv: ConversationRow | null;
  account: typeof waAccounts.$inferSelect | null;
  smsMode: boolean;
}

async function branchAccount(tx: Database, order: OrderRow) {
  const [acc] = await tx
    .select()
    .from(waAccounts)
    .where(and(eq(waAccounts.tenantId, order.tenantId), eq(waAccounts.branchId, order.branchId)));
  return acc ?? null;
}

async function resolveTarget(tx: Database, order: OrderRow): Promise<Target | null> {
  const tenant = await loadTenant(tx, order.tenantId);
  const branch = await loadBranch(tx, order.tenantId, order.branchId);
  if (!tenant || !branch) return null;
  const smsMode = order.verificationMethod === 'sms_otp' || order.statusNotifyChannel === 'sms';
  let conv: ConversationRow | null = null;
  if (order.conversationId) {
    const [c] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, order.conversationId), eq(conversations.tenantId, order.tenantId)));
    conv = c ?? null;
  }
  let account = conv
    ? ((await tx.select().from(waAccounts).where(eq(waAccounts.id, conv.waAccountId)))[0] ?? null)
    : await branchAccount(tx, order);
  if (!conv && account && !smsMode) {
    let customerId = order.customerId;
    // Akış E: müşteri kaydı yoksa yalnız kasiyerin WhatsApp bildirim onayıyla telefon üzerinden (02 §9.1)
    const meta = (order.sourceMeta ?? {}) as { waNotifyConsent?: boolean; notifyConsent?: boolean };
    const consent = meta.waNotifyConsent === true || meta.notifyConsent === true;
    if (!customerId && consent && order.customerPhone) {
      const [existing] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.tenantId, order.tenantId), eq(customers.phoneE164, order.customerPhone)));
      customerId =
        existing?.id ??
        (await tx.insert(customers).values({ tenantId: order.tenantId, phoneE164: order.customerPhone, name: order.customerName }).returning())[0]!.id;
    }
    if (customerId) {
      const [c] = await tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.tenantId, order.tenantId), eq(conversations.customerId, customerId), eq(conversations.waAccountId, account.id)))
        .orderBy(desc(conversations.lastInboundAt))
        .limit(1);
      conv = c ?? null;
      if (!conv && order.channel === 'manual' && consent) conv = await upsertConversation(tx, account, customerId);
    }
  }
  if (conv && !account) account = await branchAccount(tx, order);
  return { tenant, branch, order, conv, account, smsMode };
}

function waUsable(t: Target): boolean {
  return !t.smsMode && !!t.conv && !!t.account && t.account.status === 'connected';
}

// ---------------------------------------------------------------------------
// İçerik

interface Rendered {
  draft: WaDraft | null;
  template: TemplateSpec | null;
  sms: string | null;
}

function templateFor(name: CustomerTemplateName | null, t: Target, config: Config, values: Record<string, string | number | null | undefined>): TemplateSpec | null {
  if (!name) return null;
  const spec = CUSTOMER_TEMPLATES[name];
  const params = templateParams(name, values as never);
  const token = createTrackingToken(t.order.id, config.TRACKING_SECRET);
  const buttons = spec.button === 'track' || spec.button === 'review' ? [{ type: 'url' as const, index: 0, param: token }] : [];
  return { name, params, buttons };
}

function subeTel(t: Target): string {
  const p = contactPhone(t.tenant, t.branch);
  return p ? formatPhone(p) : '-';
}

async function render(t: Target, to: OrderStatus, combined: boolean, config: Config, tx: Database): Promise<Rendered> {
  const o = t.order;
  const no = formatOrderNo(o.number);
  const trackingUrl = orderTrackingUrl(config, o.id);
  const eta = o.estimatedReadyAt ? formatClockTR(o.estimatedReadyAt) : null;
  const dk = o.etaMinutes ?? t.branch.defaultPrepMinutes;
  const odeme = paymentText(o.paymentMethod, o.mealCardBrand);
  const pickup = o.fulfillmentType === 'pickup';
  const base = {
    musteriAdi: greetingName(o.customerName) ?? UNKNOWN_CUSTOMER_NAME,
    isletme: t.tenant.name,
    no,
    tutar: formatTL(o.totalKurus),
    dk,
    subeAdres: branchShortAddress(t.branch),
    odeme,
    subeTel: subeTel(t),
  };
  const tplName = templateForStatus(to, { cancelReason: o.cancelReason });
  switch (to) {
    case 'new': {
      const items = await orderMessageItems(tx, o.id);
      return {
        draft: m05Received({ no, kalemler: formatItemsList(items), toplam: formatTL(o.totalKurus), odeme, trackingUrl, isletme: t.tenant.name }),
        template: templateFor(tplName, t, config, base),
        sms: null,
      };
    }
    case 'accepted': {
      const saat = eta ?? `${dk} dk içinde`;
      let draft: WaDraft;
      if (combined) {
        const items = await orderMessageItems(tx, o.id);
        draft = m06AcceptedCombined({ no, kalemler: formatItemsList(items), toplam: formatTL(o.totalKurus), odeme, trackingUrl, saat, dk, pickup });
      } else if (pickup) {
        draft = m06AcceptedPickup({ saat, subeAdresKisa: branchShortAddress(t.branch), no, trackingUrl });
      } else {
        draft = m06AcceptedDelivery({ saat, dk, no, trackingUrl });
      }
      return {
        draft,
        template: templateFor(tplName, t, config, base),
        sms: sms02Accepted({ isletme: t.tenant.name, no, saat, takipLink: trackingUrl }),
      };
    }
    case 'preparing':
      return { draft: m07Preparing({ no }), template: null, sms: null };
    case 'ready':
      return {
        draft: pickup ? m08ReadyPickup({ no, odeme, subeAdresKisa: branchShortAddress(t.branch) }) : null,
        template: pickup ? templateFor(tplName, t, config, base) : null,
        sms: null,
      };
    case 'on_the_way': {
      let courier: string | null = null;
      if (o.courierUserId) {
        const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, o.courierUserId));
        courier = u?.name ?? null;
      }
      const remaining = o.estimatedReadyAt ? Math.max(5, Math.round((o.estimatedReadyAt.getTime() - Date.now()) / 60_000)) : 15;
      return {
        draft: m09OnTheWay({
          kurye: courier,
          dk: remaining,
          odemeDetay: paymentDetailText({ method: o.paymentMethod, totalKurus: o.totalKurus, changeForKurus: o.changeForKurus, mealCardBrand: o.mealCardBrand }),
          no,
          trackingUrl,
        }),
        template: templateFor(tplName, t, config, { ...base, dk: remaining }),
        sms: null,
      };
    }
    case 'delivered':
      return { draft: m10Delivered({ orderId: o.id }), template: templateFor(tplName, t, config, base), sms: null };
    case 'rejected': {
      const reason = o.rejectionReason ?? 'other';
      const sebep = rejectionReasonText(reason, o.rejectionNote);
      return {
        draft: m11Rejected({
          no,
          reason,
          isletmeNotu: o.rejectionNote,
          subeTel: subeTel(t),
          pickupAvailable: t.branch.acceptsPickup,
          menuUrl: storefrontUrl(config, t.tenant.slug),
        }),
        template: templateFor(tplName, t, config, { ...base, sebep }),
        sms: sms03aRejected({ isletme: t.tenant.name, no, sebep, subeTel: subeTel(t) }),
      };
    }
    case 'cancelled': {
      const reason = o.cancelReason ?? 'other';
      const sebep = cancelReasonText(reason, o.cancelNote);
      return {
        draft: m12Cancelled({
          no,
          isletme: t.tenant.name,
          reason,
          cancelledBy: o.cancelledBy ?? 'system',
          note: o.cancelNote,
          subeTel: subeTel(t),
          menuUrl: storefrontUrl(config, t.tenant.slug),
        }),
        template: templateFor(tplName, t, config, { ...base, sebep }),
        sms: sms03bCancelled({ isletme: t.tenant.name, no, sebep, subeTel: subeTel(t), reason }),
      };
    }
    default:
      return { draft: null, template: null, sms: null };
  }
}

/** Daha ileri ve mesaj üreten bir duruma geçildiyse eski durum mesajı atılır (02 §4.3 yerine geçme). */
export function isSuperseded(event: OrderStatus, current: OrderStatus, pickup: boolean): boolean {
  if (event === 'rejected' || event === 'cancelled') return false;
  if (current === 'rejected' || current === 'cancelled') return true;
  const e = PROGRESS_RANK[event];
  const c = PROGRESS_RANK[current];
  if (e == null || c == null || c <= e) return false;
  const producesMessage = current === 'on_the_way' || current === 'delivered' || (current === 'ready' && pickup);
  return producesMessage;
}

function statusEnabled(branch: BranchRow, to: OrderStatus): boolean {
  const s = branch.statusMessages;
  switch (to) {
    case 'new':
      return s.received !== false;
    case 'accepted':
      return s.accepted !== false;
    case 'preparing':
      return s.preparing === true;
    case 'ready':
      return s.ready !== false;
    case 'on_the_way':
      return s.on_the_way !== false;
    case 'delivered':
      return s.delivered !== false;
    default:
      return true;
  }
}

async function smsFallbackAllowed(db: Database, t: Target): Promise<boolean> {
  return !!t.order.customerPhone && t.tenant.smsFallbackEnabled && (await isFlagEnabled(db, 'sms_fallback'));
}

async function enqueueSms(tx: Database, t: Target, body: string, key: string): Promise<void> {
  await enqueueJob(tx, {
    queue: 'notify',
    type: 'sms.send',
    payload: { tenantId: t.order.tenantId, to: t.order.customerPhone, body, purpose: 'status', countsTowardQuota: true, orderId: t.order.id },
    dedupeKey: `sms_status:${t.order.id}:${key}`,
    tenantId: t.order.tenantId,
  });
}

async function optedOutForOrder(tx: Database, t: Target): Promise<boolean> {
  if (!t.conv?.optedOut) return false;
  const [b] = await tx.select().from(conversationBotState).where(eq(conversationBotState.conversationId, t.conv.id));
  // Opt-out'tan SONRA müşterinin kendi verdiği siparişin durumları gider (02 §6.9)
  return !b?.optedOutAt || t.order.placedAt < b.optedOutAt;
}

export type NotifyOutcome =
  | { sent: 'wa'; messageId: string; mode: 'free_form' | 'template'; code: string | null }
  | { sent: 'sms' }
  | { sent: 'none'; reason: string };

/** Durum bildirimi (order.notify_customer event='status' ve order.received_debounced). */
export async function notifyStatus(deps: NotifyDeps, orderId: string, to: OrderStatus, opts: { combined?: boolean; now?: Date } = {}): Promise<NotifyOutcome> {
  const now = opts.now ?? new Date();
  return deps.db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!order) return { sent: 'none', reason: 'order_not_found' };
    if (order.testKind === 'canary') return { sent: 'none', reason: 'canary' };
    if (order.statusNotifyChannel === 'none') return { sent: 'none', reason: 'notify_off' };
    if (isSuperseded(to, order.status, order.fulfillmentType === 'pickup')) return { sent: 'none', reason: 'superseded' };
    const t = await resolveTarget(tx, order);
    if (!t) return { sent: 'none', reason: 'tenant_not_found' };

    if (!waUsable(t)) {
      // WhatsApp'sız mod: yalnız kritik durumlar SMS (02 §6.11)
      if (SMS_CRITICAL.has(to) && (await smsFallbackAllowed(deps.db, t))) {
        const r = await render(t, to, false, deps.config, tx);
        if (r.sms) {
          await enqueueSms(tx, t, r.sms, to);
          return { sent: 'sms' };
        }
      }
      return { sent: 'none', reason: t.smsMode ? 'sms_mode' : 'wa_unavailable' };
    }
    const conv = t.conv!;
    if (await optedOutForOrder(tx, t)) return { sent: 'none', reason: 'opted_out' };
    if (!statusEnabled(t.branch, to)) return { sent: 'none', reason: 'status_message_off' };
    if (to === 'preparing') {
      // M07 yalnız birleşik M06c gittiyse (bütçede yolda/teslim için yer kalır; 03 §9.6 kural 4)
      const [c] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.orderId, order.id), sql`${messages.payload}->>'code' = 'M06c'`))
        .limit(1);
      if (!c) return { sent: 'none', reason: 'preparing_skipped' };
    }

    const r = await render(t, to, !!opts.combined, deps.config, tx);
    if (!r.draft) return { sent: 'none', reason: 'no_message' };
    const open = windowOpen(conv.lastInboundAt, now);
    let spec: OutboundSpec;
    let mode: 'free_form' | 'template';
    if (open) {
      spec = draftToSpec(r.draft);
      mode = 'free_form';
    } else if (r.template) {
      spec = { type: 'template', ...r.template };
      mode = 'template';
    } else {
      return { sent: 'none', reason: 'window_closed_no_template' };
    }
    const budgeted = BUDGETED.has(to);
    if (budgeted && !(await reserveStatusBudget(tx, order.id))) return { sent: 'none', reason: 'order_budget' };
    try {
      const smsOk = SMS_CRITICAL.has(to) && r.sms && (await smsFallbackAllowed(deps.db, t));
      const q = await queueOutbound(tx, {
        tenantId: order.tenantId,
        branchId: conv.branchId,
        conversationId: conv.id,
        spec,
        code: mode === 'template' ? (spec.type === 'template' ? spec.name : null) : r.draft.code,
        sentBy: 'bot',
        orderId: order.id,
        templateFallback: mode === 'free_form' ? r.template : null,
        smsFallback: smsOk ? { to: order.customerPhone!, body: r.sms! } : null,
        statusMessage: budgeted,
        orderEvent: to,
      });
      return { sent: 'wa', messageId: q.messageId, mode, code: mode === 'free_form' ? r.draft.code : null };
    } catch (err) {
      if (budgeted) await releaseStatusBudget(tx, order.id);
      throw err;
    }
  });
}

/** Akış A debounce işi: 60 sn içinde onay gelmediyse "alındı" (M05). */
export async function handleReceivedDebounced(deps: NotifyDeps, orderId: string, now?: Date): Promise<NotifyOutcome> {
  const [order] = await deps.db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
  if (!order) return { sent: 'none', reason: 'order_not_found' };
  if (order.status !== 'new') return { sent: 'none', reason: 'not_new' };
  return notifyStatus(deps, orderId, 'new', { now });
}

/** M13 (onay gecikmesi, t=10) — bütçe dışı, sipariş başına ≤ 1, yalnız pencere açıkken; butonlar Beklerim / İptal. */
export async function notifyApprovalDelay(deps: NotifyDeps, orderId: string, now: Date = new Date(), remainingMinutes?: number | null): Promise<NotifyOutcome> {
  return deps.db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!order) return { sent: 'none', reason: 'order_not_found' };
    if (order.testKind) return { sent: 'none', reason: 'test_order' };
    if (order.status !== 'new' || order.rejectionScheduledAt) return { sent: 'none', reason: 'not_waiting' };
    const t = await resolveTarget(tx, order);
    if (!t || !waUsable(t)) return { sent: 'none', reason: 'wa_unavailable' };
    const conv = t.conv!;
    if (!windowOpen(conv.lastInboundAt, now)) return { sent: 'none', reason: 'window_closed' };
    if (await optedOutForOrder(tx, t)) return { sent: 'none', reason: 'opted_out' };
    const [dup] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.orderId, order.id), sql`${messages.payload}->>'code' = 'M13'`))
      .limit(1);
    if (dup) return { sent: 'none', reason: 'already_sent' };
    const autoCancel = t.branch.alarmPolicy?.auto_cancel_minutes ?? 15;
    const startedAt = order.verifiedAt ?? order.placedAt;
    const elapsedMin = Math.floor((now.getTime() - startedAt.getTime()) / 60_000);
    const kalanDk = Math.max(1, remainingMinutes && remainingMinutes > 0 ? Math.round(remainingMinutes) : autoCancel - elapsedMin);
    const draft = m13ApprovalDelay({ no: formatOrderNo(order.number), kalanDk, takipLink: orderTrackingUrl(deps.config, order.id), orderId: order.id });
    const q = await queueOutbound(tx, {
      tenantId: order.tenantId,
      branchId: conv.branchId,
      conversationId: conv.id,
      spec: draftToSpec(draft),
      code: draft.code,
      sentBy: 'bot',
      orderId: order.id,
      orderEvent: 'approval_delay',
    });
    return { sent: 'wa', messageId: q.messageId, mode: 'free_form', code: draft.code };
  });
}

/** M34 ("Gecikme bildir") — bütçe dışı, yalnız pencere açıkken (şablonu yok). Sayaç (≤ 2) sipariş dilimindedir. */
export async function notifyDelay(deps: NotifyDeps, orderId: string, extraMinutes: number, now: Date = new Date()): Promise<NotifyOutcome> {
  return deps.db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) return { sent: 'none', reason: 'order_not_found' };
    if (order.testKind === 'canary') return { sent: 'none', reason: 'canary' };
    if (!['accepted', 'preparing', 'ready', 'on_the_way'].includes(order.status)) return { sent: 'none', reason: 'not_active' };
    const t = await resolveTarget(tx, order);
    if (!t || !waUsable(t)) return { sent: 'none', reason: 'wa_unavailable' };
    const conv = t.conv!;
    if (!windowOpen(conv.lastInboundAt, now)) return { sent: 'none', reason: 'window_closed' };
    if (await optedOutForOrder(tx, t)) return { sent: 'none', reason: 'opted_out' };
    const saat = order.estimatedReadyAt ? formatClockTR(order.estimatedReadyAt) : formatClockTR(new Date(now.getTime() + extraMinutes * 60_000));
    const draft = m34Delay({ no: formatOrderNo(order.number), ekDk: Math.max(1, Math.round(extraMinutes)), saat, trackingUrl: orderTrackingUrl(deps.config, order.id) });
    const q = await queueOutbound(tx, {
      tenantId: order.tenantId,
      branchId: conv.branchId,
      conversationId: conv.id,
      spec: draftToSpec(draft),
      code: draft.code,
      sentBy: 'bot',
      orderId: order.id,
      orderEvent: 'delay',
    });
    return { sent: 'wa', messageId: q.messageId, mode: 'free_form', code: draft.code };
  });
}

/** `order.notify_customer` işleyicisi. */
export async function handleNotifyCustomer(deps: NotifyDeps, payload: NotifyCustomerPayload, now?: Date): Promise<NotifyOutcome> {
  let out: NotifyOutcome;
  switch (payload.event) {
    case 'approval_delay':
      out = await notifyApprovalDelay(deps, payload.orderId, now, payload.remainingMinutes);
      break;
    case 'delay':
      out = await notifyDelay(deps, payload.orderId, Number(payload.extraMinutes ?? 0), now);
      break;
    default:
      if (!payload.to) return { sent: 'none', reason: 'no_status' };
      out = await notifyStatus(deps, payload.orderId, payload.to, { combined: payload.combined, now });
  }
  if (out.sent === 'none') deps.log.info({ orderId: payload.orderId, event: payload.event, to: payload.to, reason: out.reason }, 'müşteri bildirimi atlandı');
  return out;
}
