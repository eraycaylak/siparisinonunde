// Dilim 3 (WhatsApp + SMS) test yardımcıları.

import {
  conversations,
  customers,
  jobs,
  messages,
  orderVerificationCodes,
  orders,
  users,
  waAccounts,
  deliveryZones,
  type Database,
} from '@siparis/db';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import pino from 'pino';
import { getJobHandler, type JobRow } from '../src/lib/jobs';
import { randomToken } from '../src/lib/tokens';
import { buildEchoPayload, buildInboundPayload, buildStatusPayload, type DevInboundMessage, type DevSender } from '../src/services/messaging/dev-payload';
import { ingestWebhookPayload, processWebhookEvent } from '../src/services/messaging/ingest';
import type { OutboundPayload } from '../src/services/messaging/outbound';
import { recordOrderCreated, transitionOrderTx } from '../src/services/orders/transition';
import type { WaAccountRow } from '../src/wa/registry';
import type { TestContext, TestTenant } from './helpers';

export const silentLog = pino({ level: 'silent' });

export interface WaSetup extends TestTenant {
  account: WaAccountRow;
}

/** Tenant + sahip (telefonlu) + mock WhatsApp hesabı (connected) + bir teslimat bölgesi. */
export async function setupWaTenant(ctx: TestContext, opts: { name?: string; ownerPhone?: string; provider?: 'mock' | 'cloud' | 'd360' } = {}): Promise<WaSetup> {
  const t = await ctx.createTenantWithOwner({ name: opts.name });
  await ctx.db.update(users).set({ phone: opts.ownerPhone ?? `+90555${Math.floor(1000000 + Math.random() * 8999999)}` }).where(eq(users.id, t.owner.id));
  const [account] = await ctx.db
    .insert(waAccounts)
    .values({
      tenantId: t.tenantId,
      branchId: t.branchId,
      provider: opts.provider ?? 'mock',
      displayPhone: '+905550000099',
      phoneNumberId: `pn-${randomToken(6)}`,
      wabaId: 'waba-test',
      webhookToken: `tok-${randomToken(12)}`,
      status: 'connected',
    })
    .returning();
  await ctx.db.insert(deliveryZones).values({
    tenantId: t.tenantId,
    branchId: t.branchId,
    name: 'Merkez',
    kind: 'neighborhoods',
    neighborhoods: ['Merkez'],
    feeKurus: 2000,
    minOrderKurus: 15000,
    etaMinutes: 30,
  });
  return { ...t, account: account! };
}

/** Müşteri mesajını webhook hattından (ham olay + işleme) geçirir; `now` sahte saat. */
export async function inbound(
  ctx: TestContext,
  account: WaAccountRow,
  from: DevSender,
  message: DevInboundMessage,
  opts: { now?: Date; wamid?: string } = {},
) {
  const now = opts.now ?? new Date();
  const { payload, wamid } = buildInboundPayload(account, from, message, { at: now, wamid: opts.wamid });
  const { webhookEventId } = await ingestWebhookPayload(ctx.db, account, payload);
  const summary = await processWebhookEvent({ db: ctx.db, config: ctx.config, log: silentLog }, webhookEventId, { now });
  return { wamid, webhookEventId, summary };
}

export async function echo(ctx: TestContext, account: WaAccountRow, to: DevSender, text: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const { payload, wamid } = buildEchoPayload(account, to, text, { at: now });
  const { webhookEventId } = await ingestWebhookPayload(ctx.db, account, payload);
  await processWebhookEvent({ db: ctx.db, config: ctx.config, log: silentLog }, webhookEventId, { now });
  return { wamid };
}

export async function statusEvent(ctx: TestContext, account: WaAccountRow, s: Parameters<typeof buildStatusPayload>[1]) {
  const payload = buildStatusPayload(account, s);
  const { webhookEventId } = await ingestWebhookPayload(ctx.db, account, payload);
  return processWebhookEvent({ db: ctx.db, config: ctx.config, log: silentLog }, webhookEventId);
}

/**
 * Belirli türdeki bekleyen işleri (run_at ≤ now) doğrudan çalıştırır ve 'done' yapar. Diğer dilimlerin aynı
 * kuyruktaki işlerine dokunmaz. İşlenen iş sayısını döner.
 */
export async function runJobs(ctx: TestContext, types: string[], now: Date = new Date(Date.now() + 3_600_000)): Promise<number> {
  let total = 0;
  for (let round = 0; round < 10; round++) {
    const due = await ctx.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, 'pending'), inArray(jobs.type, types), lte(jobs.runAt, now)))
      .orderBy(asc(jobs.runAt), asc(jobs.createdAt));
    if (!due.length) break;
    for (const j of due) {
      const handler = getJobHandler(j.type);
      if (!handler) throw new Error(`işleyici yok: ${j.type}`);
      const row: JobRow = {
        id: j.id,
        queue: j.queue,
        type: j.type,
        payload: (j.payload ?? {}) as Record<string, unknown>,
        runAt: j.runAt,
        attempts: j.attempts + 1,
        maxAttempts: j.maxAttempts,
        tenantId: j.tenantId,
        dedupeKey: j.dedupeKey,
      };
      await ctx.db.update(jobs).set({ status: 'running', attempts: j.attempts + 1 }).where(eq(jobs.id, j.id));
      try {
        await handler(row.payload, { db: ctx.db, config: ctx.config, log: silentLog, job: row });
        await ctx.db.update(jobs).set({ status: 'done', finishedAt: new Date() }).where(eq(jobs.id, j.id));
      } catch (err) {
        await ctx.db
          .update(jobs)
          .set({ status: 'pending', lastError: String(err), runAt: sql`now() + interval '1 hour'` })
          .where(eq(jobs.id, j.id));
        throw err;
      }
      total++;
    }
  }
  return total;
}

/** Giden mesajları (wa.send) gönderir. */
export const flushOutbound = (ctx: TestContext, now?: Date) => runJobs(ctx, ['wa.send'], now);
/** Bildirim işlerini (+ ardından wa.send) çalıştırır. */
export async function flushNotify(ctx: TestContext, now?: Date) {
  const n = await runJobs(ctx, ['order.received_debounced', 'order.notify_customer', 'platform.alert', 'sms.send'], now);
  await flushOutbound(ctx, now);
  return n;
}

export async function conversationFor(db: Database, account: WaAccountRow, phone: string) {
  const [row] = await db
    .select({ c: conversations })
    .from(conversations)
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .where(and(eq(conversations.waAccountId, account.id), eq(customers.phoneE164, phone)));
  return row?.c;
}

export async function threadRows(db: Database, conversationId: string) {
  return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt), asc(messages.id));
}

/** Giden bot mesajlarının M-kodları (sırayla). */
export async function outCodes(db: Database, conversationId: string): Promise<string[]> {
  const rows = await threadRows(db, conversationId);
  return rows.filter((r) => r.direction === 'out').map((r) => String((r.payload as unknown as OutboundPayload | null)?.code ?? r.kind));
}

export async function lastOut(db: Database, conversationId: string) {
  const rows = await threadRows(db, conversationId);
  const out = rows.filter((r) => r.direction === 'out');
  return out[out.length - 1];
}

export async function pendingJobs(db: Database, type: string) {
  return db.select().from(jobs).where(and(eq(jobs.type, type), eq(jobs.status, 'pending')));
}

/** Sipariş satırı + oluşturma kaydı (onOrderCreated kancaları çalışır). */
export async function createOrderWithHooks(
  ctx: TestContext,
  t: { tenantId: string; branchId: string },
  opts: { status?: (typeof orders.$inferInsert)['status']; extra?: Partial<typeof orders.$inferInsert> } = {},
) {
  const order = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: opts.status ?? 'new', extra: opts.extra });
  await ctx.db.transaction(async (tx) => {
    await recordOrderCreated(tx, { order, actor: { type: 'customer' } });
  });
  return order;
}

/** Akış B: awaiting_customer sipariş + doğrulama kodu. */
export async function createAwaitingOrder(ctx: TestContext, t: { tenantId: string; branchId: string }, code: string, opts: { expiresAt?: Date; extra?: Partial<typeof orders.$inferInsert> } = {}) {
  const order = await ctx.createOrder({
    tenantId: t.tenantId,
    branchId: t.branchId,
    status: 'awaiting_customer',
    extra: { channel: 'web', fulfillmentType: 'delivery', paymentMethod: 'cash_on_delivery', customerName: 'Ali Veli', ...opts.extra },
  });
  await ctx.db.insert(orderVerificationCodes).values({
    tenantId: t.tenantId,
    orderId: order.id,
    code,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 30 * 60_000),
  });
  return order;
}

export function transition(ctx: TestContext, input: Parameters<typeof transitionOrderTx>[1]) {
  return transitionOrderTx(ctx.db, input);
}

export async function getOrder(db: Database, id: string) {
  const [o] = await db.select().from(orders).where(eq(orders.id, id));
  return o!;
}

export async function getConversation(db: Database, id: string) {
  const [c] = await db.select().from(conversations).where(eq(conversations.id, id));
  return c!;
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
