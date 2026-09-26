// Müşteri tarafı "WhatsApp'tan yaz" bağlantıları (vitrin, takip sayfası). Ortak numara (00 §12a madde 8): API dükkan
// kodlu (#KOD) ön-dolu bağlantıyı hazırlar; müşteri ortak numaraya yazınca yönlendirici #KOD ile doğru dükkanı seçer.
// Kendi numaralı işletmede yalın wa.me bağlantısı kullanılır.

import { extractHashCodes } from '@siparis/core';

const digits = (phone: string) => phone.replace(/\D/g, '');

/** Ön-dolu bağlantıdaki (wa.me/…?text=…#KOD) dükkan kodu; kodsuz ya da bozuk bağlantıda null. */
export function sharedCodeFromLink(link: string | null | undefined): string | null {
  if (!link) return null;
  let text: string | null = null;
  try {
    text = new URL(link).searchParams.get('text');
  } catch {
    return null;
  }
  if (!text) return null;
  const codes = extractHashCodes(text);
  return codes.at(-1) ?? null;
}

/** Vitrin "WhatsApp'tan yaz": API bağlantısı (ortak numarada #KOD'lu) öncelikli; yoksa numaradan yalın wa.me. */
export function storefrontWaHref(tenant: { whatsappLink?: string | null; whatsappPhone?: string | null }): string | null {
  if (tenant.whatsappLink) return tenant.whatsappLink;
  return tenant.whatsappPhone ? `https://wa.me/${digits(tenant.whatsappPhone)}` : null;
}

/**
 * Takip sayfası "WhatsApp'tan yaz" (sipariş hakkında): ortak numarada dükkan kodu mesaja eklenir ki mesaj doğru dükkana
 * gitsin. "#1234" yazılmaz: sipariş numarası dükkan kodu gibi okunmasın diye "Sipariş no 1234".
 */
export function orderWaHref(business: { waPhone: string | null; waLink?: string | null }, orderNumber: number): string | null {
  if (!business.waPhone) return null;
  const code = sharedCodeFromLink(business.waLink);
  const text = code ? `Sipariş no ${orderNumber} hakkında #${code}` : `Sipariş #${orderNumber} hakkında`;
  return `https://wa.me/${digits(business.waPhone)}?text=${encodeURIComponent(text)}`;
}

/** Takip sayfası "bir dahaki siparişinizi WhatsApp'tan verin": ortak numarada dükkan kodlu bağlantı, kendi numarada wa.me. */
export function reorderWaHref(business: { waPhone: string | null; waLink?: string | null }): string | null {
  if (!business.waPhone) return null;
  return business.waLink ?? `https://wa.me/${digits(business.waPhone)}`;
}
