// SSE olay yükleri (14 §7.1). Olay adı = branch_events.type; id = branch_events.seq.

import { z } from 'zod';
import { conversationModeSchema, orderingStateSchema, orderStatusSchema } from '../enums';
import { idSchema, isoDateTimeSchema } from './common';
import { orderSummarySchema } from './orders';

/** order.created ve order.updated ortak yükü: sipariş özeti + ne değişti. */
export const orderEventPayloadSchema = z.object({
  order: orderSummarySchema,
  /** 'created' | 'status' | 'ack' | 'rejection_scheduled' | 'rejection_undone' | 'eta' | 'courier' | 'cancel_request' | ... */
  change: z.string(),
  from: orderStatusSchema.nullable(),
  to: orderStatusSchema.nullable(),
});
export type OrderEventPayload = z.infer<typeof orderEventPayloadSchema>;

export const orderAlarmPayloadSchema = z.object({
  orderId: idSchema,
  number: z.number().int().optional(),
  /** 00 §10 zinciri: 1 = t0, 2 = 60 sn, 3 = 2 dk platform WA, 4 = 5 dk SMS, 5 = 10 dk müşteri, 6 = otomatik iptal */
  step: z.number().int(),
});
export type OrderAlarmPayload = z.infer<typeof orderAlarmPayloadSchema>;

export const conversationMessagePayloadSchema = z.object({
  conversationId: idSchema,
  messageId: idSchema,
  direction: z.enum(['in', 'out']),
  preview: z.string(),
  unreadCount: z.number().int(),
  at: isoDateTimeSchema,
});
export type ConversationMessagePayload = z.infer<typeof conversationMessagePayloadSchema>;

export const conversationUpdatedPayloadSchema = z.object({
  conversationId: idSchema,
  mode: conversationModeSchema,
  unreadCount: z.number().int(),
  humanUntil: isoDateTimeSchema.nullable().optional(),
});
export type ConversationUpdatedPayload = z.infer<typeof conversationUpdatedPayloadSchema>;

export const branchStatePayloadSchema = z.object({
  orderingState: orderingStateSchema,
  pausedUntil: isoDateTimeSchema.nullable(),
  busyExtraMinutes: z.number().int(),
  nextOpenAt: isoDateTimeSchema.nullable(),
});
export type BranchStatePayload = z.infer<typeof branchStatePayloadSchema>;

/** Akışta gelen tüm olay adları; 'resync' saklanmaz, yalnız akışta gönderilir (istemci /orders/active çeker). */
export const STREAM_EVENT_TYPES = [
  'order.created',
  'order.updated',
  'order.alarm',
  'conversation.message',
  'conversation.updated',
  'branch.state',
  'ping',
  'resync',
] as const;
export type StreamEventType = (typeof STREAM_EVENT_TYPES)[number];

export interface StreamEventMap {
  'order.created': OrderEventPayload;
  'order.updated': OrderEventPayload;
  'order.alarm': OrderAlarmPayload;
  'conversation.message': ConversationMessagePayload;
  'conversation.updated': ConversationUpdatedPayload;
  'branch.state': BranchStatePayload;
  ping: { at: string };
  resync: { reason: string };
}

/** SSE ping aralığı (14 §7.1). */
export const SSE_PING_INTERVAL_MS = 15_000;
/** Panel emniyet sorgusu aralığı (14 §7.1). */
export const SAFETY_POLL_INTERVAL_MS = 45_000;
