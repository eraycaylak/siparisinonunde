// WhatsApp sağlayıcı arayüzü (14 §8): mock | cloud | d360. Yalnız resmi Cloud API (ve uyumlu BSP).

import type { WaProvider } from '@siparis/core';

/** Sağlayıcıya iletilecek hesap bilgisi (api anahtarı çözülmüş). */
export interface WaAccountRef {
  id: string;
  tenantId: string;
  branchId: string;
  provider: WaProvider;
  displayPhone: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  /** Çözülmüş API anahtarı (mock'ta boş) */
  apiKey: string | null;
}

export interface WaRecipient {
  bsuid?: string;
  /** E.164 */
  phone?: string;
}

export interface WaInteractiveMessage {
  kind: 'buttons' | 'cta_url' | 'list';
  body: string;
  header?: string;
  footer?: string;
  /** ≤ 3 reply butonu, başlık ≤ 20 karakter */
  buttons?: { id: string; title: string }[];
  url?: { label: string; href: string };
  /** Liste mesajı */
  list?: { buttonTitle: string; sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[] };
}

export interface WaTemplateButton {
  /** URL butonu dinamik soneki ya da hızlı yanıt yükü */
  type: 'url' | 'quick_reply';
  index: number;
  param: string;
}

export interface WhatsAppProvider {
  readonly name: WaProvider;
  sendText(acc: WaAccountRef, to: WaRecipient, text: string): Promise<{ wamid: string }>;
  sendInteractive(acc: WaAccountRef, to: WaRecipient, msg: WaInteractiveMessage): Promise<{ wamid: string }>;
  sendTemplate(
    acc: WaAccountRef,
    to: WaRecipient,
    name: string,
    lang: 'tr',
    params: string[],
    buttons?: WaTemplateButton[],
  ): Promise<{ wamid: string }>;
  /** Ham webhook gövdesini normalize olaylara çevirir (gelen mesaj, durum, echo). */
  parseWebhook(body: unknown): NormalizedWaEvent[];
}

export interface WaSender {
  bsuid?: string;
  phone?: string;
  name?: string;
  username?: string;
}

export type NormalizedWaMessage =
  | { kind: 'text'; text: string }
  | { kind: 'button_reply'; id: string; title: string }
  | { kind: 'list_reply'; id: string; title: string }
  | { kind: 'location'; lat: number; lng: number; name?: string; address?: string }
  | { kind: 'image' | 'audio' | 'video' | 'document' | 'sticker'; mediaId?: string; caption?: string }
  | { kind: 'request_welcome' }
  | { kind: 'unsupported'; type?: string };

export type NormalizedWaEvent =
  | {
      type: 'message';
      phoneNumberId: string | null;
      wamid: string;
      from: WaSender;
      timestamp: Date;
      message: NormalizedWaMessage;
      /** Yanıtlanan mesaj */
      contextWamid?: string;
    }
  | {
      type: 'status';
      phoneNumberId: string | null;
      wamid: string;
      status: 'sent' | 'delivered' | 'read' | 'failed';
      timestamp: Date;
      recipient?: WaRecipient;
      errorCode?: string;
      errorTitle?: string;
      pricing?: { category?: string; billable?: boolean; pricingModel?: string };
    }
  | {
      /** Coexistence: işletme telefonundan yazılan mesajın yankısı */
      type: 'echo';
      phoneNumberId: string | null;
      wamid: string;
      to: WaRecipient;
      timestamp: Date;
      text?: string;
    };
