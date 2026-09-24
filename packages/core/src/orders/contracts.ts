// Dilim 2 (sipariş yaşam döngüsü) sözleşmeleri: panel kartı/detayı, takip sayfası genişletmesi, fiş, kurye,
// telefon siparişi. 14 §6.2/§6.3 çekirdek şemalarının geriye uyumlu genişletmeleridir; web ve API aynı şemayı kullanır.
// İçe aktarma: `@siparis/core/orders/contracts`.

import { z } from 'zod';
import { idSchema, kurusSchema, nonNegativeKurusSchema } from '../contracts/common';
import { cancelOrderRequestSchema, orderDetailSchema, orderSummarySchema, rejectOrderRequestSchema, assignCourierRequestSchema } from '../contracts/orders';
import { cartItemSchema, trackResponseSchema } from '../contracts/store';
import { TENANT_CANCEL_REASONS, deliveryZoneKindSchema, mealCardBrandSchema, paymentMethodSchema } from '../enums';

const isoNullable = z.string().nullable();

// ---------------------------------------------------------------------------
// Kademeli alarm adımları (00 §10; orderAlarmPayloadSchema.step)

export const ALARM_STEP = {
  /** t0: order.created / order.updated → new (ayrı iş yok) */
  START: 1,
  /** 60 sn: ses tekrarı (yükselen) */
  REPEAT: 2,
  /** 2 dk: platform WhatsApp uyarısı (sahibine bildirildi) */
  PLATFORM_WA: 3,
  /** 5 dk: SMS */
  SMS: 4,
  /** 10 dk (varsayılan): müşteriye "henüz onaylanmadı" bilgisi */
  CUSTOMER_NOTICE: 5,
  /** 15 dk (varsayılan): otomatik iptal (tenant_no_response) */
  AUTO_CANCEL: 6,
} as const;

// ---------------------------------------------------------------------------
// Panel kartı ve detay (04 §4.4, §4.11)

export const cardItemSchema = z.object({
  name: z.string(),
  quantity: z.number().int(),
  options: z.array(z.string()),
  note: z.string().nullable(),
  lineTotalKurus: z.number().int().optional(),
});
export type CardItem = z.infer<typeof cardItemSchema>;

/** Canlı ekran kartı: özet + kalemler + kart rozetleri. Mutfak projeksiyonunda fiyat ve kişisel alanlar yoktur/null. */
export const orderCardSchema = orderSummarySchema.extend({
  items: z.array(cardItemSchema),
  note: z.string().nullable(),
  zoneName: z.string().nullable(),
  changeForKurus: z.number().int().nullable().optional(),
  /** Müşterinin toplam sipariş sayısı ("5. sipariş" / "Yeni müşteri"). */
  customerOrderCount: z.number().int().nullable(),
  customerBlocked: z.boolean(),
  courierName: z.string().nullable(),
  /** Bekleyen müşteri iptal talebi. */
  cancelRequestId: z.string().nullable(),
  /** Ulaşılan en yüksek alarm adımı (ALARM_STEP). */
  alarmStep: z.number().int().nullable(),
  outOfZoneOverride: z.boolean(),
  verifiedAt: isoNullable,
  preparingAt: isoNullable,
  readyAt: isoNullable,
  onTheWayAt: isoNullable,
  deliveredAt: isoNullable,
  rejectedAt: isoNullable,
  cancelledAt: isoNullable,
  delayNoticeCount: z.number().int(),
  /** "Onayla · N dk" varsayılanı (04 §4.6): paket = bölge + hazırlık (+ yoğunluk), gel-al = hazırlık (+ yoğunluk); 5'e yuvarlı. */
  suggestedEtaMinutes: z.number().int().nullable(),
});
export type OrderCard = z.infer<typeof orderCardSchema>;

export const orderDetailExtSchema = orderDetailSchema.extend({
  /** Mutfak projeksiyonunda fiyat alanları yoktur. */
  changeForKurus: z.number().int().nullable().optional(),
  card: orderCardSchema,
  customer: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      orderCount: z.number().int(),
      lastOrderAt: isoNullable,
      notes: z.string().nullable(),
      isBlocked: z.boolean(),
      recent: z.array(
        z.object({
          id: z.string(),
          number: z.number().int(),
          status: z.string(),
          placedAt: z.string(),
          totalKurus: z.number().int().optional(),
          itemsText: z.string(),
        }),
      ),
    })
    .nullable(),
  cancellationRequest: z
    .object({ id: z.string(), reason: z.string().nullable(), status: z.string(), requestedAt: z.string() })
    .nullable(),
  review: z.object({ rating: z.string(), comment: z.string().nullable() }).nullable(),
  acks: z.array(z.object({ userName: z.string().nullable(), deviceLabel: z.string().nullable(), ackedAt: z.string() })),
  printedCount: z.number().int(),
  /** Takip sayfası yolu (/t/<token>) — personel müşteriyle paylaşabilir. */
  trackingPath: z.string().nullable(),
});
export type OrderDetailExt = z.infer<typeof orderDetailExtSchema>;

export const activeOrdersResponseSchema = z.object({
  branch: z.object({
    id: z.string(),
    name: z.string(),
    usePreparingStep: z.boolean(),
    defaultPrepMinutes: z.number().int(),
    busyExtraMinutes: z.number().int(),
    acceptsDelivery: z.boolean(),
  }),
  items: z.array(orderCardSchema),
  /** Bugün tamamlananlar (delivered/rejected/cancelled), en yeni üstte. */
  completed: z.array(orderCardSchema),
  serverTime: z.string(),
});
export type ActiveOrdersResponse = z.infer<typeof activeOrdersResponseSchema>;

export const ordersListResponseSchema = z.object({ items: z.array(orderCardSchema), nextCursor: z.string().optional() });
export type OrdersListResponse = z.infer<typeof ordersListResponseSchema>;

export const orderCardResponseSchema = z.object({ order: orderCardSchema });
export type OrderCardResponse = z.infer<typeof orderCardResponseSchema>;

export const rejectOrderResponseSchema = orderCardResponseSchema.extend({ undoDeadline: z.string() });
export type RejectOrderResponse = z.infer<typeof rejectOrderResponseSchema>;

/** Panel ret isteği: çekirdek + "Bugün tükendi yap" ve "kara listeye al" (04 §4.7). */
export const panelRejectRequestSchema = rejectOrderRequestSchema.extend({
  soldOutProductIds: z.array(idSchema).max(50).optional(),
  blockCustomer: z.boolean().optional(),
});
export type PanelRejectRequest = z.infer<typeof panelRejectRequestSchema>;

/** 04 §4.9 çipleri: "Müşteri istedi" (customer_request → cancelled_by customer) + işletme sebepleri. */
export const PANEL_CANCEL_REASONS = ['customer_request', ...TENANT_CANCEL_REASONS] as const;
export const panelCancelRequestSchema = cancelOrderRequestSchema.extend({ reason: z.enum(PANEL_CANCEL_REASONS) });
export type PanelCancelRequest = z.infer<typeof panelCancelRequestSchema>;

export const panelAssignCourierRequestSchema = assignCourierRequestSchema.extend({ onTheWay: z.boolean().optional() });
export type PanelAssignCourierRequest = z.infer<typeof panelAssignCourierRequestSchema>;

export const courierListResponseSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string(), activeCount: z.number().int(), onTheWayCount: z.number().int() })),
});
export type CourierListResponse = z.infer<typeof courierListResponseSchema>;

// ---------------------------------------------------------------------------
// Telefon siparişi (Akış E, 04 §4.13)

export const manualOrderRequestSchema = z.object({
  items: z.array(cartItemSchema).min(1).max(100),
  fulfillmentType: z.enum(['delivery', 'pickup']),
  zoneId: idSchema.optional(),
  neighborhood: z.string().trim().max(80).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  customerName: z.string().trim().min(2).max(80),
  customerPhone: z.string().trim().min(10).max(20),
  addressLine: z.string().trim().max(300).optional(),
  directions: z.string().trim().max(300).optional(),
  paymentMethod: paymentMethodSchema,
  mealCardBrand: mealCardBrandSchema.optional(),
  changeForKurus: nonNegativeKurusSchema.optional(),
  wantsCutlery: z.boolean().default(false),
  note: z.string().trim().max(140).optional(),
  /** Bölge dışı istisnası (00 §4): personel uyarıyı görerek özel ücretle kaydeder; audit'e yazılır. */
  outOfZoneFeeKurus: nonNegativeKurusSchema.optional(),
  /** true (varsayılan): aynı işlemde new → accepted (alarm çalmaz). */
  acceptNow: z.boolean().default(true),
  etaMinutes: z.number().int().min(5).max(180).optional(),
  /** "Müşteri WhatsApp'tan bilgilendirilmeyi kabul etti" (varsayılan işaretsiz). */
  notifyWhatsapp: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(100).optional(),
});
export type ManualOrderRequest = z.input<typeof manualOrderRequestSchema>;

export const manualMenuResponseSchema = z.object({
  branch: z.object({
    id: z.string(),
    name: z.string(),
    acceptsDelivery: z.boolean(),
    acceptsPickup: z.boolean(),
    paymentMethods: z.array(z.string()),
    mealCardBrands: z.array(z.string()),
    prepMinutes: z.number().int(),
    busyExtraMinutes: z.number().int(),
  }),
  zones: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: deliveryZoneKindSchema,
      neighborhoods: z.array(z.string()),
      feeKurus: kurusSchema,
      minOrderKurus: kurusSchema,
      etaMinutes: z.number().int(),
    }),
  ),
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      products: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          priceKurus: kurusSchema,
          soldOut: z.boolean(),
          optionGroups: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              minSelect: z.number().int(),
              maxSelect: z.number().int().nullable(),
              options: z.array(z.object({ id: z.string(), name: z.string(), priceDeltaKurus: kurusSchema })),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type ManualMenuResponse = z.infer<typeof manualMenuResponseSchema>;

export const customerLookupResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      phoneE164: z.string().nullable(),
      orderCount: z.number().int(),
      isBlocked: z.boolean(),
      notes: z.string().nullable(),
      addresses: z.array(
        z.object({
          id: z.string(),
          label: z.string().nullable(),
          neighborhood: z.string().nullable(),
          addressLine: z.string().nullable(),
          directions: z.string().nullable(),
        }),
      ),
      lastOrders: z.array(
        z.object({
          id: z.string(),
          number: z.number().int(),
          placedAt: z.string(),
          totalKurus: kurusSchema,
          items: z.array(
            z.object({
              productId: z.string().nullable(),
              name: z.string(),
              quantity: z.number().int(),
              note: z.string().nullable(),
              optionIds: z.array(z.string()),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type CustomerLookupResponse = z.infer<typeof customerLookupResponseSchema>;

// ---------------------------------------------------------------------------
// Fiş (04 §4.14)

export const RECEIPT_TYPES = ['kitchen', 'delivery'] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];

export const receiptSchema = z.object({
  type: z.enum(RECEIPT_TYPES),
  /** Yeniden baskı: "KOPYA". */
  copy: z.boolean(),
  business: z.object({ name: z.string(), branchName: z.string().nullable(), phone: z.string().nullable() }),
  number: z.number().int(),
  /** "20.35" */
  placedAt: z.string(),
  printedAt: z.string(),
  fulfillmentType: z.string(),
  fulfillmentLabel: z.string(),
  estimatedReadyAt: z.string().nullable(),
  items: z.array(
    z.object({
      quantity: z.number().int(),
      name: z.string(),
      /** removal: "Soğansız" gibi çıkarılacaklar (BÜYÜK HARF, kalın basılır). */
      options: z.array(z.object({ text: z.string(), removal: z.boolean() })),
      note: z.string().nullable(),
      lineTotalKurus: z.number().int().optional(),
    }),
  ),
  note: z.string().nullable(),
  wantsCutlery: z.boolean(),
  /** Mutfak fişinde null (kişisel veri yok). */
  customer: z
    .object({
      name: z.string().nullable(),
      phoneMasked: z.string().nullable(),
      neighborhood: z.string().nullable(),
      addressLine: z.string().nullable(),
      directions: z.string().nullable(),
      zoneName: z.string().nullable(),
    })
    .nullable(),
  totals: z.object({ subtotalKurus: z.number().int(), deliveryFeeKurus: z.number().int(), totalKurus: z.number().int() }).nullable(),
  payment: z
    .object({ method: z.string(), label: z.string(), changeForKurus: z.number().int().nullable(), changeKurus: z.number().int().nullable() })
    .nullable(),
  trackingUrl: z.string().nullable(),
  footer: z.string(),
});
export type Receipt = z.infer<typeof receiptSchema>;

// ---------------------------------------------------------------------------
// Kurye (04 §9)

export const courierOrderSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  status: z.string(),
  fulfillmentType: z.string(),
  customerName: z.string().nullable(),
  /** Tam numara (yalnız atanmış kuryeye). */
  customerPhone: z.string().nullable(),
  neighborhood: z.string().nullable(),
  addressLine: z.string().nullable(),
  directions: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  zoneName: z.string().nullable(),
  paymentMethod: z.string(),
  mealCardBrand: z.string().nullable(),
  totalKurus: z.number().int(),
  changeForKurus: z.number().int().nullable(),
  changeKurus: z.number().int().nullable(),
  note: z.string().nullable(),
  items: z.array(z.object({ name: z.string(), quantity: z.number().int(), options: z.array(z.string()), note: z.string().nullable() })),
  estimatedReadyAt: z.string().nullable(),
  readyAt: z.string().nullable(),
  onTheWayAt: z.string().nullable(),
  version: z.number().int(),
});
export type CourierOrder = z.infer<typeof courierOrderSchema>;

export const courierOrdersResponseSchema = z.object({
  items: z.array(courierOrderSchema),
  deliveredToday: z.number().int(),
  serverTime: z.string(),
});
export type CourierOrdersResponse = z.infer<typeof courierOrdersResponseSchema>;

export const courierDeliveredRequestSchema = z
  .object({
    /** "Farklı yöntemle ödendi" — verilmezse siparişteki yöntemle ödendi sayılır. */
    paidWith: paymentMethodSchema.optional(),
    mealCardBrand: mealCardBrandSchema.optional(),
  })
  .optional();

export const courierActionResponseSchema = z.object({ order: courierOrderSchema.nullable(), status: z.string() });

// ---------------------------------------------------------------------------
// Storefront doğrulama ve takip genişletmeleri (03 §3.2, §7)

export const smsOtpResponseSchema = z.object({
  ok: z.literal(true),
  phoneMasked: z.string(),
  expiresAt: z.string(),
  resendAfterSec: z.number().int(),
});
export type SmsOtpResponse = z.infer<typeof smsOtpResponseSchema>;

export const smsVerifyResponseSchema = z.object({ ok: z.literal(true), status: z.string(), trackingUrl: z.string() });
export type SmsVerifyResponse = z.infer<typeof smsVerifyResponseSchema>;

export const trackCancelResponseSchema = z.object({ result: z.enum(['cancelled', 'requested']), status: z.string() });
export type TrackCancelResponse = z.infer<typeof trackCancelResponseSchema>;

const baseTrackOrder = trackResponseSchema.shape.order;
const baseTrackBusiness = trackResponseSchema.shape.business;

/** 14 §6.2 takip yanıtı + storefront ekranlarının ek alanları (kişisel veri maskeli). */
export const trackResponseExtSchema = trackResponseSchema.extend({
  order: baseTrackOrder.extend({
    id: z.string(),
    channel: z.string(),
    placedAt: z.string(),
    reasonText: z.string().nullable(),
    courierName: z.string().nullable(),
    neighborhood: z.string().nullable(),
    addressMasked: z.string().nullable(),
    phoneMasked: z.string().nullable(),
    mealCardBrand: z.string().nullable(),
    changeForKurus: z.number().int().nullable(),
    note: z.string().nullable(),
    readyAt: z.string().nullable(),
    cancelRequestStatus: z.enum(['pending', 'approved', 'rejected']).nullable(),
    /** `new` iken onay gecikmesi satırı (03 §7.3): noticeAt'ten sonra gösterilir. */
    approvalDelay: z.object({ noticeAt: z.string(), autoCancelAt: z.string() }).nullable(),
    /** `awaiting_customer` iken doğrulama ekranı (S-06B/C). */
    verification: z
      .object({
        method: z.enum(['wa_code', 'sms_otp']).nullable(),
        code: z.string().nullable(),
        waLink: z.string().nullable(),
        smsAvailable: z.boolean(),
        expiresAt: z.string(),
      })
      .nullable(),
  }),
  business: baseTrackBusiness.extend({
    slug: z.string(),
    /** İşletmenin WhatsApp numarası (bağlıysa; "WhatsApp'tan yaz"). */
    waPhone: z.string().nullable(),
  }),
});
export type TrackResponseExt = z.infer<typeof trackResponseExtSchema>;

/** Süresi dolmuş takip linki (410 tracking_link_expired) hata ayrıntısı: kişisel veri yok. */
export interface TrackExpiredDetails {
  business: { name: string; phone: string | null; slug: string };
}
