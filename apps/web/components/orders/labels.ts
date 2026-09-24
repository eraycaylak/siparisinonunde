// Sipariş ekranları için Türkçe mikro metinler ve küçük yardımcılar (04 §4, §14.3).

import {
  CANCEL_REASON_LABELS,
  MEAL_CARD_BRAND_LABELS,
  PAYMENT_METHOD_LABELS,
  REJECTION_REASON_LABELS,
  type CancelReason,
  type MealCardBrand,
  type OrderStatus,
  type PaymentMethod,
  type RejectionReason,
} from '@siparis/core/enums';
import { formatMoney } from '@/lib/format';

/** Ret sebep çipleri (04 §4.7) — sıra ekrandaki sıradır. */
export const REJECT_CHIPS: { value: RejectionReason; label: string }[] = [
  { value: 'closed', label: 'Kapalıyız' },
  { value: 'out_of_zone', label: 'Bölge dışı' },
  { value: 'item_unavailable', label: 'Ürün kalmadı' },
  { value: 'too_busy', label: 'Çok yoğunuz' },
  { value: 'duplicate', label: 'Mükerrer sipariş' },
  { value: 'suspected_fake', label: 'Şüpheli / sahte' },
  { value: 'other', label: 'Diğer' },
];

/** Onay sonrası iptal çipleri (04 §4.9). */
export const CANCEL_CHIPS: { value: CancelReason; label: string }[] = [
  { value: 'customer_request', label: 'Müşteri istedi' },
  { value: 'item_unavailable', label: 'Ürün kalmadı' },
  { value: 'courier_issue', label: 'Kurye sorunu' },
  { value: 'duplicate', label: 'Mükerrer sipariş' },
  { value: 'suspected_fake', label: 'Sahte / şüpheli' },
  { value: 'other', label: 'Diğer' },
];

/** Müşteriye gidecek ret metni önizlemesi (03 §9 M11 kısa sebep). */
export const REJECT_PREVIEW: Record<RejectionReason, string> = {
  closed: 'Siparişiniz alınamadı: işletme şu an kapalı.',
  out_of_zone: 'Siparişiniz alınamadı: adresiniz teslimat bölgesi dışında. Gel-al sipariş verebilirsiniz.',
  item_unavailable: 'Siparişiniz alınamadı: siparişinizdeki bir ürün tükendi.',
  too_busy: 'Siparişiniz alınamadı: yoğunluk nedeniyle şu an sipariş alınamıyor.',
  duplicate: 'Siparişiniz alınamadı: aynı sipariş daha önce alındı, diğer siparişiniz geçerli.',
  suspected_fake: 'Siparişiniz alınamadı. Ayrıntı için lütfen işletmeyi arayın.',
  other: 'Siparişiniz alınamadı: (yazdığınız açıklama)',
};

export const ETA_CHIPS = [15, 20, 30, 45, 60] as const;
export const DELAY_CHIPS = [10, 15, 20, 30] as const;

export function rejectLabel(reason: RejectionReason | null | undefined): string {
  return reason ? (REJECT_CHIPS.find((c) => c.value === reason)?.label ?? REJECTION_REASON_LABELS[reason]) : '';
}

export function cancelLabel(reason: CancelReason | null | undefined): string {
  return reason ? (CANCEL_CHIPS.find((c) => c.value === reason)?.label ?? CANCEL_REASON_LABELS[reason]) : '';
}

/** "Kapıda nakit", "Multinet", "Kasada" … */
export function paymentShort(method: PaymentMethod | string, brand?: MealCardBrand | string | null): string {
  if (method === 'meal_card_on_delivery' && brand) return MEAL_CARD_BRAND_LABELS[brand as MealCardBrand] ?? 'Yemek kartı';
  if (method === 'pay_at_counter') return 'Kasada';
  return PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? String(method);
}

/** Kuryede büyük harfle ödeme tipi: NAKİT / KART / MULTINET. */
export function paymentCourierLabel(method: string, brand?: string | null): string {
  if (method === 'cash_on_delivery') return 'NAKİT';
  if (method === 'card_on_delivery') return 'KAPIDA KART';
  if (method === 'meal_card_on_delivery') return (brand ? (MEAL_CARD_BRAND_LABELS[brand as MealCardBrand] ?? 'YEMEK KARTI') : 'YEMEK KARTI').toLocaleUpperCase('tr-TR');
  if (method === 'pay_at_counter') return 'KASADA';
  return 'ONLINE';
}

/** "500,00 TL'ye para üstü: 115,00 TL" */
export function changeText(totalKurus: number | undefined, changeForKurus: number | null | undefined): string | null {
  if (!changeForKurus || totalKurus == null || changeForKurus <= totalKurus) return null;
  return `${formatMoney(changeForKurus)}'ye para üstü: ${formatMoney(changeForKurus - totalKurus)}`;
}

/** Çıkarılacaklar ("Soğansız", "Acısız") büyük harf + kalın (04 §4.4). */
export function isRemoval(option: string): boolean {
  return /s[ıiuü]z$/iu.test(option.trim());
}

/** Olay geçmişi satır metni (P-05 zaman çizelgesi). */
export function eventLabel(e: { type: string; toStatus?: string | null; reason?: string | null; note?: string | null }): string {
  switch (e.type) {
    case 'created':
      return e.toStatus === 'awaiting_customer' ? 'Oluşturuldu · Müşteri onayı bekleniyor' : 'Oluşturuldu';
    case 'status_changed':
      return STATUS_EVENT_LABELS[(e.toStatus ?? '') as OrderStatus] ?? 'Durum değişti';
    case 'rejection_scheduled':
      return `Ret başlatıldı · ${rejectLabel(e.reason as RejectionReason)}`;
    case 'rejection_undone':
      return 'Ret geri alındı';
    case 'eta_updated':
      return 'Gecikme bildirildi';
    case 'courier_assigned':
      return 'Kurye atandı';
    case 'cancel_requested':
      return 'Müşteri iptal istedi';
    case 'cancel_request_rejected':
      return 'İptal talebi reddedildi';
    case 'printed':
      return e.reason === 'delivery' ? 'Paket fişi yazdırıldı' : 'Mutfak fişi yazdırıldı';
    case 'reviewed':
      return 'Müşteri değerlendirdi';
    case 'alarm_step':
      return 'Alarm adımı';
    default:
      return e.type;
  }
}

const STATUS_EVENT_LABELS: Partial<Record<OrderStatus, string>> = {
  new: 'Doğrulandı · Yeni',
  accepted: 'Onaylandı',
  preparing: 'Hazırlanıyor',
  ready: 'Hazır',
  on_the_way: 'Yola çıktı',
  delivered: 'Teslim edildi',
  rejected: 'Reddedildi',
  cancelled: 'İptal edildi',
};

/** Harita derin linkleri (04 §9.2): koordinat varsa koordinatla, yoksa adres metniyle arama. */
export function mapLinks(input: { lat?: number | null; lng?: number | null; address: string }): { google: string; yandex: string; apple: string } {
  const q = encodeURIComponent(input.address);
  if (input.lat != null && input.lng != null) {
    const ll = `${input.lat},${input.lng}`;
    return {
      google: `https://www.google.com/maps/search/?api=1&query=${ll}`,
      yandex: `https://yandex.com.tr/harita/?pt=${input.lng},${input.lat}&z=17&l=map`,
      apple: `https://maps.apple.com/?ll=${ll}&q=${q}`,
    };
  }
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${q}`,
    yandex: `https://yandex.com.tr/harita/?text=${q}`,
    apple: `https://maps.apple.com/?q=${q}`,
  };
}

/** Telefon bağlantısı (tel:+90…). */
export function telHref(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
