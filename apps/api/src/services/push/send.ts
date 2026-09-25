// `push.send` işi (00 §10 alarm t=0 "ses + Web Push", 04 §4.5): sipariş `new` olunca şubeye erişen panel
// kullanıcılarının kayıtlı cihazlarına bildirim. Yük asgari: "Yeni sipariş #1051", "3 ürün · 245,00 TL", /panel;
// müşteri adı/telefonu/adresi yok, mutfakta tutar da yok (00 §4). Canary hiçbir dış bildirim üretmez; kurulum testi
// (onboarding_test) sahibinin kendi denemesidir, "TEST #…" etiketiyle gider.
//
// Sonuçlar: başarı → last_success_at; 404/410 → abonelik kapatılır; diğer 4xx → yalnız kayıt; 5xx/408/429/ağ →
// o abonelik için ayrı `push.send` işi (subscriptionId ile) iş kurallarıyla (geri çekilme, en çok 3 deneme) yeniden
// dener. Yeniden denemede sipariş artık `new` değilse gönderilmez.

import { newOrderPushText, PUSH_TEST_TEXT } from '@siparis/core';
import { PUSH_OPEN_URL, type PushPayload } from '@siparis/core/notifications/contracts';
import { orderItems, orders, pushSubscriptions, type Database } from '@siparis/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../../config';
import { enqueueJob } from '../../lib/jobs';
import { isPushAvailable, pushHost, sendWebPush, type PushSendResult } from './client';
import { listPushRecipients, recordPushResult } from './subscriptions';

export const PUSH_SEND_JOB = 'push.send';
/** Push işlerinin deneme sınırı: geç kalan bildirim işe yaramaz, sonraki alarm basamakları devrededir. */
export const PUSH_MAX_ATTEMPTS = 3;
/** Yeniden deneme işinin ilk gecikmesi. */
export const PUSH_RETRY_DELAY_MS = 5_000;

export interface PushSendPayload {
  orderId: string;
  tenantId: string;
  /** Verilirse yalnız bu abonelik (yeniden deneme işi) */
  subscriptionId?: string | null;
  [key: string]: unknown;
}

export const pushOrderDedupeKey = (orderId: string) => `push:new_order:${orderId}`;
export const pushRetryDedupeKey = (orderId: string, subscriptionId: string) => `push:new_order:${orderId}:${subscriptionId}`;

/** Sipariş `new` olunca t=0 bildirimini kuyruğa atar (alarm zinciriyle aynı transaction'da; sipariş başına tek). */
export async function enqueueNewOrderPush(tx: Database, order: { id: string; tenantId: string; testKind: string | null }): Promise<void> {
  if (order.testKind === 'canary') return;
  await enqueueJob(tx, {
    queue: 'notify',
    type: PUSH_SEND_JOB,
    tenantId: order.tenantId,
    dedupeKey: pushOrderDedupeKey(order.id),
    maxAttempts: PUSH_MAX_ATTEMPTS,
    payload: { orderId: order.id, tenantId: order.tenantId },
  });
}

export interface PushDeps {
  db: Database;
  config: Config;
  log: FastifyBaseLogger;
}

export interface PushSendOutcome {
  status: 'sent' | 'skipped' | 'disabled';
  reason?: string;
  sent: number;
  disabled: number;
  failed: number;
  retrying: number;
}

/** Yeniden denenebilir hata: tek abonelik işinde iş kuralları (geri çekilme) devreye girsin diye fırlatılır. */
export class PushRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushRetryableError';
  }
}

export async function handlePushSend(deps: PushDeps, payload: PushSendPayload): Promise<PushSendOutcome> {
  const { db, config, log } = deps;
  const outcome: PushSendOutcome = { status: 'skipped', sent: 0, disabled: 0, failed: 0, retrying: 0 };
  if (!isPushAvailable(config, log)) return { ...outcome, status: 'disabled' };

  const [order] = await db
    .select({
      id: orders.id,
      tenantId: orders.tenantId,
      branchId: orders.branchId,
      number: orders.number,
      status: orders.status,
      totalKurus: orders.totalKurus,
      testKind: orders.testKind,
      rejectionScheduledAt: orders.rejectionScheduledAt,
    })
    .from(orders)
    .where(and(eq(orders.id, payload.orderId), eq(orders.tenantId, payload.tenantId)));
  if (!order) return { ...outcome, reason: 'order_not_found' };
  if (order.testKind === 'canary') return { ...outcome, reason: 'canary' };
  // Bu arada onaylanan/reddedilen siparişin bildirimi eskimiştir
  if (order.status !== 'new' || order.rejectionScheduledAt) return { ...outcome, reason: 'not_waiting' };

  const recipients = await listPushRecipients(db, { tenantId: order.tenantId, branchId: order.branchId, subscriptionId: payload.subscriptionId });
  if (!recipients.length) return { ...outcome, reason: 'no_subscriptions' };

  const [items] = await db
    .select({ count: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, order.id), eq(orderItems.tenantId, order.tenantId)));
  const test = order.testKind === 'onboarding_test';
  const full = newOrderPushText({ number: order.number, itemCount: items?.count ?? 0, totalKurus: order.totalKurus, test });
  const kitchen = newOrderPushText({ number: order.number, itemCount: items?.count ?? 0, totalKurus: null, test });
  const topic = order.id.replace(/-/g, '');

  const results = await Promise.all(
    recipients.map(async (r) => {
      const text = r.role === 'kitchen' ? kitchen : full;
      const body: PushPayload = { kind: 'new_order', title: text.title, body: text.body, url: PUSH_OPEN_URL, tag: order.id, orderId: order.id };
      const result = await sendWebPush(config, r, body, { topic });
      await recordPushResult(db, order.tenantId, r.id, result);
      return { recipient: r, result };
    }),
  );

  const retryable: string[] = [];
  let retryError = '';
  for (const { recipient, result } of results) {
    if (result.ok) {
      outcome.sent++;
      continue;
    }
    if (result.kind === 'gone') outcome.disabled++;
    else if (result.kind === 'rejected') outcome.failed++;
    else {
      retryable.push(recipient.id);
      retryError = result.error;
    }
    log.warn({ orderId: order.id, host: pushHost(recipient.endpoint), kind: result.kind, error: result.error }, 'push gönderilemedi');
  }

  if (retryable.length) {
    if (payload.subscriptionId) {
      // Tek abonelik işi: iş kurallarıyla (geri çekilme, deneme sınırı) yeniden denenir
      throw new PushRetryableError(`push gönderilemedi, yeniden denenecek (${retryError})`);
    }
    for (const id of retryable) {
      await enqueueJob(db, {
        queue: 'notify',
        type: PUSH_SEND_JOB,
        tenantId: order.tenantId,
        delayMs: PUSH_RETRY_DELAY_MS,
        dedupeKey: pushRetryDedupeKey(order.id, id),
        maxAttempts: PUSH_MAX_ATTEMPTS,
        payload: { orderId: order.id, tenantId: order.tenantId, subscriptionId: id },
      });
    }
    outcome.retrying = retryable.length;
  }
  outcome.status = outcome.sent > 0 ? 'sent' : 'skipped';
  if (!outcome.sent) outcome.reason = 'no_delivery';
  return outcome;
}

export type PushTestOutcome = { sent: boolean; reason: 'not_found' | 'disabled' | 'failed' | 'push_disabled' | null };

/** Ayarlar › "Test bildirimi gönder": yalnız çağıranın bu işletmedeki, bu cihaza ait etkin aboneliği. */
export async function sendPushTest(deps: PushDeps, input: { tenantId: string; userId: string; endpoint: string }): Promise<PushTestOutcome> {
  const { db, config, log } = deps;
  if (!isPushAvailable(config, log)) return { sent: false, reason: 'push_disabled' };
  const [sub] = await db
    .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.tenantId, input.tenantId),
        eq(pushSubscriptions.userId, input.userId),
        eq(pushSubscriptions.endpoint, input.endpoint),
        isNull(pushSubscriptions.disabledAt),
      ),
    );
  if (!sub) return { sent: false, reason: 'not_found' };
  const result: PushSendResult = await sendWebPush(
    config,
    sub,
    { kind: 'test', title: PUSH_TEST_TEXT.title, body: PUSH_TEST_TEXT.body, url: '/panel/ayarlar/bildirimler/cihaz', tag: 'push-test', orderId: null },
    { ttlSeconds: 60 },
  );
  await recordPushResult(db, input.tenantId, sub.id, result);
  if (result.ok) return { sent: true, reason: null };
  log.warn({ host: pushHost(sub.endpoint), kind: result.kind, error: result.error }, 'test bildirimi gönderilemedi');
  return { sent: false, reason: result.kind === 'gone' ? 'disabled' : 'failed' };
}
