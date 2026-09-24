// Geliştirici araçları (14 §6.5, yalnız DEV_TOOLS=1; app.ts yalnız bu durumda kaydeder) — dilim 3.
// Simülatör: Cloud API webhook yükü üretip webhook ile AYNI işlem hattına sokar (ham olay + wa.process_inbound).
// ?sync=1 → olay hemen işlenir ve vadesi gelen giden mesajlar (mock) gönderilir; aksi halde worker işler.

import { normalizePhone } from '@siparis/core';
import { branches, conversations, customers, messages, notifications, orders, smsMessages, tenants, users, waAccounts } from '@siparis/db';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors';
import { processDueJobs } from '../../lib/jobs';
import { buildEchoPayload, buildInboundPayload, buildStatusPayload, type DevInboundMessage } from '../../services/messaging/dev-payload';
import { ingestWebhookPayload, processWebhookEvent } from '../../services/messaging/ingest';
import { toMessageView } from '../../services/messaging/views';
import type { WaAccountRow } from '../../wa/registry';

const syncQuery = z.object({ sync: z.enum(['0', '1']).optional() });

const senderSchema = z
  .object({
    phone: z.string().max(32).optional().nullable(),
    name: z.string().max(80).optional().nullable(),
    bsuid: z.string().max(140).optional().nullable(),
    username: z.string().max(80).optional().nullable(),
  })
  .refine((s) => !!(s.phone || s.bsuid), { message: 'Telefon ya da BSUID gerekli.' });

const inboundMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1).max(4096) }),
  z.object({ type: z.literal('button_reply'), id: z.string().min(1).max(256), title: z.string().max(40).optional() }),
  z.object({ type: z.literal('list_reply'), id: z.string().min(1).max(256), title: z.string().max(40).optional() }),
  z.object({ type: z.literal('location'), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), name: z.string().max(120).optional(), address: z.string().max(200).optional() }),
  z.object({ type: z.enum(['audio', 'image', 'video', 'document', 'sticker']), caption: z.string().max(500).optional() }),
  z.object({ type: z.literal('unsupported') }),
  z.object({ type: z.literal('request_welcome') }),
]);

function normalizeSender<T extends { phone?: string | null }>(s: T): T {
  if (!s.phone) return s;
  const p = normalizePhone(s.phone) ?? (/^\+?\d{8,15}$/.test(s.phone) ? `+${s.phone.replace(/\D/g, '')}` : null);
  if (!p) throw badRequest('Telefon numarası geçersiz.', undefined, 'invalid_phone');
  return { ...s, phone: p };
}

async function loadAccount(app: FastifyInstance, id: string): Promise<WaAccountRow> {
  const [acc] = await app.db.select().from(waAccounts).where(eq(waAccounts.id, id));
  if (!acc) throw notFound('WhatsApp hesabı bulunamadı.');
  return acc;
}

/** Olayı hemen işler ve vadesi gelen giden mesajları gönderir (dev). */
async function runSync(app: FastifyInstance, webhookEventId: string) {
  const deps = { db: app.db, config: app.config, log: app.log };
  const summary = await processWebhookEvent(deps, webhookEventId);
  for (let i = 0; i < 5; i++) {
    const n = await processDueJobs({ ...deps, queues: ['wa-inbound', 'wa-outbound', 'notify'], limit: 50 });
    if (n === 0) break;
  }
  return summary;
}

const routes: FastifyPluginAsyncZod = async (app) => {
  // GET /dev/wa/accounts
  app.get('/wa/accounts', async () => {
    const rows = await app.db
      .select({ acc: waAccounts, tenantName: tenants.name, slug: tenants.slug, branchName: branches.name })
      .from(waAccounts)
      .innerJoin(tenants, eq(tenants.id, waAccounts.tenantId))
      .innerJoin(branches, eq(branches.id, waAccounts.branchId))
      .orderBy(asc(tenants.name));
    return {
      items: rows.map((r) => ({
        id: r.acc.id,
        tenantId: r.acc.tenantId,
        tenantName: r.tenantName,
        slug: r.slug,
        branchId: r.acc.branchId,
        branchName: r.branchName,
        provider: r.acc.provider,
        displayPhone: r.acc.displayPhone,
        phoneNumberId: r.acc.phoneNumberId,
        status: r.acc.status,
        webhookToken: r.acc.webhookToken,
        lastWebhookAt: r.acc.lastWebhookAt?.toISOString() ?? null,
      })),
    };
  });

  // POST /dev/wa/inbound — müşteri mesajı simülasyonu
  app.post(
    '/wa/inbound',
    {
      schema: {
        querystring: syncQuery,
        body: z.object({ waAccountId: z.uuid(), from: senderSchema, message: inboundMessageSchema }),
      },
    },
    async (request) => {
      const acc = await loadAccount(app, request.body.waAccountId);
      const from = normalizeSender(request.body.from);
      const { payload, wamid } = buildInboundPayload(acc, from, request.body.message as DevInboundMessage);
      const { webhookEventId } = await ingestWebhookPayload(app.db, acc, payload);
      const summary = request.query.sync === '1' ? await runSync(app, webhookEventId) : null;
      return { ok: true, webhookEventId, wamid, summary };
    },
  );

  // POST /dev/wa/echo — işletme telefonundan (Coexistence) yazılmış mesaj
  app.post(
    '/wa/echo',
    {
      schema: {
        querystring: syncQuery,
        body: z.object({ waAccountId: z.uuid(), to: senderSchema, text: z.string().min(1).max(4096) }),
      },
    },
    async (request) => {
      const acc = await loadAccount(app, request.body.waAccountId);
      const to = normalizeSender(request.body.to);
      const { payload, wamid } = buildEchoPayload(acc, to, request.body.text);
      const { webhookEventId } = await ingestWebhookPayload(app.db, acc, payload);
      const summary = request.query.sync === '1' ? await runSync(app, webhookEventId) : null;
      return { ok: true, webhookEventId, wamid, summary };
    },
  );

  // POST /dev/wa/status — giden mesaj durumu (delivered/read/failed) simülasyonu
  app.post(
    '/wa/status',
    {
      schema: {
        querystring: syncQuery,
        body: z.object({ messageId: z.uuid(), status: z.enum(['sent', 'delivered', 'read', 'failed']), errorCode: z.number().int().optional() }),
      },
    },
    async (request) => {
      const [msg] = await app.db.select().from(messages).where(eq(messages.id, request.body.messageId));
      if (!msg?.wamid) throw notFound('Gönderilmiş mesaj bulunamadı.');
      const [conv] = await app.db.select().from(conversations).where(eq(conversations.id, msg.conversationId));
      const acc = await loadAccount(app, conv!.waAccountId);
      const payload = buildStatusPayload(acc, { wamid: msg.wamid, status: request.body.status, errorCode: request.body.errorCode });
      const { webhookEventId } = await ingestWebhookPayload(app.db, acc, payload);
      const summary = request.query.sync === '1' ? await runSync(app, webhookEventId) : null;
      return { ok: true, webhookEventId, summary };
    },
  );

  // GET /dev/wa/thread?waAccountId=&phone=&bsuid= — gelen + giden mesajlar (butonlarıyla)
  app.get(
    '/wa/thread',
    {
      schema: {
        querystring: z.object({
          waAccountId: z.uuid(),
          phone: z.string().max(32).optional(),
          bsuid: z.string().max(140).optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
      },
    },
    async (request) => {
      const acc = await loadAccount(app, request.query.waAccountId);
      const phone = request.query.phone ? normalizeSender({ phone: request.query.phone }).phone : null;
      const bsuid = request.query.bsuid || null;
      if (!phone && !bsuid) throw badRequest('Telefon ya da BSUID gerekli.', undefined, 'recipient_required');
      const conds = [];
      if (bsuid) conds.push(eq(customers.waBsuid, bsuid));
      if (phone) conds.push(eq(customers.phoneE164, phone));
      const custs = await app.db
        .select()
        .from(customers)
        .where(and(eq(customers.tenantId, acc.tenantId), or(...conds)));
      const custIds = custs.map((c) => c.id);
      if (!custIds.length) return { conversation: null, customer: null, messages: [] };
      const [conv] = await app.db
        .select()
        .from(conversations)
        .where(and(eq(conversations.waAccountId, acc.id), inArray(conversations.customerId, custIds)))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(1);
      if (!conv) return { conversation: null, customer: null, messages: [] };
      const customer = custs.find((c) => c.id === conv.customerId)!;
      const rows = await app.db
        .select({ m: messages, userName: users.name, orderNumber: orders.number })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.sentByUserId))
        .leftJoin(orders, eq(orders.id, messages.orderId))
        .where(eq(messages.conversationId, conv.id))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(request.query.limit ?? 200);
      return {
        conversation: {
          id: conv.id,
          mode: conv.mode,
          humanUntil: conv.humanUntil?.toISOString() ?? null,
          optedOut: conv.optedOut,
          lastInboundAt: conv.lastInboundAt?.toISOString() ?? null,
        },
        customer: { id: customer.id, name: customer.name, phone: customer.phoneE164, bsuid: customer.waBsuid },
        messages: rows.reverse().map((r) => toMessageView(r.m, { sentByName: r.userName, orderNumber: r.orderNumber })),
      };
    },
  );

  // GET /dev/sms — mock SMS kutusu
  app.get(
    '/sms',
    { schema: { querystring: z.object({ to: z.string().max(32).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }) } },
    async (request) => {
      const to = request.query.to ? normalizePhone(request.query.to) : null;
      const rows = await app.db
        .select({ s: smsMessages, tenantName: tenants.name })
        .from(smsMessages)
        .leftJoin(tenants, eq(tenants.id, smsMessages.tenantId))
        .where(to ? eq(smsMessages.toPhone, to) : undefined)
        .orderBy(desc(smsMessages.createdAt))
        .limit(request.query.limit ?? 50);
      return {
        items: rows.map(({ s, tenantName }) => ({
          id: s.id,
          tenantId: s.tenantId,
          tenantName,
          orderId: s.orderId,
          to: s.toPhone,
          body: s.body,
          purpose: s.purpose,
          provider: s.provider,
          status: s.status,
          countsTowardQuota: s.countsTowardQuota,
          error: s.error,
          createdAt: s.createdAt.toISOString(),
        })),
      };
    },
  );

  // GET /dev/platform-alerts — platform WhatsApp uyarıları (mock)
  app.get('/platform-alerts', { schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }) } }, async (request) => {
    const rows = await app.db
      .select({ n: notifications, tenantName: tenants.name })
      .from(notifications)
      .leftJoin(tenants, eq(tenants.id, notifications.tenantId))
      .where(eq(notifications.channel, 'platform_wa'))
      .orderBy(desc(notifications.createdAt))
      .limit(request.query.limit ?? 50);
    return {
      items: rows.map(({ n, tenantName }) => ({
        id: n.id,
        tenantId: n.tenantId,
        tenantName,
        orderId: n.orderId,
        kind: n.kind,
        status: n.status,
        text: typeof n.payload.text === 'string' ? n.payload.text : null,
        template: typeof n.payload.template === 'string' ? n.payload.template : null,
        params: Array.isArray(n.payload.params) ? (n.payload.params as string[]) : [],
        to: typeof n.payload.to === 'string' ? n.payload.to : null,
        error: n.error,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  });

  // POST /dev/jobs/flush — worker yokken vadesi gelen WhatsApp/bildirim işlerini çalıştır
  app.post('/jobs/flush', async () => {
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const n = await processDueJobs({ db: app.db, config: app.config, log: app.log, queues: ['wa-inbound', 'wa-outbound', 'notify'], limit: 50 });
      total += n;
      if (n === 0) break;
    }
    return { ok: true, processed: total };
  });
};

export default routes;
