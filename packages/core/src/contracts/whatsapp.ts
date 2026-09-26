// Panel WhatsApp ayarları (14 §6.3 WhatsApp) ve ortak numara (00 §12a madde 8). Web ve API aynı şemayı kullanır.

import { z } from 'zod';
import { WA_ACCOUNT_STATUSES, waModeSchema, waOwnProviderSchema, waProviderSchema } from '../enums';

export const panelWhatsappAccountSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  /** Ortak numara modunda 'shared' */
  provider: waProviderSchema,
  providerLabel: z.string(),
  /** Ortak numarada platformun numarası */
  displayPhone: z.string().nullable(),
  displayPhoneFormatted: z.string().nullable(),
  phoneNumberId: z.string().nullable(),
  wabaId: z.string().nullable(),
  hasApiKey: z.boolean(),
  apiKeyMasked: z.string().nullable(),
  status: z.enum(WA_ACCOUNT_STATUSES),
  statusLabel: z.string(),
  lastWebhookAt: z.string().nullable(),
  lastError: z.string().nullable(),
  /** İşletmeye özel webhook adresi; ortak numarada yoktur (null) */
  webhookUrl: z.string().nullable(),
  updatedAt: z.string(),
});
export type PanelWhatsappAccount = z.infer<typeof panelWhatsappAccountSchema>;

/** Ortak numara bilgisi (yalnız mode = 'shared'). Kod yalnız platform yöneticisince değişir (canEditCode false). */
export const panelWhatsappSharedSchema = z.object({
  /** Dükkan kodu (tenants.wa_code), ör. BOZOK */
  code: z.string().nullable(),
  /** Müşterinin sohbet başlığında gördüğü ad ("Siparişin Önünde") */
  displayName: z.string(),
  /** Ortak numara (E.164); yapılandırılmamışsa null */
  displayPhone: z.string().nullable(),
  displayPhoneFormatted: z.string().nullable(),
  /** QR/bağlantının ön-dolu mesajı ("Merhaba, … için sipariş vermek istiyorum. #BOZOK") */
  prefillText: z.string().nullable(),
  /** wa.me/<ortak numara>?text=<ön-dolu mesaj> (QR içeriği) */
  waLink: z.string().nullable(),
  /** waLink'in QR kodu (SVG metni); indirme: GET /panel/whatsapp/qr?format=svg|png */
  qrSvg: z.string().nullable(),
  /** Dükkan ortak numaranın dükkan listesinde görünüyor ve seçilebiliyor mu (canlı + sipariş açık) */
  selectable: z.boolean(),
  /** selectable false ise Türkçe sebep */
  selectableReason: z.string().nullable(),
  canEditCode: z.boolean(),
});
export type PanelWhatsappShared = z.infer<typeof panelWhatsappSharedSchema>;

export const panelWhatsappResponseSchema = z.object({
  /** 'shared': ortak numara (varsayılan) · 'own': işletmenin kendi numarası */
  mode: waModeSchema,
  /** Dükkan kodu (her iki modda; ortak numarada QR'da kullanılır) */
  code: z.string().nullable(),
  shared: panelWhatsappSharedSchema.nullable(),
  account: panelWhatsappAccountSchema.nullable(),
  health: z.object({
    level: z.enum(['ok', 'warning', 'error', 'none']),
    message: z.string(),
    sentLast24h: z.number().int(),
    failedLast24h: z.number().int(),
    lastOutboundAt: z.string().nullable(),
    lastInboundAt: z.string().nullable(),
  }),
  smsFallback: z.object({ tenantEnabled: z.boolean(), platformEnabled: z.boolean(), active: z.boolean() }),
  /** Kendi numara için seçilebilen sağlayıcılar (ortak numarada da döner; PUT yalnız 'own' modda) */
  providers: z.array(z.object({ value: waOwnProviderSchema, label: z.string() })),
});
export type PanelWhatsappResponse = z.infer<typeof panelWhatsappResponseSchema>;

export const panelWhatsappPutSchema = z.object({
  provider: waOwnProviderSchema,
  displayPhone: z.string().min(1).max(32),
  phoneNumberId: z.string().trim().max(64).optional().nullable(),
  wabaId: z.string().trim().max(64).optional().nullable(),
  /** Boş/verilmezse mevcut anahtar korunur */
  apiKey: z.string().trim().max(1024).optional().nullable(),
});
export type PanelWhatsappPut = z.input<typeof panelWhatsappPutSchema>;

export const panelWhatsappQrQuerySchema = z.object({ format: z.enum(['svg', 'png']).optional() });
