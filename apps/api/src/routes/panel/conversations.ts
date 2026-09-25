// Panel sohbetler (14 §6.3 Sohbet; 04 P-08) — dilim 3. Roller: owner, manager, cashier.
// GET /conversations (liste: son mesaj, okunmamış, müşteri adı, maskeli telefon, mod), GET /conversations/:id,
// GET /conversations/:id/messages (cursor), POST /conversations/:id/messages {text} (24 sa penceresi dışında
// 409 window_closed; sent_by user; bot 30 dk susar), POST /:id/mode {bot|human}, POST /:id/read.
// KVKK ile silinmiş (customer_erasures) müşterinin sohbeti listede görünmez, detayı 404 (müşteri listesiyle aynı
// anlam: services/customers eraseCustomer). Aynı numara yeniden yazarsa yeni müşteri + yeni sohbet açılır.

import { maskPhone, OPEN_ORDER_STATUSES } from '@siparis/core';
import { conversations, customers, messages, orders, users, waAccounts, type Database } from '@siparis/db';
import { and, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit, auditActor } from '../../lib/audit';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { requireTenantRole, tenantAuth, type TenantAuth } from '../../plugins/auth';
import { humanModeActive, windowOpen, type ConversationRow } from '../../services/messaging/customers';
import { emitConversationUpdated, queueOutbound } from '../../services/messaging/outbound';
import { messageViewSchema, toMessageView } from '../../services/messaging/views';

const ROLES = ['owner', 'manager', 'cashier'] as const;
/** Operatör yazınca bot susma süresi (02 §6.10) */
const OPERATOR_MUTE_MS = 30 * 60_000;

const conversationDto = z.object({
  id: z.string(),
  branchId: z.string(),
  mode: z.enum(['bot', 'human']),
  humanUntil: z.string().nullable(),
  humanActive: z.boolean(),
  unreadCount: z.number().int(),
  lastMessageAt: z.string().nullable(),
  lastMessagePreview: z.string().nullable(),
  lastInboundAt: z.string().nullable(),
  windowOpen: z.boolean(),
  windowClosesAt: z.string().nullable(),
  optedOut: z.boolean(),
  customer: z.object({
    id: z.string(),
    name: z.string().nullable(),
    phoneMasked: z.string().nullable(),
    username: z.string().nullable(),
    isBlocked: z.boolean(),
  }),
  activeOrder: z.object({ id: z.string(), number: z.number().int(), status: z.string() }).nullable(),
});
type ConversationDto = z.infer<typeof conversationDto>;

const idParams = z.object({ id: z.uuid() });

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}
function decodeCursor(c: string | undefined): { at: Date; id: string } | null {
  if (!c) return null;
  try {
    const [iso, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
    const at = new Date(iso ?? '');
    if (!id || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

function scope(auth: TenantAuth): SQL {
  const conds = [
    eq(conversations.tenantId, auth.tenantId),
    sql`not exists (select 1 from customer_erasures e where e.customer_id = ${conversations.customerId})`,
  ];
  if (auth.branchId) conds.push(eq(conversations.branchId, auth.branchId));
  return and(...conds)!;
}

async function loadConversation(db: Database, auth: TenantAuth, id: string): Promise<ConversationRow> {
  const [c] = await db.select().from(conversations).where(and(scope(auth), eq(conversations.id, id)));
  if (!c) throw notFound('Sohbet bulunamadı.');
  return c;
}

async function activeOrders(db: Database, tenantId: string, customerIds: string[]) {
  const map = new Map<string, { id: string; number: number; status: string }>();
  if (!customerIds.length) return map;
  const rows = await db
    .select({ id: orders.id, number: orders.number, status: orders.status, customerId: orders.customerId, placedAt: orders.placedAt })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        inArray(orders.customerId, customerIds),
        inArray(orders.status, OPEN_ORDER_STATUSES.filter((s) => s !== 'awaiting_customer')),
        or(isNull(orders.testKind), ne(orders.testKind, 'canary')),
      ),
    )
    .orderBy(desc(orders.placedAt));
  for (const r of rows) if (r.customerId && !map.has(r.customerId)) map.set(r.customerId, { id: r.id, number: r.number, status: r.status });
  return map;
}

function toDto(
  c: ConversationRow,
  cust: typeof customers.$inferSelect,
  active: { id: string; number: number; status: string } | undefined,
  now: Date,
): ConversationDto {
  const open = windowOpen(c.lastInboundAt, now, 0);
  return {
    id: c.id,
    branchId: c.branchId,
    mode: c.mode,
    humanUntil: c.humanUntil?.toISOString() ?? null,
    humanActive: humanModeActive(c, now),
    unreadCount: c.unreadCount,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: c.lastMessagePreview,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    windowOpen: open,
    windowClosesAt: c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + 24 * 3600_000).toISOString() : null,
    optedOut: c.optedOut,
    customer: {
      id: cust.id,
      name: cust.name,
      phoneMasked: cust.phoneE164 ? maskPhone(cust.phoneE164) : null,
      username: cust.waUsername,
      isBlocked: cust.isBlocked,
    },
    activeOrder: active ?? null,
  };
}

async function conversationDtoById(db: Database, auth: TenantAuth, id: string): Promise<ConversationDto> {
  const c = await loadConversation(db, auth, id);
  const [cust] = await db.select().from(customers).where(eq(customers.id, c.customerId));
  const act = await activeOrders(db, auth.tenantId, [c.customerId]);
  return toDto(c, cust!, act.get(c.customerId), new Date());
}

const routes: FastifyPluginAsyncZod = async (app) => {
  const guard = requireTenantRole(ROLES);

  // GET /conversations?cursor=&limit=&q=&filter=unread|human
  app.get(
    '/conversations',
    {
      preHandler: guard,
      schema: {
        querystring: z.object({
          cursor: z.string().max(200).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
          q: z.string().trim().max(80).optional(),
          filter: z.enum(['all', 'unread', 'human']).optional(),
        }),
        response: { 200: z.object({ items: z.array(conversationDto), nextCursor: z.string().optional() }) },
      },
    },
    async (request) => {
      const auth = tenantAuth(request);
      const limit = request.query.limit ?? 30;
      const conds: SQL[] = [scope(auth)];
      const orderKey = sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`;
      const cursor = decodeCursor(request.query.cursor);
      if (cursor) conds.push(sql`(${orderKey}, ${conversations.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`);
      if (request.query.filter === 'unread') conds.push(sql`${conversations.unreadCount} > 0`);
      if (request.query.filter === 'human') conds.push(eq(conversations.mode, 'human'));
      const q = request.query.q;
      if (q) {
        const digits = q.replace(/\D/g, '');
        const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
        const qc: SQL[] = [ilike(customers.name, like), ilike(conversations.lastMessagePreview, like)];
        if (digits.length >= 3) qc.push(sql`${customers.phoneE164} like ${`%${digits}%`}`);
        conds.push(or(...qc)!);
      }
      const rows = await app.db
        .select({ c: conversations, cust: customers, k: sql<Date>`${orderKey}` })
        .from(conversations)
        .innerJoin(customers, eq(customers.id, conversations.customerId))
        .where(and(...conds))
        .orderBy(desc(orderKey), desc(conversations.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const act = await activeOrders(
        app.db,
        auth.tenantId,
        page.map((r) => r.c.customerId),
      );
      const now = new Date();
      const last = page[page.length - 1];
      return {
        items: page.map((r) => toDto(r.c, r.cust, act.get(r.c.customerId), now)),
        ...(rows.length > limit && last ? { nextCursor: encodeCursor(new Date(last.k), last.c.id) } : {}),
      };
    },
  );

  // GET /conversations/:id
  app.get(
    '/conversations/:id',
    { preHandler: guard, schema: { params: idParams, response: { 200: conversationDto } } },
    async (request) => conversationDtoById(app.db, tenantAuth(request), request.params.id),
  );

  // GET /conversations/:id/messages?cursor=&limit= (yeniden eskiye)
  app.get(
    '/conversations/:id/messages',
    {
      preHandler: guard,
      schema: {
        params: idParams,
        querystring: z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }),
        response: { 200: z.object({ items: z.array(messageViewSchema), nextCursor: z.string().optional() }) },
      },
    },
    async (request) => {
      const auth = tenantAuth(request);
      const conv = await loadConversation(app.db, auth, request.params.id);
      const limit = request.query.limit ?? 50;
      const conds: SQL[] = [eq(messages.tenantId, auth.tenantId), eq(messages.conversationId, conv.id)];
      const cursor = decodeCursor(request.query.cursor);
      if (cursor) conds.push(sql`(${messages.createdAt}, ${messages.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`);
      const rows = await app.db
        .select({ m: messages, userName: users.name, orderNumber: orders.number })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.sentByUserId))
        .leftJoin(orders, and(eq(orders.id, messages.orderId), eq(orders.tenantId, auth.tenantId)))
        .where(and(...conds))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => toMessageView(r.m, { sentByName: r.userName, orderNumber: r.orderNumber })),
        ...(rows.length > limit && last ? { nextCursor: encodeCursor(last.m.createdAt, last.m.id) } : {}),
      };
    },
  );

  // POST /conversations/:id/messages {text}
  app.post(
    '/conversations/:id/messages',
    {
      preHandler: guard,
      schema: {
        params: idParams,
        body: z.object({ text: z.string().max(4096) }),
        response: { 201: z.object({ message: messageViewSchema, conversation: conversationDto }) },
      },
    },
    async (request, reply) => {
      const auth = tenantAuth(request);
      const text = request.body.text.trim();
      if (!text) throw badRequest('Mesaj boş olamaz.', { issues: [{ path: '/text', message: 'Mesaj boş olamaz.' }] });
      const now = new Date();
      const messageId = await app.db.transaction(async (tx) => {
        const [conv] = await tx
          .select()
          .from(conversations)
          .where(and(scope(auth), eq(conversations.id, request.params.id)))
          .for('update');
        if (!conv) throw notFound('Sohbet bulunamadı.');
        const [acc] = await tx.select({ status: waAccounts.status }).from(waAccounts).where(eq(waAccounts.id, conv.waAccountId));
        if (!acc || acc.status === 'disconnected') {
          throw conflict(
            'wa_not_connected',
            'WhatsApp bağlantısı kesik olduğu için mesaj gönderilemez. İşletme sahibi Ayarlar > WhatsApp bölümünden yeniden bağlayabilir.',
          );
        }
        if (!windowOpen(conv.lastInboundAt, now, 0)) {
          throw conflict(
            'window_closed',
            'Müşterinin son mesajının üzerinden 24 saat geçti. WhatsApp kuralları gereği serbest mesaj gönderilemez; müşteri yazınca yanıtlayabilirsiniz ya da arayın.',
          );
        }
        const q = await queueOutbound(tx, {
          tenantId: auth.tenantId,
          branchId: conv.branchId,
          conversationId: conv.id,
          spec: { type: 'text', text },
          code: null,
          sentBy: 'user',
          sentByUserId: auth.userId,
        });
        // Operatör yazdı → bot 30 dk susar (süresiz insan modu korunur); okunmamış sıfırlanır
        const keepIndefinite = conv.mode === 'human' && conv.humanUntil == null;
        const until = keepIndefinite ? null : new Date(Math.max(now.getTime() + OPERATOR_MUTE_MS, conv.humanUntil?.getTime() ?? 0));
        const [updated] = await tx
          .update(conversations)
          .set({ mode: 'human', humanUntil: until, unreadCount: 0, updatedAt: now })
          .where(eq(conversations.id, conv.id))
          .returning();
        await emitConversationUpdated(tx, updated!);
        return q.messageId;
      });
      const [row] = await app.db
        .select({ m: messages, userName: users.name })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.sentByUserId))
        .where(eq(messages.id, messageId));
      reply.code(201);
      return {
        message: toMessageView(row!.m, { sentByName: row!.userName }),
        conversation: await conversationDtoById(app.db, auth, request.params.id),
      };
    },
  );

  // POST /conversations/:id/mode {mode}
  app.post(
    '/conversations/:id/mode',
    {
      preHandler: guard,
      schema: { params: idParams, body: z.object({ mode: z.enum(['bot', 'human']) }), response: { 200: conversationDto } },
    },
    async (request) => {
      const auth = tenantAuth(request);
      await app.db.transaction(async (tx) => {
        const conv = await loadConversation(tx, auth, request.params.id);
        const [updated] = await tx
          .update(conversations)
          // human: süresiz (panelden "Bota bırak" denene kadar); bot: hemen
          .set({ mode: request.body.mode, humanUntil: null, updatedAt: new Date() })
          .where(eq(conversations.id, conv.id))
          .returning();
        await emitConversationUpdated(tx, updated!);
        await audit(tx, {
          ...auditActor(request),
          action: request.body.mode === 'human' ? 'conversation.takeover' : 'conversation.release',
          entityType: 'conversation',
          entityId: conv.id,
        });
      });
      return conversationDtoById(app.db, auth, request.params.id);
    },
  );

  // POST /conversations/:id/read
  app.post(
    '/conversations/:id/read',
    { preHandler: guard, schema: { params: idParams, response: { 200: conversationDto } } },
    async (request) => {
      const auth = tenantAuth(request);
      await app.db.transaction(async (tx) => {
        const conv = await loadConversation(tx, auth, request.params.id);
        if (conv.unreadCount === 0) return;
        const [updated] = await tx.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, conv.id)).returning();
        await emitConversationUpdated(tx, updated!);
      });
      return conversationDtoById(app.db, auth, request.params.id);
    },
  );
};

export default routes;
