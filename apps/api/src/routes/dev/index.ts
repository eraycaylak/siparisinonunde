// Geliştirici araçları (14 §6.5, yalnız DEV_TOOLS=1; app.ts yalnız bu durumda kaydeder) — dilim 3.
// Simülatör: Cloud API webhook yükü üretip webhook ile AYNI işlem hattına sokar (ham olay + wa.process_inbound).
// ?sync=1 → olay hemen işlenir ve vadesi gelen giden mesajlar (mock) gönderilir; aksi halde worker işler.
// Ortak numara (00 §12a madde 8): `shared: true` ya da ortak numara işletmesinin hesap kimliği → mesaj ortak numaraya
// gider (yönlendirici dükkanı seçer). Hesap kimliğiyle yazmak müşterinin o dükkanın QR'ından geldiği anlamına gelir
// (etkin dükkanı yoksa yönlendirme o dükkana hazırlanır); `shared: true` gerçek kodsuz deneyimdir. Sohbet görünümü
// müşterinin ortak numaradaki TEK sohbetidir (tüm dükkanlar + platform seçici mesajları, zaman sırasıyla; her mesajda
// tenantName, platform mesajında platform=true).

import { SHARED_WA_DISPLAY_NAME, formatPhone, normalizePhone } from '@siparis/core';
import {
  branches,
  conversations,
  customers,
  messages,
  notifications,
  orders,
  sharedWaMessages,
  smsMessages,
  tenants,
  users,
  waAccounts,
} from '@siparis/db';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { processDueJobs } from '../../lib/jobs';
import { buildEchoPayload, buildInboundPayload, buildStatusPayload, type DevInboundMessage } from '../../services/messaging/dev-payload';
import { ingestWebhookPayload, processWebhookEvent } from '../../services/messaging/ingest';
import { selectableSharedShops, sharedLinkInfo } from '../../services/messaging/shared';
import { findSharedRoute, ingestSharedWebhookPayload, rememberSharedTenant } from '../../services/messaging/shared-router';
import { toMessageView, toPlatformMessageView, type MessageView } from '../../services/messaging/views';
import { platformDisplayPhone } from '../../config';
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

/** Ortak numaranın simülatör "hesabı" (webhook yükündeki metadata). */
function sharedDevAccount(app: FastifyInstance) {
  return {
    phoneNumberId: app.config.PLATFORM_WA_PHONE_NUMBER_ID ?? 'platform-shared',
    displayPhone: platformDisplayPhone(app.config),
    wabaId: 'platform-waba',
  };
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

/** `wamid`: simülatör buton/liste yanıtında `contextWamid` olarak gönderir (WhatsApp'ta yanıt, yanıtlanan mesajı taşır). */
type SharedThreadMessage = MessageView & { tenantId: string | null; tenantName: string | null; tenantSlug: string | null; platform: boolean; wamid: string | null };

/**
 * Müşterinin ortak numaradaki sohbeti (müşteri tarafı görünüm): ortak numara işletmelerindeki konuşmalar + platform
 * seçici mesajları, zaman sırasıyla. Yalnız geliştirme simülatörü içindir (üretimde /dev kapalı).
 */
async function sharedThread(app: FastifyInstance, who: { phone: string | null; bsuid: string | null }, limit: number) {
  const conds = [];
  if (who.bsuid) conds.push(eq(customers.waBsuid, who.bsuid));
  if (who.phone) conds.push(eq(customers.phoneE164, who.phone));
  const convRows = await app.db
    .select({ conv: conversations, customer: customers, tenantName: tenants.name, slug: tenants.slug })
    .from(conversations)
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .innerJoin(waAccounts, eq(waAccounts.id, conversations.waAccountId))
    .innerJoin(tenants, eq(tenants.id, conversations.tenantId))
    .where(and(eq(waAccounts.provider, 'shared'), or(...conds)));
  const byConv = new Map(convRows.map((r) => [r.conv.id, r]));
  const tenantRows = convRows.length
    ? await app.db
        .select({ m: messages, userName: users.name, orderNumber: orders.number })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.sentByUserId))
        .leftJoin(orders, eq(orders.id, messages.orderId))
        .where(inArray(messages.conversationId, [...byConv.keys()]))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit)
    : [];
  const route = await findSharedRoute(app.db, who);
  const platformRows = route
    ? await app.db.select().from(sharedWaMessages).where(eq(sharedWaMessages.routeId, route.id)).orderBy(desc(sharedWaMessages.createdAt)).limit(limit)
    : [];
  const items: SharedThreadMessage[] = [
    ...tenantRows.map((r) => {
      const c = byConv.get(r.m.conversationId)!;
      return {
        ...toMessageView(r.m, { sentByName: r.userName, orderNumber: r.orderNumber }),
        tenantId: c.conv.tenantId,
        tenantName: c.tenantName,
        tenantSlug: c.slug,
        platform: false,
        wamid: r.m.wamid,
      };
    }),
    ...platformRows.map((p) => ({
      ...toPlatformMessageView(p),
      tenantId: null,
      tenantName: null,
      tenantSlug: null,
      platform: true,
      wamid: p.wamid,
    })),
  ];
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const current = route?.currentTenantId ? convRows.find((r) => r.conv.tenantId === route.currentTenantId) : undefined;
  const latest = current ?? [...convRows].sort((a, b) => (b.conv.lastMessageAt?.getTime() ?? 0) - (a.conv.lastMessageAt?.getTime() ?? 0))[0];
  const names = new Map(convRows.map((r) => [r.conv.tenantId, r.tenantName]));
  return {
    shared: true,
    conversation: latest
      ? {
          id: latest.conv.id,
          mode: latest.conv.mode,
          humanUntil: latest.conv.humanUntil?.toISOString() ?? null,
          optedOut: latest.conv.optedOut,
          lastInboundAt: latest.conv.lastInboundAt?.toISOString() ?? null,
          tenantId: latest.conv.tenantId,
          tenantName: latest.tenantName,
        }
      : null,
    customer: latest ? { id: latest.customer.id, name: latest.customer.name, phone: latest.customer.phoneE164, bsuid: latest.customer.waBsuid } : null,
    route: route
      ? {
          currentTenantId: route.currentTenantId,
          currentTenantName: route.currentTenantId ? (names.get(route.currentTenantId) ?? null) : null,
          recentTenantIds: route.recentTenantIds,
          lastRoutedAt: route.lastRoutedAt?.toISOString() ?? null,
        }
      : null,
    messages: items.slice(-limit),
  };
}

const routes: FastifyPluginAsyncZod = async (app) => {
  // GET /dev/wa/accounts
  app.get('/wa/accounts', async () => {
    const selectable = new Set((await selectableSharedShops(app.db)).map((s) => s.tenantId));
    const sharedPhone = platformDisplayPhone(app.config);
    const rows = await app.db
      .select({ acc: waAccounts, tenantName: tenants.name, slug: tenants.slug, waCode: tenants.waCode, branchName: branches.name })
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
        /** Ortak numarada mesajlar platform numarasına gider (inbound/thread bu hesapla da ortak numarayı kullanır) */
        mode: r.acc.provider === 'shared' ? ('shared' as const) : ('own' as const),
        waCode: r.waCode,
      })),
      // Ortak numara: simülatörde tek "numara"; dükkanlar QR bağlantısıyla (#KOD) seçilir
      sharedNumber: {
        displayName: SHARED_WA_DISPLAY_NAME,
        displayPhone: sharedPhone,
        displayPhoneFormatted: sharedPhone ? formatPhone(sharedPhone) : null,
        shops: rows
          .filter((r) => r.acc.provider === 'shared')
          .map((r) => {
            const link = sharedLinkInfo(app.config, { name: r.tenantName, waCode: r.waCode });
            return {
              tenantId: r.acc.tenantId,
              tenantName: r.tenantName,
              slug: r.slug,
              waAccountId: r.acc.id,
              code: r.waCode,
              prefillText: link.prefillText,
              waLink: link.waLink,
              selectable: selectable.has(r.acc.tenantId),
            };
          }),
      },
    };
  });

  // POST /dev/wa/inbound — müşteri mesajı simülasyonu
  app.post(
    '/wa/inbound',
    {
      schema: {
        querystring: syncQuery,
        body: z
          .object({
            waAccountId: z.uuid().optional(),
            /** Ortak numaraya yaz (yönlendirici dükkanı seçer) */
            shared: z.boolean().optional(),
            from: senderSchema,
            message: inboundMessageSchema,
            /** Yanıtlanan mesajın wamid'i (WhatsApp'ta "yanıtla") */
            contextWamid: z.string().max(200).optional(),
          })
          .refine((b) => !!b.waAccountId || b.shared === true, { message: 'waAccountId ya da shared: true gerekli.' }),
      },
    },
    async (request) => {
      const from = normalizeSender(request.body.from);
      const acc = request.body.waAccountId ? await loadAccount(app, request.body.waAccountId) : null;
      const toShared = request.body.shared === true || acc?.provider === 'shared';
      const built = buildInboundPayload(toShared ? sharedDevAccount(app) : acc!, from, request.body.message as DevInboundMessage, {
        contextWamid: request.body.contextWamid,
      });
      const { payload, wamid } = built;
      // Dükkan hesabıyla yazmak = müşteri o dükkanın QR'ından geldi: etkin dükkanı yoksa yönlendirme bu dükkana hazırlanır
      // (`shared: true` ise hazırlık yok — gerçek ortak numara deneyimi: kodsuz ilk mesaja dükkan seçici gider)
      if (acc?.provider === 'shared' && request.body.shared !== true) {
        await rememberSharedTenant(app.db, { ...(from.phone ? { phone: from.phone } : {}), ...(from.bsuid ? { bsuid: from.bsuid } : {}) }, acc.tenantId);
      }
      const { webhookEventId } = toShared ? await ingestSharedWebhookPayload(app.db, payload) : await ingestWebhookPayload(app.db, acc!, payload);
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
      // Ortak numara yalnız API ile kullanılır: işletme telefonundan (Coexistence) yazılamaz
      if (acc.provider === 'shared') throw conflict('wa_shared_mode', 'Ortak numarada işletme telefonundan yazma (echo) yoktur.');
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
      const [platformMsg] = msg ? [] : await app.db.select().from(sharedWaMessages).where(eq(sharedWaMessages.id, request.body.messageId));
      const wamid = msg?.wamid ?? platformMsg?.wamid;
      if (!wamid) throw notFound('Gönderilmiş mesaj bulunamadı.');
      const [conv] = msg ? await app.db.select().from(conversations).where(eq(conversations.id, msg.conversationId)) : [];
      const acc = conv ? await loadAccount(app, conv.waAccountId) : null;
      const shared = !acc || acc.provider === 'shared';
      const payload = buildStatusPayload(shared ? sharedDevAccount(app) : acc!, { wamid, status: request.body.status, errorCode: request.body.errorCode });
      const { webhookEventId } = shared ? await ingestSharedWebhookPayload(app.db, payload) : await ingestWebhookPayload(app.db, acc!, payload);
      const summary = request.query.sync === '1' ? await runSync(app, webhookEventId) : null;
      return { ok: true, webhookEventId, summary };
    },
  );

  // GET /dev/wa/thread?waAccountId=&phone=&bsuid= — gelen + giden mesajlar (butonlarıyla)
  app.get(
    '/wa/thread',
    {
      schema: {
        querystring: z
          .object({
            waAccountId: z.uuid().optional(),
            shared: z.enum(['0', '1']).optional(),
            phone: z.string().max(32).optional(),
            bsuid: z.string().max(140).optional(),
            limit: z.coerce.number().int().min(1).max(500).optional(),
          })
          .refine((q) => !!q.waAccountId || q.shared === '1', { message: 'waAccountId ya da shared=1 gerekli.' }),
      },
    },
    async (request) => {
      const phone = request.query.phone ? normalizeSender({ phone: request.query.phone }).phone : null;
      const bsuid = request.query.bsuid || null;
      if (!phone && !bsuid) throw badRequest('Telefon ya da BSUID gerekli.', undefined, 'recipient_required');
      const acc0 = request.query.waAccountId ? await loadAccount(app, request.query.waAccountId) : null;
      if (request.query.shared === '1' || acc0?.provider === 'shared') {
        return sharedThread(app, { phone: phone ?? null, bsuid }, request.query.limit ?? 200);
      }
      const acc = acc0!;
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
