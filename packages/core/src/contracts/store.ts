// Storefront uç noktaları (14 §6.2). Web ve API aynı şemayı kullanır.

import { z } from 'zod';
import {
  deliveryZoneKindSchema,
  fulfillmentTypeSchema,
  mealCardBrandSchema,
  orderingStateSchema,
  orderStatusSchema,
  paymentMethodSchema,
  reviewRatingSchema,
} from '../enums';
import { MAX_CART_LINES, MAX_ITEM_QUANTITY } from '../pricing';
import { idSchema, isoDateTimeSchema, kurusSchema, nonNegativeKurusSchema } from './common';

export const storeOptionSchema = z.object({
  id: idSchema,
  name: z.string(),
  priceDeltaKurus: kurusSchema,
});

export const storeOptionGroupSchema = z.object({
  id: idSchema,
  name: z.string(),
  minSelect: z.number().int(),
  maxSelect: z.number().int().nullable(),
  options: z.array(storeOptionSchema),
});

export const storeProductSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  priceKurus: kurusSchema,
  imageUrl: z.string().nullable(),
  soldOut: z.boolean(),
  optionGroups: z.array(storeOptionGroupSchema),
});
export type StoreProduct = z.infer<typeof storeProductSchema>;

export const storeCategorySchema = z.object({
  id: idSchema,
  name: z.string(),
  products: z.array(storeProductSchema),
});

export const storeZoneSchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: deliveryZoneKindSchema,
  neighborhoods: z.array(z.string()),
  feeKurus: kurusSchema,
  minOrderKurus: kurusSchema,
  etaMinutes: z.number().int(),
});
export type StoreZone = z.infer<typeof storeZoneSchema>;

export const storefrontResponseSchema = z.object({
  tenant: z.object({
    name: z.string(),
    slug: z.string(),
    brandColor: z.string().nullable(),
    logoUrl: z.string().nullable(),
    coverUrl: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  branch: z.object({
    id: idSchema,
    name: z.string(),
    address: z.string().nullable(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    orderingState: orderingStateSchema,
    nextOpenAt: isoDateTimeSchema.nullable(),
    acceptsDelivery: z.boolean(),
    acceptsPickup: z.boolean(),
    paymentMethods: z.array(paymentMethodSchema),
    mealCardBrands: z.array(z.string()),
    prepMinutes: z.number().int(),
    busyExtraMinutes: z.number().int().optional(),
  }),
  /** Tenant kill-switch'i kapalıysa false (storefront "şu an online sipariş alınmıyor" gösterir). */
  orderingEnabled: z.boolean().optional(),
  zones: z.array(storeZoneSchema),
  categories: z.array(storeCategorySchema),
  legal: z.object({
    legalName: z.string().nullable(),
    taxNo: z.string().nullable(),
    taxOffice: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
});
export type StorefrontResponse = z.infer<typeof storefrontResponseSchema>;

export const storeSessionRequestSchema = z.object({
  linkToken: z.string().min(8).max(400).optional(),
});
export type StoreSessionRequest = z.infer<typeof storeSessionRequestSchema>;

export const storeSessionResponseSchema = z.object({
  customer: z
    .object({
      name: z.string().nullable(),
      phoneMasked: z.string().nullable(),
    })
    .nullable(),
  lastOrder: z
    .object({
      items: z.array(
        z.object({
          productId: idSchema.nullable(),
          name: z.string(),
          quantity: z.number().int(),
          optionIds: z.array(idSchema),
        }),
      ),
      totalKurus: kurusSchema,
      createdAt: isoDateTimeSchema,
    })
    .nullable(),
});
export type StoreSessionResponse = z.infer<typeof storeSessionResponseSchema>;

export const cartItemSchema = z.object({
  productId: idSchema,
  quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY),
  optionIds: z.array(idSchema).max(30).default([]),
  note: z.string().trim().max(140).optional(),
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const quoteRequestSchema = z.object({
  items: z.array(cartItemSchema).min(1).max(MAX_CART_LINES),
  fulfillmentType: fulfillmentTypeSchema,
  zoneId: idSchema.optional(),
  neighborhood: z.string().trim().max(80).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export const quoteLineSchema = z.object({
  productId: idSchema,
  name: z.string(),
  quantity: z.number().int(),
  unitPriceKurus: kurusSchema,
  optionsUnitKurus: kurusSchema,
  lineTotalKurus: kurusSchema,
  options: z.array(
    z.object({
      groupId: idSchema,
      groupName: z.string(),
      optionId: idSchema,
      optionName: z.string(),
      priceDeltaKurus: kurusSchema,
    }),
  ),
  note: z.string().nullable(),
});

export const quoteProblemSchema = z.object({
  code: z.string(),
  message: z.string(),
  productId: z.string().optional(),
  groupId: z.string().optional(),
  optionId: z.string().optional(),
  missingKurus: kurusSchema.optional(),
});

export const quoteResponseSchema = z.object({
  lines: z.array(quoteLineSchema),
  subtotalKurus: kurusSchema,
  deliveryFeeKurus: kurusSchema,
  totalKurus: kurusSchema,
  minOrderKurus: kurusSchema,
  meetsMinimum: z.boolean(),
  zone: z
    .object({
      id: idSchema,
      name: z.string(),
      feeKurus: kurusSchema,
      minOrderKurus: kurusSchema,
      etaMinutes: z.number().int(),
    })
    .nullable(),
  problems: z.array(quoteProblemSchema),
});
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;

export const createOrderRequestSchema = quoteRequestSchema.extend({
  customerName: z.string().trim().min(2).max(80),
  customerPhone: z.string().trim().min(10).max(20),
  addressLine: z.string().trim().max(300).optional(),
  directions: z.string().trim().max(300).optional(),
  paymentMethod: paymentMethodSchema,
  mealCardBrand: mealCardBrandSchema.optional(),
  changeForKurus: nonNegativeKurusSchema.optional(),
  wantsCutlery: z.boolean().default(false),
  note: z.string().trim().max(140).optional(),
  acceptPreInfo: z.literal(true),
  idempotencyKey: z.string().min(8).max(100),
});
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

export const createOrderResponseSchema = z.object({
  orderId: idSchema,
  number: z.number().int(),
  status: orderStatusSchema,
  trackingUrl: z.string(),
  verification: z.object({
    required: z.boolean(),
    method: z.enum(['wa_code', 'sms_otp']).optional(),
    waLink: z.string().optional(),
    code: z.string().optional(),
    smsAvailable: z.boolean(),
  }),
});
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;

export const smsOtpRequestSchema = z.object({ phone: z.string().trim().min(10).max(20) });
export type SmsOtpRequest = z.infer<typeof smsOtpRequestSchema>;

export const smsVerifyRequestSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });
export type SmsVerifyRequest = z.infer<typeof smsVerifyRequestSchema>;

export const trackTimelineEntrySchema = z.object({
  status: orderStatusSchema,
  label: z.string(),
  at: isoDateTimeSchema.nullable(),
});

export const trackResponseSchema = z.object({
  order: z.object({
    number: z.number().int(),
    status: orderStatusSchema,
    statusLabel: z.string(),
    timeline: z.array(trackTimelineEntrySchema),
    items: z.array(
      z.object({
        name: z.string(),
        quantity: z.number().int(),
        options: z.array(z.string()),
        lineTotalKurus: kurusSchema,
      }),
    ),
    totals: z.object({
      subtotalKurus: kurusSchema,
      deliveryFeeKurus: kurusSchema,
      totalKurus: kurusSchema,
    }),
    fulfillmentType: fulfillmentTypeSchema,
    paymentMethod: paymentMethodSchema.optional(),
    etaAt: isoDateTimeSchema.nullable(),
    canCancel: z.boolean(),
    canRequestCancel: z.boolean(),
    cancelRequested: z.boolean().optional(),
    review: z.object({ rating: reviewRatingSchema, comment: z.string().nullable() }).nullable(),
  }),
  business: z.object({ name: z.string(), phone: z.string().nullable() }),
  expired: z.literal(false),
});
export type TrackResponse = z.infer<typeof trackResponseSchema>;

export const trackCancelRequestSchema = z.object({
  reason: z.string().trim().max(280).optional(),
});
export type TrackCancelRequest = z.infer<typeof trackCancelRequestSchema>;

export const reviewRequestSchema = z.object({
  rating: reviewRatingSchema,
  comment: z.string().trim().max(280).optional(),
});
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;
