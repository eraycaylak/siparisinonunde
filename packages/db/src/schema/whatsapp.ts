// WhatsApp, konuşma, mesaj, ham webhook ve SMS tabloları (14 §4).

import {
  CONVERSATION_MODES,
  CONVERSATION_STATES,
  MESSAGE_DIRECTIONS,
  MESSAGE_KINDS,
  MESSAGE_SENT_BY,
  MESSAGE_STATUSES,
  SMS_PURPOSES,
  SMS_STATUSES,
  WA_ACCOUNT_STATUSES,
  WA_PROVIDERS,
  type ConversationMode,
  type ConversationState,
  type MessageDirection,
  type MessageKind,
  type MessageSentBy,
  type MessageStatus,
  type SmsPurpose,
  type SmsStatus,
  type WaAccountStatus,
  type WaProvider,
} from '@siparis/core';
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, pk, tstz, updatedAt } from './_helpers';
import { customers, orders } from './orders';
import { branches, tenants } from './platform';

export const waAccounts = pgTable(
  'wa_accounts',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<WaProvider>().notNull().default('mock'),
    /** E.164 */
    displayPhone: text('display_phone'),
    phoneNumberId: text('phone_number_id'),
    wabaId: text('waba_id'),
    /** AES-256-GCM (apps/api/src/lib/encryption.ts) */
    apiKeyEnc: text('api_key_enc'),
    /** Webhook URL'sindeki gizli belirteç */
    webhookToken: text('webhook_token').notNull(),
    status: text('status').$type<WaAccountStatus>().notNull().default('disconnected'),
    lastWebhookAt: tstz('last_webhook_at'),
    lastError: text('last_error'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('wa_accounts_webhook_token_uk').on(t.webhookToken),
    uniqueIndex('wa_accounts_branch_uk').on(t.tenantId, t.branchId),
    uniqueIndex('wa_accounts_phone_number_id_uk').on(t.phoneNumberId).where(sql`phone_number_id is not null`),
    enumCheck('wa_accounts_provider_ck', t.provider, WA_PROVIDERS),
    enumCheck('wa_accounts_status_ck', t.status, WA_ACCOUNT_STATUSES),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    waAccountId: uuid('wa_account_id')
      .notNull()
      .references(() => waAccounts.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    mode: text('mode').$type<ConversationMode>().notNull().default('bot'),
    humanUntil: tstz('human_until'),
    state: text('state').$type<ConversationState>().notNull().default('idle'),
    activeOrderId: uuid('active_order_id'),
    lastInboundAt: tstz('last_inbound_at'),
    lastWelcomeAt: tstz('last_welcome_at'),
    lastNudgeAt: tstz('last_nudge_at'),
    lastStatusCardAt: tstz('last_status_card_at'),
    lastClosedNoticeAt: tstz('last_closed_notice_at'),
    lastMessageAt: tstz('last_message_at'),
    lastMessagePreview: text('last_message_preview'),
    unreadCount: integer('unread_count').notNull().default(0),
    optedOut: boolean('opted_out').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('conversations_account_customer_uk').on(t.tenantId, t.waAccountId, t.customerId),
    index('conversations_branch_last_msg_idx').on(t.tenantId, t.branchId, t.lastMessageAt),
    enumCheck('conversations_mode_ck', t.mode, CONVERSATION_MODES),
    enumCheck('conversations_state_ck', t.state, CONVERSATION_STATES),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    direction: text('direction').$type<MessageDirection>().notNull(),
    /** WhatsApp mesaj kimliği (UNIQUE; idempotency) */
    wamid: text('wamid'),
    kind: text('kind').$type<MessageKind>().notNull(),
    body: text('body'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    templateName: text('template_name'),
    status: text('status').$type<MessageStatus>(),
    errorCode: text('error_code'),
    sentBy: text('sent_by').$type<MessageSentBy>(),
    sentByUserId: uuid('sent_by_user_id'),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('messages_wamid_uk').on(t.wamid),
    index('messages_conversation_idx').on(t.tenantId, t.conversationId, t.createdAt),
    index('messages_order_idx').on(t.orderId).where(sql`order_id is not null`),
    enumCheck('messages_direction_ck', t.direction, MESSAGE_DIRECTIONS),
    enumCheck('messages_kind_ck', t.kind, MESSAGE_KINDS),
    enumCheck('messages_status_ck', t.status, MESSAGE_STATUSES),
    enumCheck('messages_sent_by_ck', t.sentBy, MESSAGE_SENT_BY),
  ],
);

/** Ham webhook olayları (platform tablosu; 30 gün saklanır). */
export const waWebhookEvents = pgTable(
  'wa_webhook_events',
  {
    id: pk(),
    provider: text('provider').$type<WaProvider>().notNull(),
    waAccountId: uuid('wa_account_id'),
    tenantId: uuid('tenant_id'),
    payload: jsonb('payload').$type<unknown>().notNull(),
    receivedAt: tstz('received_at').notNull().defaultNow(),
    processedAt: tstz('processed_at'),
    error: text('error'),
  },
  (t) => [index('wa_webhook_events_received_idx').on(t.receivedAt), index('wa_webhook_events_account_idx').on(t.waAccountId)],
);

export const smsMessages = pgTable(
  'sms_messages',
  {
    id: pk(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id'),
    /** E.164 */
    toPhone: text('to_phone').notNull(),
    body: text('body').notNull(),
    purpose: text('purpose').$type<SmsPurpose>().notNull(),
    provider: text('provider').notNull(),
    providerMessageId: text('provider_message_id'),
    status: text('status').$type<SmsStatus>().notNull().default('queued'),
    countsTowardQuota: boolean('counts_toward_quota').notNull().default(false),
    error: text('error'),
    sentAt: tstz('sent_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('sms_messages_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('sms_messages_created_idx').on(t.createdAt),
    enumCheck('sms_messages_purpose_ck', t.purpose, SMS_PURPOSES),
    enumCheck('sms_messages_status_ck', t.status, SMS_STATUSES),
  ],
);
