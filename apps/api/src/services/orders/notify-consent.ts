// Telefon siparişi (Akış E) müşteri bildirimi — dilim 2 (sipariş) ↔ dilim 3 (WhatsApp) tek biçim.
//
// Yazan: POST /panel/orders/manual (`notifyWhatsapp` onay kutusu, varsayılan işaretsiz).
// Okuyan: services/messaging/order-notify.ts (konuşma yoksa yalnız onayla telefon üzerinden şablonla bildirir).
//   onaylı  → orders.status_notify_channel = 'whatsapp' ve orders.source_meta.notifyConsent = true
//   onaysız → orders.status_notify_channel = 'none'     ve orders.source_meta.notifyConsent = false (hiç mesaj gitmez)

/** orders.source_meta'nın dilimler arası anahtarları. */
export interface OrderSourceMeta {
  /** Telefon siparişinde müşteri WhatsApp'tan durum bildirimi almayı kabul etti (kasiyer onay kutusu). */
  notifyConsent?: boolean;
  /** Kaynak etiketi (ör. 'onboarding'). */
  src?: string;
  [key: string]: unknown;
}

/** Manuel sipariş satırına yazılacak bildirim alanları. */
export function phoneOrderNotifyFields(consent: boolean): { statusNotifyChannel: 'whatsapp' | 'none'; sourceMeta: OrderSourceMeta } {
  return { statusNotifyChannel: consent ? 'whatsapp' : 'none', sourceMeta: { notifyConsent: consent } };
}

/** Siparişte açık WhatsApp bildirim onayı var mı (source_meta.notifyConsent === true). */
export function hasNotifyConsent(order: { sourceMeta?: unknown }): boolean {
  const meta = order.sourceMeta;
  return typeof meta === 'object' && meta !== null && (meta as OrderSourceMeta).notifyConsent === true;
}
