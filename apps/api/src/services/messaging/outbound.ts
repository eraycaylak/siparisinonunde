// Giden mesaj outbox'ı: messages satırı (status 'queued') + `wa.send` işi, aynı transaction'da (02 §7.5).
// Alıcı başı ~6 sn aralık: conversation_bot_state.next_send_at ile iş zamanı ileri kaydırılır (02 §7.6).
// SSE: conversation.message / conversation.updated (14 §7.1).
// Ortak numara (00 §12a madde 8): konuşmanın hesabı 'shared' ise her serbest mesaj dükkan adını taşır — metinde kalın
// ilk satır, etkileşimli mesajda başlık (header). Şablonların hepsi dükkan adını değişken olarak içerir (CUSTOMER_TEMPLATES).

import { brandedText, sharedBrandLine, type MessageKind, type MessageSentBy, type WaDraft } from '@siparis/core';
import { conversationBotState, conversations, messages, tenants, waAccounts, type Database } from '@siparis/db';
import { eq, sql } from 'drizzle-orm';
import { appendBranchEvent } from '../../lib/events';
import { enqueueJob } from '../../lib/jobs';
import type { WaInteractiveMessage, WaTemplateButton } from '../../wa/types';
import { PAIR_INTERVAL_MS } from '../../wa/throttle';
import { renderTemplateBody } from './template-bodies';

export type OutboundSpec =
  | { type: 'text'; text: string }
  | { type: 'interactive'; interactive: WaInteractiveMessage }
  | { type: 'template'; name: string; params: string[]; buttons?: WaTemplateButton[] };

export interface TemplateSpec {
  name: string;
  params: string[];
  buttons?: WaTemplateButton[];
}

/** messages.payload (giden). */
export interface OutboundPayload {
  /** M-kodu (M05, M06a…) */
  code?: string | null;
  spec: OutboundSpec;
  /** 131047 (pencere kapalı) gelirse aynı içerik için şablon */
  templateFallback?: TemplateSpec | null;
  /** Hesap duraklatılmışsa (190/131042) kritik durum için SMS */
  smsFallback?: { to: string; body: string } | null;
  /** Bütçeye sayılan durum mesajı */
  statusMessage?: boolean;
  /** Sipariş olayı (accepted, delivered…) */
  orderEvent?: string | null;
  /** Ortak numarada mesajın taşıdığı dükkan adı (00 §12a madde 8); kendi numarada yok */
  brand?: string | null;
  /** Gönderimden sonra: sağlayıcıya giden gövde */
  request?: Record<string, unknown>;
  error?: { code: string; message: string } | null;
}

export function draftToSpec(d: WaDraft): OutboundSpec {
  if (d.buttons?.length) {
    return { type: 'interactive', interactive: { kind: 'buttons', body: d.body, footer: d.footer, buttons: d.buttons } };
  }
  if (d.cta) {
    return { type: 'interactive', interactive: { kind: 'cta_url', body: d.body, footer: d.footer, url: { label: d.cta.label, href: d.cta.url } } };
  }
  return { type: 'text', text: d.body };
}

export function specKind(spec: OutboundSpec): MessageKind {
  return spec.type === 'template' ? 'template' : spec.type === 'interactive' ? 'interactive' : 'text';
}

/** Ortak numara: serbest mesaja dükkan adı (metin → kalın ilk satır; etkileşimli → başlık). Şablon değişmez. */
export function brandSpec(spec: OutboundSpec, shopName: string): OutboundSpec {
  switch (spec.type) {
    case 'text':
      return { type: 'text', text: brandedText(shopName, spec.text) };
    case 'interactive':
      // Konum isteği mesajı başlık desteklemez: ad gövdenin ilk satırına yazılır
      if (spec.interactive.kind === 'location_request') {
        return { type: 'interactive', interactive: { ...spec.interactive, body: brandedText(shopName, spec.interactive.body) } };
      }
      return { type: 'interactive', interactive: { ...spec.interactive, header: spec.interactive.header ?? shopName } };
    case 'template':
      return spec;
  }
}

export function specBody(spec: OutboundSpec): string {
  switch (spec.type) {
    case 'text':
      return spec.text;
    case 'interactive':
      // Başlık (ortak numarada dükkan adı) görünümde kalın ilk satırdır
      return spec.interactive.header ? `${sharedBrandLine(spec.interactive.header)}\n${spec.interactive.body}` : spec.interactive.body;
    case 'template':
      return renderTemplateBody(spec.name, spec.params);
  }
}

/** Liste/önizleme metni (≤ 120 karakter, satır sonsuz). */
export function previewText(text: string | null | undefined): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 120 ? `${t.slice(0, 119)}…` : t;
}

export interface QueueOutboundInput {
  tenantId: string;
  branchId: string;
  conversationId: string;
  spec: OutboundSpec;
  code?: string | null;
  sentBy: Extract<MessageSentBy, 'bot' | 'user'>;
  sentByUserId?: string | null;
  orderId?: string | null;
  templateFallback?: TemplateSpec | null;
  smsFallback?: { to: string; body: string } | null;
  statusMessage?: boolean;
  orderEvent?: string | null;
  now?: Date;
}

export interface QueuedMessage {
  messageId: string;
  runAt: Date;
}

/** Konuşmanın bir sonraki gönderim zamanını ayırır (DB saatine göre; ilk mesaj hemen). */
async function reserveSendSlot(tx: Database, tenantId: string, conversationId: string): Promise<Date> {
  const rows = (await tx.execute<{ run_at: Date | string }>(sql`
    insert into conversation_bot_state (conversation_id, tenant_id, next_send_at)
    values (${conversationId}::uuid, ${tenantId}::uuid, now() + (${PAIR_INTERVAL_MS} * interval '1 millisecond'))
    on conflict (conversation_id) do update
       set next_send_at = greatest(coalesce(conversation_bot_state.next_send_at, now()), now())
                          + (${PAIR_INTERVAL_MS} * interval '1 millisecond'),
           updated_at = now()
    returning next_send_at - (${PAIR_INTERVAL_MS} * interval '1 millisecond') as run_at`)) as unknown as { run_at: Date | string }[];
  const v = rows[0]?.run_at;
  return v ? new Date(v) : new Date();
}

/** Konuşma ortak numaradaysa dükkan adı (marka), değilse null. */
async function sharedBrandOf(tx: Database, conversationId: string): Promise<string | null> {
  const [row] = await tx
    .select({ provider: waAccounts.provider, name: tenants.name })
    .from(conversations)
    .innerJoin(waAccounts, eq(waAccounts.id, conversations.waAccountId))
    .innerJoin(tenants, eq(tenants.id, conversations.tenantId))
    .where(eq(conversations.id, conversationId));
  return row?.provider === 'shared' ? row.name : null;
}

/** Giden mesajı kuyruğa alır (outbox). Çağıranın transaction'ında. */
export async function queueOutbound(tx: Database, input: QueueOutboundInput): Promise<QueuedMessage> {
  const brand = await sharedBrandOf(tx, input.conversationId);
  const spec = brand ? brandSpec(input.spec, brand) : input.spec;
  const body = specBody(spec);
  const payload: OutboundPayload = {
    code: input.code ?? null,
    spec,
    ...(brand ? { brand } : {}),
    templateFallback: input.templateFallback ?? null,
    smsFallback: input.smsFallback ?? null,
    statusMessage: input.statusMessage ?? false,
    orderEvent: input.orderEvent ?? null,
  };
  const [msg] = await tx
    .insert(messages)
    .values({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: 'out',
      kind: specKind(spec),
      body,
      payload: payload as unknown as Record<string, unknown>,
      templateName: spec.type === 'template' ? spec.name : null,
      status: 'queued',
      sentBy: input.sentBy,
      sentByUserId: input.sentByUserId ?? null,
      orderId: input.orderId ?? null,
      ...(input.now ? { createdAt: input.now } : {}),
    })
    .returning({ id: messages.id, createdAt: messages.createdAt });
  const runAt = await reserveSendSlot(tx, input.tenantId, input.conversationId);
  await enqueueJob(tx, {
    queue: 'wa-outbound',
    type: 'wa.send',
    payload: { messageId: msg!.id, ...(input.orderId ? { orderId: input.orderId } : {}) },
    runAt,
    dedupeKey: `wa_send:${msg!.id}`,
    tenantId: input.tenantId,
    maxAttempts: 6,
  });
  const [conv] = await tx
    .update(conversations)
    .set({ lastMessageAt: msg!.createdAt, lastMessagePreview: previewText(body), updatedAt: new Date() })
    .where(eq(conversations.id, input.conversationId))
    .returning({ unreadCount: conversations.unreadCount });
  await appendBranchEvent(tx, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    type: 'conversation.message',
    payload: {
      conversationId: input.conversationId,
      messageId: msg!.id,
      direction: 'out',
      preview: previewText(body),
      unreadCount: conv?.unreadCount ?? 0,
      at: msg!.createdAt.toISOString(),
    },
  });
  return { messageId: msg!.id, runAt };
}

/** conversation.updated SSE olayı (mod / okunmamış değişimi). */
export async function emitConversationUpdated(
  tx: Database,
  conv: { id: string; tenantId: string; branchId: string; mode: 'bot' | 'human'; unreadCount: number; humanUntil: Date | null },
): Promise<void> {
  await appendBranchEvent(tx, {
    tenantId: conv.tenantId,
    branchId: conv.branchId,
    type: 'conversation.updated',
    payload: {
      conversationId: conv.id,
      mode: conv.mode,
      unreadCount: conv.unreadCount,
      humanUntil: conv.humanUntil ? conv.humanUntil.toISOString() : null,
    },
  });
}

/** Bot durumu satırını getirir (yoksa oluşturur). */
export async function ensureBotState(tx: Database, tenantId: string, conversationId: string) {
  await tx.insert(conversationBotState).values({ conversationId, tenantId }).onConflictDoNothing();
  const [row] = await tx.select().from(conversationBotState).where(eq(conversationBotState.conversationId, conversationId));
  return row!;
}
