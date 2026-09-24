// Sipariş DTO'ları (panel + takip) ve panel aksiyon istekleri (14 §6.3).

import { z } from 'zod';
import {
  cancelledBySchema,
  cancelReasonSchema,
  fulfillmentTypeSchema,
  mealCardBrandSchema,
  orderChannelSchema,
  orderStatusSchema,
  paymentMethodSchema,
  paymentStatusSchema,
  rejectionReasonSchema,
  TENANT_CANCEL_REASONS,
  testKindSchema,
  verificationMethodSchema,
} from '../enums';
import { idSchema, isoDateTimeSchema, kurusSchema } from './common';

/**
 * Sipariş özeti: panel kartları, SSE `order.*` olayları ve listeler.
 * Fiyat alanları `kitchen` projeksiyonunda yoktur (bu yüzden opsiyonel).
 */
export const orderSummarySchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  branchId: idSchema,
  number: z.number().int(),
  status: orderStatusSchema,
  channel: orderChannelSchema,
  fulfillmentType: fulfillmentTypeSchema,
  testKind: testKindSchema.nullable(),
  customerName: z.string().nullable(),
  /** Son 4 hane açık. */
  customerPhoneMasked: z.string().nullable(),
  neighborhood: z.string().nullable(),
  itemCount: z.number().int(),
  subtotalKurus: kurusSchema.optional(),
  deliveryFeeKurus: kurusSchema.optional(),
  totalKurus: kurusSchema.optional(),
  paymentMethod: paymentMethodSchema,
  paymentStatus: paymentStatusSchema,
  mealCardBrand: mealCardBrandSchema.nullable(),
  etaMinutes: z.number().int().nullable(),
  estimatedReadyAt: isoDateTimeSchema.nullable(),
  placedAt: isoDateTimeSchema,
  firstAckedAt: isoDateTimeSchema.nullable(),
  acceptedAt: isoDateTimeSchema.nullable(),
  rejectionScheduledAt: isoDateTimeSchema.nullable(),
  rejectionReason: rejectionReasonSchema.nullable(),
  cancelReason: cancelReasonSchema.nullable(),
  cancelledBy: cancelledBySchema.nullable(),
  cancelRequested: z.boolean(),
  courierUserId: idSchema.nullable(),
  verificationMethod: verificationMethodSchema.nullable(),
  version: z.number().int(),
  updatedAt: isoDateTimeSchema,
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;

export const orderItemOptionDtoSchema = z.object({
  groupName: z.string(),
  optionName: z.string(),
  priceDeltaKurus: kurusSchema.optional(),
});

export const orderItemDtoSchema = z.object({
  id: idSchema,
  productId: idSchema.nullable(),
  name: z.string(),
  quantity: z.number().int(),
  unitPriceKurus: kurusSchema.optional(),
  optionsUnitKurus: kurusSchema.optional(),
  lineTotalKurus: kurusSchema.optional(),
  note: z.string().nullable(),
  options: z.array(orderItemOptionDtoSchema),
});
export type OrderItemDto = z.infer<typeof orderItemDtoSchema>;

export const orderEventDtoSchema = z.object({
  id: idSchema,
  type: z.string(),
  fromStatus: orderStatusSchema.nullable(),
  toStatus: orderStatusSchema.nullable(),
  actorType: z.string(),
  actorName: z.string().nullable(),
  reason: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type OrderEventDto = z.infer<typeof orderEventDtoSchema>;

/** Panel sipariş ayrıntısı. */
export const orderDetailSchema = orderSummarySchema.extend({
  items: z.array(orderItemDtoSchema),
  events: z.array(orderEventDtoSchema),
  customerId: idSchema.nullable(),
  /** Tam numara yalnız yetkili rollere (kasiyer ve üstü, atanmış kurye). */
  customerPhone: z.string().nullable(),
  addressLine: z.string().nullable(),
  directions: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  zoneName: z.string().nullable(),
  note: z.string().nullable(),
  changeForKurus: kurusSchema.nullable(),
  wantsCutlery: z.boolean(),
  rejectionNote: z.string().nullable(),
  cancelNote: z.string().nullable(),
  delayNoticeCount: z.number().int(),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

const versionField = z.number().int().min(1).optional();

export const acceptOrderRequestSchema = z.object({
  etaMinutes: z.number().int().min(5).max(180),
  version: versionField,
});
export type AcceptOrderRequest = z.infer<typeof acceptOrderRequestSchema>;

export const rejectOrderRequestSchema = z.object({
  reason: rejectionReasonSchema,
  note: z.string().trim().max(140).optional(),
  version: versionField,
});
export type RejectOrderRequest = z.infer<typeof rejectOrderRequestSchema>;

export const ADVANCE_TARGETS = ['preparing', 'ready', 'on_the_way', 'delivered'] as const;
export const advanceOrderRequestSchema = z.object({
  to: z.enum(ADVANCE_TARGETS),
  version: versionField,
});
export type AdvanceOrderRequest = z.infer<typeof advanceOrderRequestSchema>;

export const cancelOrderRequestSchema = z.object({
  reason: z.enum(TENANT_CANCEL_REASONS),
  note: z.string().trim().max(140).optional(),
  version: versionField,
});
export type CancelOrderRequest = z.infer<typeof cancelOrderRequestSchema>;

export const delayOrderRequestSchema = z.object({
  extraMinutes: z.number().int().min(5).max(120),
});
export type DelayOrderRequest = z.infer<typeof delayOrderRequestSchema>;

export const assignCourierRequestSchema = z.object({
  userId: idSchema.nullable(),
});
export type AssignCourierRequest = z.infer<typeof assignCourierRequestSchema>;

export const ordersListQuerySchema = z.object({
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().max(100).optional(),
  cursor: z.string().max(200).optional(),
  branchId: idSchema.optional(),
});
export type OrdersListQuery = z.infer<typeof ordersListQuerySchema>;
