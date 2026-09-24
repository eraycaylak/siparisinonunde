// Konuşma motoru (00 §7 kanonik sıra, 02 §6, 03 §8). Faz 1: kural tabanlı, AI yok.
// Sıra: opt-out/opt-in komutları → kara liste / askıdaki işletme (M33, 12 sa'te 1) → sipariş kodu (Akış B, M05 anında)
// → buton yanıtları → "yetkili" (M20, insan modu 30 dk) → insan modu / opt-out / bot kapalı → sessiz → açık sipariş
// durum kartı (M26, 15 dk'da 1) → şube kapalı (M03, 6 sa) / duraklatılmış (M04, 12 sa) → ses (M29) / desteklenmeyen
// (M30) → SSS niyetleri (M28) → tam karşılama (M01/M02, 12 sa'te 1) / kısa yanıt (M01K, 30 dk'da 1).
// Echo (işletme telefonundan) → insan modu 30 dk. Durum olayları → messages.status monoton.

import {
  BUTTON_IDS,
  M10B_REASONS,
  MEAL_CARD_BRAND_LABELS,
  PAYMENT_METHOD_LABELS,
  formatItemsList,
  formatOrderNo,
  formatPhone,
  formatTL,
  m01Welcome,
  m01kShortWelcome,
  m02Returning,
  m03Closed,
  m04Paused,
  m05Received,
  m10aReviewGood,
  m10bReviewBad,
  m10cReviewThanks,
  m10dReviewOk,
  m13aWaiting,
  m17bCodeNotFound,
  m17cCodeExpired,
  m17dCodeAlreadyUsed,
  m20Handoff,
  m26StatusCard,
  m27aCancelConfirm,
  m27bCancelRequested,
  m28aHours,
  m28bAddress,
  m28cZones,
  m28dPayments,
  m29Voice,
  m30Unsupported,
  m31OptOut,
  m31aOptOutAll,
  m31bOptOutMarketingOnly,
  m32OptIn,
  m33Unavailable,
  paymentText,
  trackingStatusLabel,
  formatClockTR,
  type MessageKind,
  type WaDraft,
} from '@siparis/core';
import {
  cancellationRequests,
  conversationBotState,
  conversations,
  customers,
  messages,
  notifications,
  orderEvents,
  orderVerificationCodes,
  orders,
  reviews,
  users,
  type Database,
} from '@siparis/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../../config';
import { appendBranchEvent } from '../../lib/events';
import { emitOrderUpdated } from '../orders/summary';
import { transitionOrder } from '../orders/transition';
import type { WaAccountRow } from '../../wa/registry';
import type { NormalizedWaEvent, NormalizedWaMessage } from '../../wa/types';
import {
  branchSchedule,
  branchShortAddress,
  contactPhone,
  createMenuLink,
  findActiveOrder,
  findLastDeliveredOrder,
  formatDayMonthTR,
  loadBranch,
  loadTenant,
  orderMessageItems,
  orderTrackingUrl,
  shortItems,
  storefrontUrl,
  tenantUnavailable,
  zoneSummary,
  type BranchRow,
  type BranchSchedule,
  type OrderRow,
  type TenantRow,
} from './context';
import { humanModeActive, upsertConversation, upsertWaCustomer, type ConversationRow, type CustomerRow } from './customers';
import { draftToSpec, emitConversationUpdated, ensureBotState, previewText, queueOutbound, type OutboundSpec } from './outbound';
import { reserveStatusBudget } from './budget';
import { detectIntent, isHandoffRequest, isOptIn, isOptOut, matchOrderCode } from './text';

export interface EngineDeps {
  db: Database;
  config: Config;
  log: FastifyBaseLogger;
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;

/** Soğuma süreleri (platform konfigürasyonu; 00 §7, 02 §6.2, 03 §8). */
export const COOLDOWNS = {
  fullWelcome: 12 * HOUR,
  anyAutoReply: 30 * MIN,
  statusCard: 15 * MIN,
  closed: 6 * HOUR,
  paused: 12 * HOUR,
  unavailable: 12 * HOUR,
  voice: 30 * MIN,
  unsupported: 24 * HOUR,
  faq: 30 * MIN,
  cancelIntent: 15 * MIN,
  handoffMode: 30 * MIN,
  echoMute: 30 * MIN,
  codeFailWindow: 10 * MIN,
} as const;
export const CODE_FAIL_LIMIT = 5;

type BotStateRow = typeof conversationBotState.$inferSelect;

interface Ctx {
  tx: Database;
  deps: EngineDeps;
  now: Date;
  account: WaAccountRow;
  tenant: TenantRow;
  branch: BranchRow;
  customer: CustomerRow;
  conv: ConversationRow;
  bot: BotStateRow;
  msg: NormalizedWaMessage;
  /** Aynı işlemde giden mesajların sırası (createdAt = now + seq ms) */
  seq: number;
  schedule?: BranchSchedule;
}

export interface InboundResult {
  status: 'processed' | 'duplicate' | 'ignored';
  messageId?: string;
  conversationId?: string;
}

// ---------------------------------------------------------------------------
// Yardımcılar

function laterOf(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

function since(ctx: Ctx, at: Date | null | undefined): number {
  return at ? ctx.now.getTime() - at.getTime() : Number.POSITIVE_INFINITY;
}

type CooldownKey =
  | 'welcome'
  | 'short'
  | 'status_card'
  | 'closed'
  | 'paused'
  | 'unavailable'
  | 'voice'
  | 'unsupported'
  | 'cancel_intent'
  | `faq_${string}`
  | `review:${string}`
  | `review_reason:${string}`
  | `wait:${string}`;

function lastSent(ctx: Ctx, key: CooldownKey): Date | null {
  switch (key) {
    case 'welcome':
      return ctx.conv.lastWelcomeAt;
    case 'short':
      return ctx.conv.lastNudgeAt;
    case 'status_card':
      return ctx.conv.lastStatusCardAt;
    case 'closed':
      return ctx.conv.lastClosedNoticeAt;
    default: {
      const v = (ctx.bot.cooldowns ?? {})[key];
      return v ? new Date(v) : null;
    }
  }
}

async function markSent(ctx: Ctx, key: CooldownKey): Promise<void> {
  const now = ctx.now;
  const colPatch: Partial<typeof conversations.$inferInsert> | null =
    key === 'welcome'
      ? { lastWelcomeAt: now, state: 'menu_link_sent' }
      : key === 'short'
        ? { lastNudgeAt: now }
        : key === 'status_card'
          ? { lastStatusCardAt: now }
          : key === 'closed'
            ? { lastClosedNoticeAt: now }
            : null;
  if (colPatch) {
    const [c] = await ctx.tx.update(conversations).set(colPatch).where(eq(conversations.id, ctx.conv.id)).returning();
    if (c) ctx.conv = c;
    return;
  }
  const cooldowns = { ...(ctx.bot.cooldowns ?? {}), [key]: now.toISOString() };
  const [b] = await ctx.tx
    .update(conversationBotState)
    .set({ cooldowns, updatedAt: now })
    .where(eq(conversationBotState.conversationId, ctx.conv.id))
    .returning();
  if (b) ctx.bot = b;
}

async function send(ctx: Ctx, draft: WaDraft | { code: string; spec: OutboundSpec }, opts: { orderId?: string | null; statusMessage?: boolean } = {}) {
  ctx.seq += 1;
  const spec = 'spec' in draft ? draft.spec : draftToSpec(draft);
  return queueOutbound(ctx.tx, {
    tenantId: ctx.tenant.id,
    branchId: ctx.conv.branchId,
    conversationId: ctx.conv.id,
    spec,
    code: draft.code,
    sentBy: 'bot',
    orderId: opts.orderId ?? null,
    statusMessage: opts.statusMessage ?? false,
    now: new Date(ctx.now.getTime() + ctx.seq),
  });
}

/** Aynı tip otomatik yanıt soğuma süresi içinde tekrar gönderilmez (replyOnce). Her durumda "işlendi" sayılır. */
async function replyOnce(ctx: Ctx, key: CooldownKey, cooldownMs: number, factory: () => Promise<WaDraft | null> | WaDraft | null): Promise<void> {
  if (since(ctx, lastSent(ctx, key)) < cooldownMs) return;
  const draft = await factory();
  if (!draft) return;
  await send(ctx, draft);
  await markSent(ctx, key);
}

async function schedule(ctx: Ctx): Promise<BranchSchedule> {
  if (!ctx.schedule) ctx.schedule = await branchSchedule(ctx.tx, ctx.branch, ctx.now);
  return ctx.schedule;
}

function menuLink(ctx: Ctx): Promise<string> {
  return createMenuLink(ctx.tx, ctx.deps.config, {
    tenantId: ctx.tenant.id,
    slug: ctx.tenant.slug,
    branchId: ctx.conv.branchId,
    conversationId: ctx.conv.id,
    customerId: ctx.customer.id,
    now: ctx.now,
  });
}

function phoneText(ctx: Ctx): string | null {
  const p = contactPhone(ctx.tenant, ctx.branch);
  return p ? formatPhone(p) : null;
}

async function logNotification(
  tx: Database,
  input: { tenantId: string; branchId?: string | null; orderId?: string | null; kind: string; payload: Record<string, unknown> },
): Promise<void> {
  await tx.insert(notifications).values({
    tenantId: input.tenantId,
    branchId: input.branchId ?? null,
    orderId: input.orderId ?? null,
    kind: input.kind,
    channel: 'log',
    payload: input.payload,
    status: 'sent',
    sentAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Gelen mesaj kaydı

function inboundRecord(ev: Extract<NormalizedWaEvent, { type: 'message' }>): { kind: MessageKind; body: string | null; payload: Record<string, unknown> } {
  const m = ev.message;
  const base: Record<string, unknown> = { type: m.kind };
  if (ev.from.name) base.profileName = ev.from.name;
  if (ev.from.username) base.username = ev.from.username;
  if (ev.referral) base.referral = ev.referral;
  if (ev.contextWamid) base.contextWamid = ev.contextWamid;
  if (ev.raw) base.raw = ev.raw;
  switch (m.kind) {
    case 'text':
      return { kind: 'text', body: m.text, payload: base };
    case 'button_reply':
      return { kind: 'button_reply', body: m.title, payload: { ...base, id: m.id, title: m.title } };
    case 'list_reply':
      return { kind: 'list_reply', body: m.title, payload: { ...base, id: m.id, title: m.title } };
    case 'location':
      return {
        kind: 'location',
        body: m.name ?? m.address ?? 'Konum paylaşıldı',
        payload: { ...base, lat: m.lat, lng: m.lng, name: m.name ?? null, address: m.address ?? null },
      };
    case 'image':
      return { kind: 'image', body: m.caption ?? 'Görsel', payload: { ...base, mediaId: m.mediaId ?? null } };
    case 'audio':
      return { kind: 'audio', body: 'Sesli mesaj', payload: { ...base, mediaId: m.mediaId ?? null } };
    case 'video':
    case 'document':
    case 'sticker': {
      const label = m.kind === 'video' ? 'Video' : m.kind === 'document' ? 'Belge' : 'Çıkartma';
      return { kind: 'system', body: m.caption ? `${label}: ${m.caption}` : label, payload: { ...base, mediaType: m.kind, mediaId: m.mediaId ?? null } };
    }
    case 'request_welcome':
      return { kind: 'system', body: 'Müşteri sohbeti açtı', payload: base };
    case 'unsupported':
      return { kind: 'system', body: 'Desteklenmeyen içerik', payload: { ...base, unsupportedType: m.type ?? null } };
  }
}

/** Gelen müşteri mesajını işler (tek transaction; konuşma başına advisory lock; wamid tekil). */
export async function handleInboundMessage(
  deps: EngineDeps,
  account: WaAccountRow,
  ev: Extract<NormalizedWaEvent, { type: 'message' }>,
  now: Date = new Date(),
): Promise<InboundResult> {
  const senderKey = ev.from.bsuid ?? ev.from.phone;
  if (!senderKey) return { status: 'ignored' };
  return deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`wa:${account.id}:${senderKey}`}, 0))`);
    const tenant = await loadTenant(tx, account.tenantId);
    const branch = await loadBranch(tx, account.tenantId, account.branchId);
    if (!tenant || !branch) return { status: 'ignored' };

    const customer = await upsertWaCustomer(tx, tenant.id, ev.from);
    const conv0 = await upsertConversation(tx, account, customer.id);
    const rec = inboundRecord(ev);
    const [inserted] = await tx
      .insert(messages)
      .values({
        tenantId: tenant.id,
        conversationId: conv0.id,
        direction: 'in',
        wamid: ev.wamid,
        kind: rec.kind,
        body: rec.body,
        payload: rec.payload,
        sentBy: 'customer',
        createdAt: now,
      })
      .onConflictDoNothing({ target: messages.wamid })
      .returning({ id: messages.id });
    if (!inserted) return { status: 'duplicate', conversationId: conv0.id };

    const inboundAt = ev.timestamp > now ? now : ev.timestamp;
    const countsUnread = ev.message.kind !== 'request_welcome';
    let mode = conv0.mode;
    let humanUntil = conv0.humanUntil;
    const expired = mode === 'human' && humanUntil != null && humanUntil <= now;
    if (expired) {
      mode = 'bot';
      humanUntil = null;
    }
    const preview = previewText(rec.body);
    const [conv] = await tx
      .update(conversations)
      .set({
        lastInboundAt: laterOf(conv0.lastInboundAt, inboundAt),
        lastMessageAt: now,
        lastMessagePreview: preview,
        unreadCount: countsUnread ? sql`${conversations.unreadCount} + 1` : conversations.unreadCount,
        mode,
        humanUntil,
        updatedAt: now,
      })
      .where(eq(conversations.id, conv0.id))
      .returning();
    await tx.update(customers).set({ lastInboundAt: inboundAt }).where(eq(customers.id, customer.id));
    await appendBranchEvent(tx, {
      tenantId: tenant.id,
      branchId: conv!.branchId,
      type: 'conversation.message',
      payload: { conversationId: conv!.id, messageId: inserted.id, direction: 'in', preview, unreadCount: conv!.unreadCount, at: now.toISOString() },
    });
    if (expired) await emitConversationUpdated(tx, conv!);

    const bot = await ensureBotState(tx, tenant.id, conv!.id);
    const ctx: Ctx = { tx, deps, now, account, tenant, branch, customer, conv: conv!, bot, msg: ev.message, seq: 0 };
    await respond(ctx);
    return { status: 'processed', messageId: inserted.id, conversationId: conv!.id };
  });
}

// ---------------------------------------------------------------------------
// Karar sırası

async function respond(ctx: Ctx): Promise<void> {
  const m = ctx.msg;
  const text = m.kind === 'text' ? m.text : '';

  // 1) Opt-out / opt-in komutları (her zaman)
  if (m.kind === 'button_reply' || m.kind === 'list_reply') {
    if (m.id === BUTTON_IDS.stopAll) return optOutAll(ctx);
    if (m.id === BUTTON_IDS.stopNo) {
      await send(ctx, m31bOptOutMarketingOnly());
      return;
    }
  }
  if (m.kind === 'text') {
    if (isOptOut(text)) return optOutMarketing(ctx);
    if (isOptIn(text)) return optIn(ctx);
  }

  const silent = humanModeActive(ctx.conv, ctx.now) || ctx.conv.optedOut || !ctx.tenant.botEnabled;

  // 2) Kara liste / askıdaki işletme → M33 (12 sa'te 1)
  if (ctx.customer.isBlocked || tenantUnavailable(ctx.tenant)) {
    if (silent) return;
    return replyOnce(ctx, 'unavailable', COOLDOWNS.unavailable, () => m33Unavailable({ subeTel: phoneText(ctx) }));
  }

  // 3) Sipariş kodu (Akış B) — insan modunda ve bot kapalıyken de işlenir
  if (m.kind === 'text') {
    const code = matchOrderCode(text);
    if (code) return linkOrderByCode(ctx, code);
  }

  // 4) Buton yanıtları
  if (m.kind === 'button_reply' || m.kind === 'list_reply') {
    if (await routeButton(ctx, m.id)) return;
  }

  // 5) "yetkili" → insana devir (her durumda)
  if (m.kind === 'text' && isHandoffRequest(text)) return startHandoff(ctx);

  // 6) İnsan modu / opt-out / bot kapalı → otomatik yanıt yok
  if (silent) return;

  // 7) Görsel / video / belge / çıkartma → yanıt yok (panelde görünür)
  if (m.kind === 'image' || m.kind === 'video' || m.kind === 'document' || m.kind === 'sticker') return;

  // 8) Açık sipariş → durum kartı (15 dk'da 1; şube kapalıyken de)
  const active = await findActiveOrder(ctx.tx, ctx.tenant.id, ctx.customer.id);
  if (active) {
    if (m.kind === 'location') return; // işletme görür
    if (m.kind === 'text' && detectIntent(text) === 'cancel') return cancelIntent(ctx, active);
    return replyOnce(ctx, 'status_card', COOLDOWNS.statusCard, () => statusCard(ctx, active));
  }

  // 9) Şube kapalı / duraklatılmış
  const sched = await schedule(ctx);
  if (sched.state === 'closed') {
    return replyOnce(ctx, 'closed', COOLDOWNS.closed, async () => m03Closed({ isletme: ctx.tenant.name, acilis: sched.acilis, menuUrl: await menuLink(ctx) }));
  }
  if (sched.state === 'paused') {
    return replyOnce(ctx, 'paused', COOLDOWNS.paused, async () =>
      m04Paused({ devamSaati: sched.pausedUntil ? formatClockTR(sched.pausedUntil) : null, menuUrl: await menuLink(ctx) }),
    );
  }

  // 10) Ses / desteklenmeyen
  if (m.kind === 'audio') return replyOnce(ctx, 'voice', COOLDOWNS.voice, async () => m29Voice({ menuUrl: await menuLink(ctx) }));
  if (m.kind === 'unsupported') return replyOnce(ctx, 'unsupported', COOLDOWNS.unsupported, () => m30Unsupported());

  // 11) SSS niyetleri (M28)
  if (m.kind === 'text') {
    const intent = detectIntent(text);
    if (intent === 'hours' || intent === 'address' || intent === 'zones' || intent === 'payment') {
      const draft = await faqDraft(ctx, intent);
      if (draft) {
        if (since(ctx, lastSent(ctx, `faq_${intent}`)) < COOLDOWNS.faq) return;
        await send(ctx, draft);
        await markSent(ctx, `faq_${intent}`);
        return;
      }
    }
  }

  // 12) Karşılama (konum dahil)
  return welcome(ctx, { force: false });
}

// ---------------------------------------------------------------------------
// Karşılama

async function welcome(ctx: Ctx, opts: { force: boolean }): Promise<void> {
  if (!opts.force) {
    const lastAuto = laterOf(ctx.conv.lastWelcomeAt, ctx.conv.lastNudgeAt);
    if (since(ctx, lastAuto) < COOLDOWNS.anyAutoReply) return; // sessiz; panelde "yanıt bekliyor"
    if (since(ctx, ctx.conv.lastWelcomeAt) < COOLDOWNS.fullWelcome) {
      await send(ctx, m01kShortWelcome({ menuUrl: await menuLink(ctx) }));
      await markSent(ctx, 'short');
      return;
    }
  }
  const sched = await schedule(ctx);
  const menuUrl = await menuLink(ctx);
  const last = await findLastDeliveredOrder(ctx.tx, ctx.tenant.id, ctx.customer.id);
  const busy = sched.state === 'busy';
  let draft: WaDraft;
  if (last) {
    const items = await orderMessageItems(ctx.tx, last.id);
    const zs = await zoneSummary(ctx.tx, ctx.branch);
    draft = m02Returning({
      ad: ctx.customer.name,
      sonTarih: formatDayMonthTR(last.placedAt),
      sonKalemler: shortItems(items),
      kapanis: sched.kapanis,
      etaAralik: ctx.branch.acceptsDelivery ? zs.etaAralik : null,
      menuUrl,
    });
    if (busy && zs.etaAralik) draft = { ...draft, body: `${draft.body}\nŞu an yoğunuz, tahmini teslimat ${zs.etaAralik}.` };
  } else {
    const zs = await zoneSummary(ctx.tx, ctx.branch);
    const pickupOnly = !ctx.branch.acceptsDelivery && ctx.branch.acceptsPickup;
    draft = m01Welcome({
      ad: ctx.customer.name,
      isletme: ctx.tenant.name,
      kapanis: sched.kapanis,
      etaAralik: zs.etaAralik,
      minSepet: zs.minSepet,
      pickupOnly,
      pickupMinutes: ctx.branch.defaultPrepMinutes + (ctx.branch.busyExtraMinutes ?? 0),
      busy,
      // Aydınlatma satırı yalnız ilk temasta (03 §9.2)
      aydinlatmaLink: ctx.conv.lastWelcomeAt ? null : `${ctx.deps.config.APP_BASE_URL.replace(/\/$/, '')}/yasal/kvkk-aydinlatma`,
      menuUrl,
    });
  }
  await send(ctx, draft);
  await markSent(ctx, 'welcome');
}

// ---------------------------------------------------------------------------
// SSS (M28)

function paymentList(b: BranchRow): string {
  const parts = b.paymentMethods
    .filter((m) => m !== 'online_card')
    .map((m) => {
      if (m === 'meal_card_on_delivery' && b.mealCardBrands.length) {
        return `${PAYMENT_METHOD_LABELS[m]} (${b.mealCardBrands.map((x) => MEAL_CARD_BRAND_LABELS[x]).join(', ')})`;
      }
      return PAYMENT_METHOD_LABELS[m];
    });
  return parts.join(', ');
}

async function faqDraft(ctx: Ctx, intent: 'hours' | 'address' | 'zones' | 'payment'): Promise<WaDraft | null> {
  const sched = await schedule(ctx);
  switch (intent) {
    case 'hours':
      if (!sched.bugunAcilis || !sched.kapanis) return null;
      return m28aHours({ bugunAcilis: sched.bugunAcilis, kapanis: sched.kapanis, bilgiLink: storefrontUrl(ctx.deps.config, ctx.tenant.slug), menuUrl: await menuLink(ctx) });
    case 'address': {
      if (ctx.branch.lat == null || ctx.branch.lng == null || !ctx.branch.addressLine) return null;
      const adres = [branchShortAddress(ctx.branch), `${ctx.branch.district}/${ctx.branch.city}`].join(', ');
      return m28bAddress({ subeAdres: adres, haritaLink: `https://maps.google.com/?q=${ctx.branch.lat},${ctx.branch.lng}`, menuUrl: await menuLink(ctx) });
    }
    case 'zones': {
      const zs = await zoneSummary(ctx.tx, ctx.branch);
      if (!zs.ucretAralik || !zs.minAralik) return null;
      return m28cZones({ ucretAralik: zs.ucretAralik, minAralik: zs.minAralik, menuUrl: await menuLink(ctx) });
    }
    case 'payment': {
      const list = paymentList(ctx.branch);
      if (!list) return null;
      return m28dPayments({ odemeListesi: list, menuUrl: await menuLink(ctx) });
    }
  }
}

// ---------------------------------------------------------------------------
// Açık sipariş

async function statusCard(ctx: Ctx, order: OrderRow): Promise<WaDraft> {
  let courierName: string | null = null;
  if (order.courierUserId) {
    const [u] = await ctx.tx.select({ name: users.name }).from(users).where(eq(users.id, order.courierUserId));
    courierName = u?.name?.split(/\s+/)[0] ?? null;
  }
  const eta = order.estimatedReadyAt ? formatClockTR(order.estimatedReadyAt) : null;
  const label = trackingStatusLabel(order.status, { fulfillmentType: order.fulfillmentType, courierName });
  const showEta = eta && (order.status === 'accepted' || order.status === 'preparing' || order.status === 'on_the_way');
  return m26StatusCard({
    no: formatOrderNo(order.number),
    durumEtiketi: label,
    saat: showEta ? eta : null,
    trackingUrl: orderTrackingUrl(ctx.deps.config, order.id),
  });
}

/** "iptal" niyeti (açık sipariş): new → M27a (onay butonları); accepted+ → M27b + iptal talebi + insana devir. */
async function cancelIntent(ctx: Ctx, order: OrderRow): Promise<void> {
  if (since(ctx, lastSent(ctx, 'cancel_intent')) < COOLDOWNS.cancelIntent) return;
  if (order.status === 'new') {
    await send(ctx, m27aCancelConfirm({ no: formatOrderNo(order.number), orderId: order.id }), { orderId: order.id });
  } else {
    await requestCancellation(ctx, order);
  }
  await markSent(ctx, 'cancel_intent');
}

async function requestCancellation(ctx: Ctx, order: OrderRow): Promise<void> {
  const inserted = await ctx.tx
    .insert(cancellationRequests)
    .values({ tenantId: order.tenantId, orderId: order.id, requestedAt: ctx.now, reason: 'whatsapp' })
    .onConflictDoNothing()
    .returning({ id: cancellationRequests.id });
  if (inserted.length) {
    const [updated] = await ctx.tx.update(orders).set({ cancelRequestedAt: ctx.now }).where(eq(orders.id, order.id)).returning();
    if (updated) await emitOrderUpdated(ctx.tx, { order: updated, change: 'cancel_request' });
  }
  await send(ctx, m27bCancelRequested(), { orderId: order.id });
  await setHumanMode(ctx, COOLDOWNS.handoffMode);
}

// ---------------------------------------------------------------------------
// Akış B: sipariş kodu

async function codeFailure(ctx: Ctx): Promise<void> {
  const inWindow = ctx.bot.codeFailSince && since(ctx, ctx.bot.codeFailSince) < COOLDOWNS.codeFailWindow;
  const count = inWindow ? ctx.bot.codeFailCount + 1 : 1;
  const [b] = await ctx.tx
    .update(conversationBotState)
    .set({ codeFailCount: count, codeFailSince: inWindow ? ctx.bot.codeFailSince : ctx.now, updatedAt: ctx.now })
    .where(eq(conversationBotState.conversationId, ctx.conv.id))
    .returning();
  if (b) ctx.bot = b;
  if (count > CODE_FAIL_LIMIT) {
    // Kaba kuvvete karşı sessiz + panele not (bir kez)
    if (count === CODE_FAIL_LIMIT + 1) {
      await logNotification(ctx.tx, {
        tenantId: ctx.tenant.id,
        branchId: ctx.conv.branchId,
        kind: 'order_code_attempts',
        payload: { conversationId: ctx.conv.id, attempts: count },
      });
    }
    return;
  }
  await send(ctx, m17bCodeNotFound({ menuUrl: await menuLink(ctx) }));
}

async function linkOrderByCode(ctx: Ctx, code: string): Promise<void> {
  const rows = await ctx.tx
    .select({ vc: orderVerificationCodes, order: orders })
    .from(orderVerificationCodes)
    .innerJoin(orders, eq(orders.id, orderVerificationCodes.orderId))
    .where(and(eq(orderVerificationCodes.tenantId, ctx.tenant.id), eq(orderVerificationCodes.code, code)))
    .orderBy(sql`${orderVerificationCodes.usedAt} is not null`, desc(orderVerificationCodes.createdAt))
    .limit(1);
  const hit = rows[0];
  if (!hit) return codeFailure(ctx);
  const { vc, order } = hit;

  const isAwaiting = order.status === 'awaiting_customer';
  if (isAwaiting && !vc.usedAt && vc.expiresAt > ctx.now) {
    await ctx.tx.update(orderVerificationCodes).set({ usedAt: ctx.now }).where(eq(orderVerificationCodes.id, vc.id));
    const res = await transitionOrder(ctx.tx, {
      orderId: order.id,
      tenantId: ctx.tenant.id,
      to: 'new',
      actor: { type: 'customer' },
      extra: {
        verificationMethod: 'wa_code',
        customerId: ctx.customer.id,
        conversationId: ctx.conv.id,
        statusNotifyChannel: 'whatsapp',
      },
      now: ctx.now,
    });
    await ctx.tx
      .update(customers)
      .set({
        orderCount: sql`${customers.orderCount} + 1`,
        lastOrderAt: ctx.now,
        name: sql`coalesce(${customers.name}, ${order.customerName})`,
        updatedAt: ctx.now,
      })
      .where(eq(customers.id, ctx.customer.id));
    const [c] = await ctx.tx
      .update(conversations)
      .set({ activeOrderId: order.id, state: 'order_active', updatedAt: ctx.now })
      .where(eq(conversations.id, ctx.conv.id))
      .returning();
    if (c) ctx.conv = c;
    if (res.order.testKind === 'canary') return;
    // M05 anında (debounce yok; pencereyi müşteri açtı)
    if (await reserveStatusBudget(ctx.tx, order.id)) {
      const items = await orderMessageItems(ctx.tx, order.id);
      await send(
        ctx,
        m05Received({
          no: formatOrderNo(res.order.number),
          kalemler: formatItemsList(items),
          toplam: formatTL(res.order.totalKurus),
          odeme: paymentText(res.order.paymentMethod, res.order.mealCardBrand),
          trackingUrl: orderTrackingUrl(ctx.deps.config, order.id),
          isletme: ctx.tenant.name,
        }),
        { orderId: order.id, statusMessage: true },
      );
    }
    return;
  }
  const alreadyConfirmed = order.status !== 'awaiting_customer' && order.status !== 'cancelled' && order.status !== 'rejected';
  if (alreadyConfirmed) {
    await send(ctx, m17dCodeAlreadyUsed({ trackingUrl: orderTrackingUrl(ctx.deps.config, order.id) }), { orderId: order.id });
    return;
  }
  if (vc.expiresAt <= ctx.now || order.status === 'cancelled' || order.status === 'rejected') {
    await send(ctx, m17cCodeExpired({ menuUrl: await menuLink(ctx) }));
    return;
  }
  return codeFailure(ctx);
}

// ---------------------------------------------------------------------------
// Butonlar

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RE_REVIEW = new RegExp(`^review:(${UUID}):(good|ok|bad)$`, 'i');
const RE_REVIEW_REASON = new RegExp(`^review_reason:(${UUID}):([a-z_]+)$`, 'i');
const RE_WAIT = new RegExp(`^wait:(${UUID})$`, 'i');
const RE_CANCEL = new RegExp(`^cancel:(${UUID})$`, 'i');
const RE_KEEP = new RegExp(`^keep:(${UUID})$`, 'i');

/** Butona bağlı sipariş: aynı tenant ve bu müşteri/konuşmanın siparişi olmalı. */
async function ownOrder(ctx: Ctx, orderId: string): Promise<OrderRow | null> {
  const [o] = await ctx.tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, ctx.tenant.id)));
  if (!o) return null;
  if (o.customerId !== ctx.customer.id && o.conversationId !== ctx.conv.id) return null;
  return o;
}

async function routeButton(ctx: Ctx, id: string): Promise<boolean> {
  if (id === BUTTON_IDS.menu) {
    if (!humanModeActive(ctx.conv, ctx.now)) await welcome(ctx, { force: true });
    return true;
  }
  if (id === BUTTON_IDS.human) {
    await startHandoff(ctx);
    return true;
  }
  let m: RegExpExecArray | null;
  if ((m = RE_REVIEW.exec(id))) {
    const order = await ownOrder(ctx, m[1]!.toLowerCase());
    if (order) await handleReview(ctx, order, m[2] as 'good' | 'ok' | 'bad');
    return true;
  }
  if ((m = RE_REVIEW_REASON.exec(id))) {
    const order = await ownOrder(ctx, m[1]!.toLowerCase());
    if (order) await handleReviewReason(ctx, order, m[2]!);
    return true;
  }
  if ((m = RE_WAIT.exec(id))) {
    const order = await ownOrder(ctx, m[1]!.toLowerCase());
    if (order) await handleWait(ctx, order);
    return true;
  }
  if ((m = RE_CANCEL.exec(id))) {
    const order = await ownOrder(ctx, m[1]!.toLowerCase());
    if (order) await handleCancel(ctx, order);
    return true;
  }
  if (RE_KEEP.test(id)) return true; // "Vazgeçtim": yanıt yok
  return false;
}

async function handleReview(ctx: Ctx, order: OrderRow, rating: 'good' | 'ok' | 'bad'): Promise<void> {
  if (order.status !== 'delivered') return;
  const inserted = await ctx.tx
    .insert(reviews)
    .values({ tenantId: order.tenantId, orderId: order.id, customerId: ctx.customer.id, rating, createdAt: ctx.now })
    .onConflictDoNothing({ target: reviews.orderId })
    .returning({ id: reviews.id });
  if (!inserted.length) return; // zaten değerlendirilmiş (takip sayfası ya da önceki buton)
  if (rating === 'good') {
    await send(ctx, m10aReviewGood(), { orderId: order.id });
  } else if (rating === 'ok') {
    await send(ctx, m10dReviewOk(), { orderId: order.id });
  } else {
    await logNotification(ctx.tx, {
      tenantId: order.tenantId,
      branchId: order.branchId,
      orderId: order.id,
      kind: 'review_negative',
      payload: { orderId: order.id, number: order.number, rating },
    });
    const d = m10bReviewBad();
    await send(
      ctx,
      {
        code: d.code,
        spec: {
          type: 'interactive',
          interactive: {
            kind: 'list',
            body: d.body,
            list: {
              buttonTitle: 'Sorunu seç',
              sections: [{ rows: M10B_REASONS.map((r) => ({ id: `review_reason:${order.id}:${r.id}`, title: r.title })) }],
            },
          },
        },
      },
      { orderId: order.id },
    );
  }
}

async function handleReviewReason(ctx: Ctx, order: OrderRow, reasonId: string): Promise<void> {
  const reason = M10B_REASONS.find((r) => r.id === reasonId);
  if (!reason) return;
  const key = `review_reason:${order.id}` as const;
  if (lastSent(ctx, key)) return;
  await ctx.tx
    .update(reviews)
    .set({ comment: sql`case when ${reviews.comment} is null or ${reviews.comment} = '' then ${reason.title} else ${reviews.comment} || '; ' || ${reason.title} end` })
    .where(and(eq(reviews.orderId, order.id), eq(reviews.tenantId, order.tenantId)));
  await send(ctx, m10cReviewThanks({ isletme: ctx.tenant.name, other: reason.id === 'other' }), { orderId: order.id });
  await markSent(ctx, key);
}

async function handleWait(ctx: Ctx, order: OrderRow): Promise<void> {
  if (order.status !== 'new') return;
  const key = `wait:${order.id}` as const;
  if (lastSent(ctx, key)) return;
  await ctx.tx.insert(orderEvents).values({
    tenantId: order.tenantId,
    orderId: order.id,
    type: 'customer_waiting',
    actorType: 'customer',
    note: 'Müşteri bekliyor',
    createdAt: ctx.now,
  });
  await emitOrderUpdated(ctx.tx, { order, change: 'customer_waiting' });
  await send(ctx, m13aWaiting(), { orderId: order.id });
  await markSent(ctx, key);
}

async function handleCancel(ctx: Ctx, order: OrderRow): Promise<void> {
  if (order.status === 'new' || order.status === 'awaiting_customer') {
    // Müşteri iptali; M12b sipariş bildirim kancasından gider
    await transitionOrder(ctx.tx, {
      orderId: order.id,
      tenantId: order.tenantId,
      to: 'cancelled',
      actor: { type: 'customer' },
      reason: 'customer_request',
      cancelledBy: 'customer',
      now: ctx.now,
    });
    return;
  }
  if (order.status === 'accepted' || order.status === 'preparing' || order.status === 'ready' || order.status === 'on_the_way') {
    if (order.cancelRequestedAt) return;
    await requestCancellation(ctx, order);
  }
}

// ---------------------------------------------------------------------------
// İnsana devir, opt-out

async function setHumanMode(ctx: Ctx, durationMs: number): Promise<void> {
  const keepIndefinite = ctx.conv.mode === 'human' && ctx.conv.humanUntil == null;
  const until = keepIndefinite ? null : new Date(Math.max(ctx.now.getTime() + durationMs, ctx.conv.humanUntil?.getTime() ?? 0));
  const [c] = await ctx.tx
    .update(conversations)
    .set({ mode: 'human', humanUntil: until, updatedAt: ctx.now })
    .where(eq(conversations.id, ctx.conv.id))
    .returning();
  if (c) {
    ctx.conv = c;
    await emitConversationUpdated(ctx.tx, c);
  }
}

async function startHandoff(ctx: Ctx): Promise<void> {
  await setHumanMode(ctx, COOLDOWNS.handoffMode);
  await logNotification(ctx.tx, {
    tenantId: ctx.tenant.id,
    branchId: ctx.conv.branchId,
    kind: 'conversation_handoff',
    payload: { conversationId: ctx.conv.id, customerName: ctx.customer.name ?? null },
  });
  const sched = await schedule(ctx);
  const inHours = sched.state === 'open' || sched.state === 'busy';
  await send(ctx, m20Handoff({ inHours, acilis: sched.acilis }));
}

async function optOutMarketing(ctx: Ctx): Promise<void> {
  const [b] = await ctx.tx
    .update(conversationBotState)
    .set({ marketingOptOutAt: ctx.now, updatedAt: ctx.now })
    .where(eq(conversationBotState.conversationId, ctx.conv.id))
    .returning();
  if (b) ctx.bot = b;
  await send(ctx, m31OptOut());
}

async function optOutAll(ctx: Ctx): Promise<void> {
  const [b] = await ctx.tx
    .update(conversationBotState)
    .set({ optedOutAt: ctx.now, marketingOptOutAt: ctx.bot.marketingOptOutAt ?? ctx.now, updatedAt: ctx.now })
    .where(eq(conversationBotState.conversationId, ctx.conv.id))
    .returning();
  if (b) ctx.bot = b;
  const [c] = await ctx.tx.update(conversations).set({ optedOut: true, updatedAt: ctx.now }).where(eq(conversations.id, ctx.conv.id)).returning();
  if (c) ctx.conv = c;
  await send(ctx, m31aOptOutAll());
}

async function optIn(ctx: Ctx): Promise<void> {
  const [b] = await ctx.tx
    .update(conversationBotState)
    .set({ optedOutAt: null, updatedAt: ctx.now })
    .where(eq(conversationBotState.conversationId, ctx.conv.id))
    .returning();
  if (b) ctx.bot = b;
  const [c] = await ctx.tx.update(conversations).set({ optedOut: false, updatedAt: ctx.now }).where(eq(conversations.id, ctx.conv.id)).returning();
  if (c) ctx.conv = c;
  await send(ctx, m32OptIn());
}

// ---------------------------------------------------------------------------
// Echo (Coexistence) ve durum olayları

/** İşletme telefonundan yazılan mesaj: 'business_phone' olarak kaydedilir, bot 30 dk susar (insan modu). */
export async function handleEcho(
  deps: EngineDeps,
  account: WaAccountRow,
  ev: Extract<NormalizedWaEvent, { type: 'echo' }>,
  now: Date = new Date(),
): Promise<InboundResult> {
  const key = ev.to.bsuid ?? ev.to.phone;
  if (!key) return { status: 'ignored' };
  return deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`wa:${account.id}:${key}`}, 0))`);
    const customer = await upsertWaCustomer(tx, account.tenantId, ev.to);
    const conv0 = await upsertConversation(tx, account, customer.id);
    const body = ev.text ?? (ev.messageType ? `[${ev.messageType}]` : '');
    const [inserted] = await tx
      .insert(messages)
      .values({
        tenantId: account.tenantId,
        conversationId: conv0.id,
        direction: 'out',
        wamid: ev.wamid,
        kind: 'echo',
        body,
        payload: { type: 'echo', messageType: ev.messageType ?? 'text' },
        status: 'sent',
        sentBy: 'business_phone',
        createdAt: now,
      })
      .onConflictDoNothing({ target: messages.wamid })
      .returning({ id: messages.id });
    if (!inserted) return { status: 'duplicate', conversationId: conv0.id };
    const keepIndefinite = conv0.mode === 'human' && conv0.humanUntil == null;
    const until = keepIndefinite ? null : new Date(Math.max(now.getTime() + COOLDOWNS.echoMute, conv0.humanUntil?.getTime() ?? 0));
    const preview = previewText(body);
    const [conv] = await tx
      .update(conversations)
      .set({ mode: 'human', humanUntil: until, lastMessageAt: now, lastMessagePreview: preview, updatedAt: now })
      .where(eq(conversations.id, conv0.id))
      .returning();
    await appendBranchEvent(tx, {
      tenantId: account.tenantId,
      branchId: conv!.branchId,
      type: 'conversation.message',
      payload: { conversationId: conv!.id, messageId: inserted.id, direction: 'out', preview, unreadCount: conv!.unreadCount, at: now.toISOString() },
    });
    await emitConversationUpdated(tx, conv!);
    return { status: 'processed', messageId: inserted.id, conversationId: conv!.id };
  });
}

const STATUS_RANK_SQL = (col: unknown) => sql`(case coalesce(${col}, 'queued') when 'queued' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 9 end)`;
const NEW_RANK: Record<'sent' | 'delivered' | 'read' | 'failed', number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

/** Durum olayı: sent < delivered < read; failed yalnız teslimden önce (02 §7.4). */
export async function applyStatus(deps: EngineDeps, account: WaAccountRow, ev: Extract<NormalizedWaEvent, { type: 'status' }>): Promise<boolean> {
  const rank = NEW_RANK[ev.status];
  const rows = await deps.db.execute<{ id: string; conversation_id: string }>(sql`
    update messages
       set status = ${ev.status},
           error_code = coalesce(${ev.errorCode ?? null}, error_code),
           updated_at = now()
     where wamid = ${ev.wamid}
       and tenant_id = ${account.tenantId}
       and ${STATUS_RANK_SQL(messages.status)} < ${rank}
       and not (${ev.status} = 'failed' and status in ('delivered', 'read'))
     returning id, conversation_id`);
  const updated = (rows as unknown as { id: string; conversation_id: string }[])[0];
  // BSUID her status'ta gelir → telefona gönderilen mesajda müşteriye bağlanır (02 §7.4)
  if (updated && ev.recipient?.bsuid) {
    await deps.db.execute(sql`
      update customers c set wa_bsuid = ${ev.recipient.bsuid}, updated_at = now()
        from conversations cv
       where cv.id = ${updated.conversation_id} and c.id = cv.customer_id and c.wa_bsuid is null
         and not exists (select 1 from customers x where x.tenant_id = c.tenant_id and x.wa_bsuid = ${ev.recipient.bsuid})`);
  }
  return !!updated;
}

// ---------------------------------------------------------------------------
// Toplu işleme

export interface ProcessEventsSummary {
  messages: number;
  duplicates: number;
  statuses: number;
  echoes: number;
}

export async function processWaEvents(
  deps: EngineDeps,
  account: WaAccountRow,
  events: NormalizedWaEvent[],
  opts: { now?: Date } = {},
): Promise<ProcessEventsSummary> {
  const summary: ProcessEventsSummary = { messages: 0, duplicates: 0, statuses: 0, echoes: 0 };
  for (const ev of events) {
    const now = opts.now ?? new Date();
    if (ev.type === 'message') {
      const r = await handleInboundMessage(deps, account, ev, now);
      if (r.status === 'processed') summary.messages++;
      else if (r.status === 'duplicate') summary.duplicates++;
    } else if (ev.type === 'status') {
      if (await applyStatus(deps, account, ev)) summary.statuses++;
    } else if (ev.type === 'echo') {
      const r = await handleEcho(deps, account, ev, now);
      if (r.status === 'processed') summary.echoes++;
      else if (r.status === 'duplicate') summary.duplicates++;
    }
  }
  return summary;
}
