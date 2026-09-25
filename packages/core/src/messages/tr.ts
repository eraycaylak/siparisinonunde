// Müşteri mesaj metinleri (03 §9, M-kodları), şablon adları ve kısa sebep metinleri (02 §5.2).
// Kural: değişkene ek getirilmez; adres/telefon durum mesajlarında tekrar edilmez; promosyon yok.
// Not: 03'teki metinlerde geçen emojiler proje kuralı gereği çıkarıldı (anlam metinle verilir).

import type {
  CancelReason,
  CancelledBy,
  FulfillmentType,
  MealCardBrand,
  OrderStatus,
  PaymentMethod,
  RejectionReason,
} from '../enums';
import { MEAL_CARD_BRAND_LABELS, PAYMENT_METHOD_LABELS } from '../enums';
import { formatTL } from '../money';

// ---------------------------------------------------------------------------
// Ortak tipler ve biçimleyiciler

export interface WaButton {
  id: string;
  /** ≤ 20 karakter */
  title: string;
}

/** Giden mesaj taslağı: gövde + (reply butonları | CTA URL). */
export interface WaDraft {
  code: string;
  body: string;
  buttons?: WaButton[];
  cta?: { label: string; url: string };
  footer?: string;
}

/** Buton başlıkları (≤ 20 karakter; 03 §9.1). */
export const BUTTON_TITLES = {
  menu: 'Menüyü aç',
  order: 'Sipariş ver',
  browseMenu: 'Menüye göz at',
  track: 'Siparişi takip et',
  human: 'Yetkiliyle görüş',
  pickupOrder: 'Gel-al sipariş ver',
  wait: 'Beklerim',
  cancelOrder: 'Siparişi iptal et',
  giveUp: 'Vazgeçtim',
  reviewGood: 'Harika',
  reviewOk: 'İdare eder',
  reviewBad: 'Beğenmedim',
  stopAll: 'Evet, hepsini durdur',
  no: 'Hayır',
  confirm: 'Onayla',
  edit: 'Düzenle',
  cancel: 'İptal',
  review: 'Değerlendir',
} as const;

/** Buton kimlikleri (14 §8). */
export const BUTTON_IDS = {
  menu: 'menu',
  human: 'human',
  review: (orderId: string, rating: 'good' | 'ok' | 'bad') => `review:${orderId}:${rating}`,
  wait: (orderId: string) => `wait:${orderId}`,
  cancel: (orderId: string) => `cancel:${orderId}`,
  keep: (orderId: string) => `keep:${orderId}`,
  orderConfirm: (orderId: string) => `order:${orderId}:confirm`,
  orderEdit: (orderId: string) => `order:${orderId}:edit`,
  orderCancel: (orderId: string) => `order:${orderId}:cancel`,
  stopAll: 'optout:all',
  stopNo: 'optout:no',
} as const;

/** Sipariş numarası gösterimi: 1047 → "#1047". */
export function formatOrderNo(n: number | string): string {
  return `#${n}`;
}

/** Selamlamada kullanılabilir ad mı (emoji/takma ad değilse). */
export function greetingName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().split(/\s+/)[0] ?? '';
  if (n.length < 2 || n.length > 20) return null;
  if (!/^[\p{L}][\p{L}'’-]*$/u.test(n)) return null;
  return n;
}

export interface MessageItem {
  name: string;
  quantity: number;
  options?: string[];
}

/** {kalemler}: "• 2× Lahmacun (acılı)" satırları, en fazla `max` satır. */
export function formatItemsList(items: readonly MessageItem[], max = 5): string {
  const shown = items.slice(0, max).map((i) => {
    const opts = i.options?.length ? ` (${i.options.map((o) => o.toLocaleLowerCase('tr-TR')).join(', ')})` : '';
    return `• ${i.quantity}× ${i.name}${opts}`;
  });
  if (items.length > max) shown.push(`… ve ${items.length - max} ürün daha`);
  return shown.join('\n');
}

/** {odeme}: ödeme yöntemi etiketi (yemek kartında marka). */
export function paymentText(method: PaymentMethod, mealCardBrand?: MealCardBrand | null): string {
  if (method === 'meal_card_on_delivery' && mealCardBrand) {
    return `${PAYMENT_METHOD_LABELS[method]} · ${MEAL_CARD_BRAND_LABELS[mealCardBrand]}`;
  }
  return PAYMENT_METHOD_LABELS[method];
}

/** {odeme_detay} (M09): para üstü, POS, yemek kartı markası. */
export function paymentDetailText(p: {
  method: PaymentMethod;
  totalKurus?: number;
  changeForKurus?: number | null;
  mealCardBrand?: MealCardBrand | null;
}): string {
  switch (p.method) {
    case 'cash_on_delivery':
      if (p.changeForKurus && p.totalKurus != null && p.changeForKurus > p.totalKurus) {
        return `Kapıda nakit · ${formatTL(p.changeForKurus)}'ye para üstü hazırlandı`;
      }
      return 'Kapıda nakit';
    case 'card_on_delivery':
      return 'Kapıda kart, kuryemiz POS cihazı getirecek';
    case 'meal_card_on_delivery':
      return p.mealCardBrand ? `Kapıda yemek kartı · ${MEAL_CARD_BRAND_LABELS[p.mealCardBrand]}` : 'Kapıda yemek kartı';
    case 'online_card':
      return 'Online ödendi';
    case 'pay_at_counter':
      return 'Kasada ödeme';
  }
}

// ---------------------------------------------------------------------------
// Kısa sebep metinleri (02 §5.2) — şablon {{2}}, takip sayfası ve SMS-03a/b

export const REJECTION_REASON_SHORT_TEXTS: Record<Exclude<RejectionReason, 'other'>, string> = {
  closed: 'işletme şu an kapalı',
  out_of_zone: 'adresiniz teslimat bölgesi dışında',
  item_unavailable: 'siparişinizdeki bir ürün tükendi',
  too_busy: 'yoğunluk nedeniyle şu an sipariş alınamıyor',
  duplicate: 'aynı sipariş daha önce alındı, diğer siparişiniz geçerli',
  suspected_fake: 'ayrıntı için lütfen işletmeyi arayın',
};

export const CANCEL_REASON_SHORT_TEXTS: Record<Exclude<CancelReason, 'other' | 'tenant_no_response'>, string> = {
  customer_request: 'isteğiniz üzerine',
  customer_timeout: 'sipariş onayınız süresi içinde gelmedi',
  item_unavailable: 'siparişinizdeki bir ürün tükendi',
  courier_issue: 'teslimat şu an yapılamıyor',
  duplicate: 'aynı siparişin tekrarı, diğer siparişiniz geçerli',
  suspected_fake: 'ayrıntı için lütfen işletmeyi arayın',
  payment_timeout: 'online ödeme süresi içinde tamamlanmadı',
};

/** Ret sebebinin kısa metni; 'other' için işletme notu. */
export function rejectionReasonText(reason: RejectionReason, note?: string | null): string {
  if (reason === 'other') return (note ?? '').trim() || 'işletme notu';
  return REJECTION_REASON_SHORT_TEXTS[reason];
}

/** İptal sebebinin kısa metni; 'other' için işletme notu. */
export function cancelReasonText(reason: CancelReason, note?: string | null): string {
  if (reason === 'other') return (note ?? '').trim() || 'işletme notu';
  if (reason === 'tenant_no_response') return 'işletme zamanında onaylayamadı';
  return CANCEL_REASON_SHORT_TEXTS[reason];
}

// ---------------------------------------------------------------------------
// Takip sayfası etiketleri (03 §3.0)

export function trackingStatusLabel(
  status: OrderStatus,
  ctx: { fulfillmentType?: FulfillmentType; etaClock?: string | null; courierName?: string | null; reasonText?: string | null; smsMode?: boolean } = {},
): string {
  switch (status) {
    case 'awaiting_customer':
      return ctx.smsMode ? 'SMS kodunu girin' : 'WhatsApp onayınız bekleniyor';
    case 'new':
      return 'Siparişiniz alındı · İşletme onayı bekleniyor';
    case 'accepted':
      return ctx.etaClock ? `Onaylandı · Tahmini ${ctx.etaClock}` : 'Onaylandı';
    case 'preparing':
      return 'Hazırlanıyor';
    case 'ready':
      return ctx.fulfillmentType === 'pickup' ? 'Hazır · Gelip alabilirsiniz' : 'Hazır · Kurye bekleniyor';
    case 'on_the_way':
      return ctx.courierName ? `Yolda · Kurye: ${ctx.courierName}` : 'Yolda';
    case 'delivered':
      return 'Teslim edildi · Afiyet olsun';
    case 'rejected':
      return ctx.reasonText ? `Sipariş alınamadı · ${ctx.reasonText}` : 'Sipariş alınamadı';
    case 'cancelled':
      return ctx.reasonText ? `İptal edildi · ${ctx.reasonText}` : 'İptal edildi';
  }
}

// ---------------------------------------------------------------------------
// Uzun mesajlar (03 §9.2)

export interface WelcomeVars {
  ad?: string | null;
  isletme: string;
  kapanis?: string | null;
  etaAralik?: string | null;
  minSepet?: string | null;
  pickupOnly?: boolean;
  pickupMinutes?: number | null;
  busy?: boolean;
  /** İlk temasta ve metin sürümü değişince verilir. */
  aydinlatmaLink?: string | null;
  menuUrl: string;
}

/** M01 · İlk karşılama (CTA: Menüyü aç). */
export function m01Welcome(v: WelcomeVars): WaDraft {
  const ad = greetingName(v.ad);
  const lines = [
    ad ? `Merhaba ${ad}, ${v.isletme} WhatsApp sipariş hattına hoş geldiniz!` : `Merhaba, ${v.isletme} WhatsApp sipariş hattına hoş geldiniz!`,
    'Menümüzü açıp birkaç dokunuşla sipariş verebilirsiniz. Adresiniz ve ödeme tercihiniz bir sonraki siparişiniz için hatırlanır.',
  ];
  if (v.kapanis) lines.push(`Bugün açığız · Kapanış ${v.kapanis}`);
  if (v.pickupOnly) {
    lines.push(`Gel-al: siparişiniz yaklaşık ${v.pickupMinutes ?? 20} dakikada hazır.`);
  } else if (v.busy && v.etaAralik) {
    lines.push(`Şu an yoğunuz, tahmini teslimat ${v.etaAralik}.`);
  } else if (v.etaAralik) {
    lines.push(v.minSepet ? `Tahmini teslimat ${v.etaAralik} · Minimum sepet ${v.minSepet}` : `Tahmini teslimat ${v.etaAralik}`);
  }
  lines.push('Bir yetkiliyle görüşmek isterseniz "yetkili" yazmanız yeterli.');
  if (v.aydinlatmaLink) {
    lines.push('', `Kişisel verileriniz siparişinizi almak ve teslim etmek amacıyla ${v.isletme} tarafından işlenir. Ayrıntı: ${v.aydinlatmaLink}`);
  }
  return { code: 'M01', body: lines.join('\n'), cta: { label: BUTTON_TITLES.menu, url: v.menuUrl } };
}

/** M02 · Tekrar gelen müşteri (CTA: Sipariş ver). Eski tutar yazılmaz. */
export function m02Returning(v: {
  ad?: string | null;
  sonTarih: string;
  sonKalemler: string;
  kapanis?: string | null;
  etaAralik?: string | null;
  menuUrl: string;
}): WaDraft {
  const ad = greetingName(v.ad);
  const lines = [
    ad ? `Tekrar hoş geldiniz ${ad}.` : 'Tekrar hoş geldiniz.',
    `Son siparişiniz (${v.sonTarih}): ${v.sonKalemler}`,
    'Aynısını tek dokunuşla tekrarlayabilir ya da menüden yeni seçim yapabilirsiniz.',
  ];
  const info = [v.kapanis ? `Bugün açığız · Kapanış ${v.kapanis}` : null, v.etaAralik].filter(Boolean).join(' · ');
  if (info) lines.push(info);
  return { code: 'M02', body: lines.join('\n'), cta: { label: BUTTON_TITLES.order, url: v.menuUrl } };
}

export interface OrderMsgVars {
  no: string;
  kalemler: string;
  toplam: string;
  odeme: string;
  trackingUrl: string;
}

/** M05 · Sipariş alındı. */
export function m05Received(v: OrderMsgVars & { isletme: string }): WaDraft {
  return {
    code: 'M05',
    body: [
      `Siparişiniz alındı! Sipariş no: ${v.no}`,
      v.kalemler,
      `Toplam: ${v.toplam} · Ödeme: ${v.odeme}`,
      `${v.isletme} siparişinizi onayladığında buradan haber vereceğiz.`,
    ].join('\n'),
    cta: { label: BUTTON_TITLES.track, url: v.trackingUrl },
  };
}

/** M06a · Onaylandı (paket). */
export function m06AcceptedDelivery(v: { saat: string; dk: number; no: string; trackingUrl: string }): WaDraft {
  return {
    code: 'M06a',
    body: [`Siparişiniz onaylandı!`, `Tahmini teslim saati: ${v.saat} (yaklaşık ${v.dk} dk)`, `Sipariş no: ${v.no}`].join('\n'),
    cta: { label: BUTTON_TITLES.track, url: v.trackingUrl },
  };
}

/** M06b · Onaylandı (gel-al). */
export function m06AcceptedPickup(v: { saat: string; subeAdresKisa: string; no: string; trackingUrl: string }): WaDraft {
  return {
    code: 'M06b',
    body: [`Siparişiniz onaylandı! Tahminen ${v.saat} civarında hazır olacak.`, `Adresimiz: ${v.subeAdresKisa}`, `Sipariş no: ${v.no}`].join('\n'),
    cta: { label: BUTTON_TITLES.track, url: v.trackingUrl },
  };
}

/** M06c · Alındı + onaylandı birleşik (yalnız Akış A, 60 sn içinde onay). */
export function m06AcceptedCombined(v: OrderMsgVars & { saat: string; dk: number; pickup?: boolean }): WaDraft {
  return {
    code: 'M06c',
    body: [
      `Siparişiniz alındı ve onaylandı! Sipariş no: ${v.no}`,
      v.kalemler,
      `Toplam: ${v.toplam} · Ödeme: ${v.odeme}`,
      v.pickup ? `Tahminen ${v.saat} civarında hazır olacak.` : `Tahmini teslim saati: ${v.saat} (yaklaşık ${v.dk} dk)`,
    ].join('\n'),
    cta: { label: BUTTON_TITLES.track, url: v.trackingUrl },
  };
}

/** M07 · Hazırlanıyor (varsayılan kapalı). */
export function m07Preparing(v: { no: string }): WaDraft {
  return { code: 'M07', body: `Siparişiniz hazırlanıyor. Sipariş no: ${v.no}` };
}

/** M08 · Hazır (gel-al). */
export function m08ReadyPickup(v: { no: string; odeme: string; subeAdresKisa: string }): WaDraft {
  return {
    code: 'M08',
    body: [
      `Siparişiniz hazır! Kasada sipariş numaranızı (${v.no}) söylemeniz yeterli.`,
      `Ödeme: ${v.odeme}`,
      `Adresimiz: ${v.subeAdresKisa}`,
    ].join('\n'),
  };
}

/** M09 · Yolda. Kurye atanmamışsa ad yazılmaz. */
export function m09OnTheWay(v: { kurye?: string | null; dk: number; odemeDetay: string; no: string; trackingUrl: string }): WaDraft {
  const first = v.kurye?.trim().split(/\s+/)[0];
  return {
    code: 'M09',
    body: [
      first
        ? `Siparişiniz yola çıktı! Kuryemiz ${first} yaklaşık ${v.dk} dk içinde kapınızda olacak.`
        : `Siparişiniz yola çıktı! Yaklaşık ${v.dk} dk içinde kapınızda olacak.`,
      `Ödeme: ${v.odemeDetay}`,
      `Sipariş no: ${v.no}`,
    ].join('\n'),
    cta: { label: BUTTON_TITLES.track, url: v.trackingUrl },
  };
}

/** M10 · Teslim edildi + değerlendirme (3 buton). */
export function m10Delivered(v: { orderId: string }): WaDraft {
  return {
    code: 'M10',
    body: ['Afiyet olsun! Siparişiniz teslim edildi.', 'Bizi tercih ettiğiniz için teşekkürler. Deneyiminizi nasıl buldunuz?'].join('\n'),
    buttons: [
      { id: BUTTON_IDS.review(v.orderId, 'good'), title: BUTTON_TITLES.reviewGood },
      { id: BUTTON_IDS.review(v.orderId, 'ok'), title: BUTTON_TITLES.reviewOk },
      { id: BUTTON_IDS.review(v.orderId, 'bad'), title: BUTTON_TITLES.reviewBad },
    ],
  };
}

export function m10aReviewGood(): WaDraft {
  return { code: 'M10a', body: 'Çok sevindik, teşekkür ederiz!' };
}
export function m10dReviewOk(): WaDraft {
  return { code: 'M10d', body: 'Teşekkür ederiz! Bir dahaki siparişinizde daha iyisini yapmak için çalışacağız.' };
}
/** M10b · "Beğenmedim" (liste satırları sabit). */
export const M10B_REASONS = [
  { id: 'late', title: 'Geç geldi' },
  { id: 'cold', title: 'Soğuk geldi' },
  { id: 'missing_wrong_item', title: 'Eksik/yanlış ürün' },
  { id: 'taste', title: 'Lezzet' },
  { id: 'courier', title: 'Kurye' },
  { id: 'other', title: 'Diğer' },
] as const;
export function m10bReviewBad(): WaDraft {
  return { code: 'M10b', body: 'Üzgünüz. Ne ters gitti? Bildiriminiz doğrudan işletme sahibine iletilecek.' };
}
export function m10cReviewThanks(v: { isletme: string; other?: boolean }): WaDraft {
  return {
    code: 'M10c',
    body: v.other
      ? 'Teşekkürler. İsterseniz yaşadığınız sorunu kısaca yazabilirsiniz, doğrudan işletmeye iletilecek.'
      : `Teşekkürler, iletildi. ${v.isletme} size buradan dönüş yapabilir.`,
  };
}

export interface RejectVars {
  no: string;
  reason: RejectionReason;
  acilis?: string | null;
  urun?: string | null;
  digerNo?: string | null;
  subeTel?: string | null;
  isletmeNotu?: string | null;
  pickupAvailable?: boolean;
  menuUrl?: string | null;
  otherTrackingUrl?: string | null;
}

/** M11 · Reddedildi — sebep satırı ve sebebe göre buton. */
export function m11Rejected(v: RejectVars): WaDraft {
  let line: string;
  let cta: WaDraft['cta'];
  switch (v.reason) {
    case 'closed':
      line = v.acilis ? `İşletmemiz şu an kapalı. ${v.acilis} itibarıyla yeniden bekleriz.` : 'İşletmemiz şu an kapalı.';
      break;
    case 'out_of_zone':
      line = v.pickupAvailable
        ? 'Adresiniz teslimat bölgemizin dışında kalıyor. İsterseniz gel-al ile sipariş verebilirsiniz.'
        : 'Adresiniz teslimat bölgemizin dışında kalıyor.';
      if (v.pickupAvailable && v.menuUrl) cta = { label: BUTTON_TITLES.pickupOrder, url: v.menuUrl };
      break;
    case 'item_unavailable':
      line = v.urun
        ? `Siparişinizdeki ${v.urun} maalesef tükendi. Menüden farklı bir seçim yapabilirsiniz.`
        : 'Siparişinizdeki bir ürün maalesef tükendi. Menüden farklı bir seçim yapabilirsiniz.';
      if (v.menuUrl) cta = { label: BUTTON_TITLES.menu, url: v.menuUrl };
      break;
    case 'too_busy':
      line = 'Şu an yoğunluk nedeniyle sipariş alamıyoruz. Biraz sonra tekrar deneyebilirsiniz.';
      break;
    case 'duplicate':
      line = v.digerNo
        ? `Bu sipariş, az önce verdiğiniz ${v.digerNo} numaralı siparişin tekrarı olduğu için alınmadı. Diğer siparişiniz geçerlidir.`
        : 'Bu sipariş, az önce verdiğiniz siparişin tekrarı olduğu için alınmadı. Diğer siparişiniz geçerlidir.';
      if (v.otherTrackingUrl) cta = { label: BUTTON_TITLES.track, url: v.otherTrackingUrl };
      break;
    case 'suspected_fake':
      line = v.subeTel ? `Ayrıntı için lütfen işletmeyi arayın: ${v.subeTel}` : 'Ayrıntı için lütfen işletmeyi arayın.';
      break;
    case 'other':
      line = (v.isletmeNotu ?? '').trim();
      break;
  }
  return {
    code: 'M11',
    body: [`Üzgünüz, ${v.no} numaralı siparişinizi şu an alamıyoruz.`, line].filter(Boolean).join('\n'),
    cta,
  };
}

export interface CancelVars {
  no: string;
  isletme: string;
  reason: CancelReason;
  cancelledBy: CancelledBy;
  note?: string | null;
  digerNo?: string | null;
  subeTel?: string | null;
  menuUrl?: string | null;
}

/** M12 · İptal (varyant a–g, 03 §9.2). */
export function m12Cancelled(v: CancelVars): WaDraft {
  const tel = v.subeTel ?? '';
  switch (v.reason) {
    case 'customer_request':
      return { code: 'M12b', body: `${v.no} numaralı siparişiniz isteğiniz üzerine iptal edildi.` };
    case 'customer_timeout':
      return {
        code: 'M12c',
        body: 'Siparişiniz onaylanmadığı için iptal edildi. Yeniden sipariş vermek isterseniz menümüz burada.',
        cta: v.menuUrl ? { label: BUTTON_TITLES.menu, url: v.menuUrl } : undefined,
      };
    case 'tenant_no_response':
      return {
        code: 'M12d',
        body: `Üzgünüz, ${v.no} numaralı siparişiniz işletme tarafından zamanında onaylanamadığı için iptal edildi. Sizi beklettiğimiz için özür dileriz.${tel ? ` Siparişinizi telefonla vermek isterseniz: ${tel}` : ''}`,
      };
    case 'duplicate':
      return {
        code: 'M12e',
        body: `${v.no} numaralı sipariş, aynı siparişin tekrarı olduğu için iptal edildi.${v.digerNo ? ` Diğer siparişiniz (${v.digerNo}) geçerlidir.` : ''}`,
      };
    case 'suspected_fake':
      return {
        code: 'M12f',
        body: `${v.no} numaralı siparişiniz iptal edildi.${tel ? ` Bilgi için lütfen işletmeyi arayın: ${tel}` : ''}`,
      };
    case 'payment_timeout':
      return {
        code: 'M12g',
        body: `${v.no} numaralı siparişinizin online ödemesi süresi içinde tamamlanmadığı için sipariş iptal edildi. Kartınızdan para çekilmedi. Yeniden sipariş vermek isterseniz menümüz burada.`,
        cta: v.menuUrl ? { label: BUTTON_TITLES.menu, url: v.menuUrl } : undefined,
      };
    default: {
      // item_unavailable, courier_issue, other → işletme iptali (a)
      const sebep = cancelReasonText(v.reason, v.note);
      return {
        code: 'M12a',
        body: `${v.no} numaralı siparişiniz ${v.isletme} tarafından iptal edildi. Sebep: ${sebep}. Özür dileriz. Sorunuz varsa buraya yazabilirsiniz.`,
      };
    }
  }
}

/** M13 · Onay gecikmesi (t=10 dk; bütçe dışı). */
export function m13ApprovalDelay(v: { no: string; kalanDk: number; takipLink: string; orderId: string }): WaDraft {
  return {
    code: 'M13',
    body: [
      `${v.no} numaralı siparişiniz henüz onaylanmadı, işletme şu an yoğun olabilir.`,
      `${v.kalanDk} dakika içinde onaylanmazsa siparişiniz otomatik olarak iptal edilecek ve size buradan haber vereceğiz.`,
      `Beklemek ister misiniz? Takip: ${v.takipLink}`,
    ].join('\n'),
    buttons: [
      { id: BUTTON_IDS.wait(v.orderId), title: BUTTON_TITLES.wait },
      { id: BUTTON_IDS.cancel(v.orderId), title: BUTTON_TITLES.cancelOrder },
    ],
  };
}

// ---------------------------------------------------------------------------
// Kısa mesajlar (03 §9.3)

export function m01kShortWelcome(v: { menuUrl: string }): WaDraft {
  return { code: 'M01K', body: 'Tekrar merhaba. Sipariş vermek için menümüzü açabilirsiniz.', cta: { label: BUTTON_TITLES.menu, url: v.menuUrl } };
}

export function m03Closed(v: { isletme: string; acilis?: string | null; menuUrl: string }): WaDraft {
  return {
    code: 'M03',
    body: [
      v.acilis
        ? `Merhaba, ${v.isletme} şu an kapalı. ${v.acilis} itibarıyla yeniden sipariş alacağız.`
        : `Merhaba, ${v.isletme} şu an kapalı.`,
      'Bu arada menümüze göz atabilirsiniz.',
    ].join('\n'),
    cta: { label: BUTTON_TITLES.browseMenu, url: v.menuUrl },
  };
}

export function m04Paused(v: { devamSaati?: string | null; menuUrl: string }): WaDraft {
  return {
    code: 'M04',
    body: [
      'Merhaba, yoğunluk nedeniyle kısa bir süre yeni sipariş alamıyoruz.',
      v.devamSaati ? `Tahminen ${v.devamSaati} itibarıyla yeniden sipariş alacağız.` : 'Biraz sonra tekrar deneyebilirsiniz.',
      'Anlayışınız için teşekkür ederiz.',
    ].join('\n'),
    cta: { label: BUTTON_TITLES.browseMenu, url: v.menuUrl },
  };
}

export function m13aWaiting(): WaDraft {
  return { code: 'M13a', body: 'Teşekkürler, işletmeye hatırlattık. Onaylandığında buradan haber vereceğiz.' };
}

export function m17bCodeNotFound(v: { menuUrl: string }): WaDraft {
  return {
    code: 'M17b',
    body: 'Bu kodla bekleyen bir sipariş bulamadık. Kodu kontrol edebilir ya da menüden yeniden sipariş verebilirsiniz.',
    cta: { label: BUTTON_TITLES.menu, url: v.menuUrl },
  };
}

export function m17cCodeExpired(v: { menuUrl: string }): WaDraft {
  return {
    code: 'M17c',
    body: 'Bu sipariş kodunun süresi dolmuş ve sipariş iptal edildi. Yeniden sipariş vermek için menüyü açabilirsiniz.',
    cta: { label: BUTTON_TITLES.menu, url: v.menuUrl },
  };
}

export function m17dCodeAlreadyUsed(v: { trackingUrl: string }): WaDraft {
  return {
    code: 'M17d',
    body: 'Bu sipariş zaten onaylandı. Durumunu buradan takip edebilirsiniz.',
    cta: { label: BUTTON_TITLES.track, url: v.trackingUrl },
  };
}

export function m20Handoff(v: { inHours: boolean; acilis?: string | null }): WaDraft {
  return {
    code: 'M20',
    body: v.inHours
      ? 'Sizi yetkilimize aktardık. Birazdan buradan yanıt verecek.'
      : `Şu an ekibimiz yanıt veremiyor. Mesajınızı aldık${v.acilis ? `, ${v.acilis} itibarıyla dönüş yapacağız.` : ', en kısa sürede dönüş yapacağız.'}`,
  };
}

/** M26 · Açık siparişte durum kartı (15 dk'da 1). */
export function m26StatusCard(v: { no: string; durumEtiketi: string; saat?: string | null; trackingUrl: string }): WaDraft {
  return {
    code: 'M26',
    body: [
      `${v.no} numaralı siparişinizin durumu: ${v.durumEtiketi}${v.saat ? ` · Tahmini ${v.saat}` : ''}`,
      'Mesajınızı işletmeye de ilettik. Bir yetkiliyle görüşmek isterseniz "yetkili" yazın.',
    ].join('\n'),
    cta: { label: BUTTON_TITLES.track, url: v.trackingUrl },
  };
}

export function m27aCancelConfirm(v: { no: string; orderId: string }): WaDraft {
  return {
    code: 'M27a',
    body: `${v.no} numaralı siparişinizi iptal etmek istiyor musunuz?`,
    buttons: [
      { id: BUTTON_IDS.cancel(v.orderId), title: BUTTON_TITLES.cancelOrder },
      { id: BUTTON_IDS.keep(v.orderId), title: BUTTON_TITLES.giveUp },
    ],
  };
}

export function m27bCancelRequested(): WaDraft {
  return {
    code: 'M27b',
    body: 'Siparişiniz onaylandığı için iptal talebinizi işletmeye ilettik. İşletme onaylarsa siparişiniz iptal edilir ve size buradan haber veririz.',
  };
}

export function m28aHours(v: { bugunAcilis: string; kapanis: string; bilgiLink: string; menuUrl: string }): WaDraft {
  return {
    code: 'M28a',
    body: `Bugün ${v.bugunAcilis}–${v.kapanis} arası açığız. Tüm çalışma saatlerimiz: ${v.bilgiLink}`,
    cta: { label: BUTTON_TITLES.menu, url: v.menuUrl },
  };
}

export function m28bAddress(v: { subeAdres: string; haritaLink: string; menuUrl: string }): WaDraft {
  return {
    code: 'M28b',
    body: `Adresimiz: ${v.subeAdres}. Haritada görmek için: ${v.haritaLink}`,
    cta: { label: BUTTON_TITLES.menu, url: v.menuUrl },
  };
}

export function m28cZones(v: { ucretAralik: string; minAralik: string; menuUrl: string }): WaDraft {
  return {
    code: 'M28c',
    body: `Teslimat ücreti ${v.ucretAralik}, minimum sepet ${v.minAralik}. Adresinize teslimat yapıp yapmadığımızı menüde adresinizi girerek hemen görebilirsiniz.`,
    cta: { label: BUTTON_TITLES.menu, url: v.menuUrl },
  };
}

export function m28dPayments(v: { odemeListesi: string; menuUrl: string }): WaDraft {
  return {
    code: 'M28d',
    body: `Kapıda şu yöntemlerle ödeyebilirsiniz: ${v.odemeListesi}.`,
    cta: { label: BUTTON_TITLES.menu, url: v.menuUrl },
  };
}

export function m29Voice(v: { menuUrl: string }): WaDraft {
  return {
    code: 'M29',
    body: 'Sesli mesajınızı işletmeye ilettik. Hızlı sipariş için menümüzü açabilirsiniz.',
    cta: { label: BUTTON_TITLES.menu, url: v.menuUrl },
  };
}

export function m30Unsupported(): WaDraft {
  return { code: 'M30', body: 'Bu içeriği okuyamadık, lütfen yazarak iletin.' };
}

export function m31OptOut(): WaDraft {
  return {
    code: 'M31',
    body: 'Kampanya mesajlarını durdurduk. Sipariş durum bildirimlerini de kapatalım mı?',
    buttons: [
      { id: BUTTON_IDS.stopAll, title: BUTTON_TITLES.stopAll },
      { id: BUTTON_IDS.stopNo, title: BUTTON_TITLES.no },
    ],
  };
}

export function m31aOptOutAll(): WaDraft {
  return {
    code: 'M31a',
    body: 'Tamam, size bundan sonra otomatik mesaj göndermeyeceğiz. İstediğiniz zaman BAŞLAT yazarak yeniden açabilirsiniz.',
  };
}

export function m31bOptOutMarketingOnly(): WaDraft {
  return { code: 'M31b', body: 'Tamam, kampanya mesajı almayacaksınız. Sipariş bildirimleriniz gelmeye devam edecek.' };
}

export function m32OptIn(): WaDraft {
  return { code: 'M32', body: 'Sipariş bildirimlerini yeniden açtık. Kampanya mesajları kapalı kalmaya devam ediyor.' };
}

export function m33Unavailable(v: { subeTel?: string | null }): WaDraft {
  return {
    code: 'M33',
    body: v.subeTel
      ? `Merhaba, şu an WhatsApp üzerinden online sipariş alamıyoruz. Sipariş için lütfen bizi arayın: ${v.subeTel}`
      : 'Merhaba, şu an WhatsApp üzerinden online sipariş alamıyoruz. Sipariş için lütfen bizi arayın.',
  };
}

/** M34 · Gecikme bildirimi (≤ 2, bütçe dışı). */
export function m34Delay(v: { no: string; ekDk: number; saat: string; trackingUrl: string }): WaDraft {
  return {
    code: 'M34',
    body: `${v.no} numaralı siparişiniz yaklaşık ${v.ekDk} dk gecikecek. Yeni tahmini teslim saati: ${v.saat}. Anlayışınız için teşekkür ederiz.`,
    cta: { label: BUTTON_TITLES.track, url: v.trackingUrl },
  };
}

/** Akış B: müşterinin gönderdiği hazır metin (wa.me linki). */
export function orderCodePrefillText(code: string): string {
  return `Sipariş kodu: ${code}`;
}

/** Sipariş kodu kalıbı (6 karakter, karışmayan alfabe). */
export const ORDER_CODE_PATTERN = /\b([A-HJ-NP-Z2-9]{6})\b/;

// ---------------------------------------------------------------------------
// SMS metinleri (03 §9.5)

export function sms01Otp(v: { isletme: string; kod: string; slug?: string | null; domain?: string }): string {
  const base = `${v.isletme} sipariş doğrulama kodunuz: ${v.kod}. 5 dakika geçerlidir, kimseyle paylaşmayın.`;
  if (!v.slug) return base;
  return `${base}\n@${v.slug}.${v.domain ?? 'siparisinonunde.com'} #${v.kod}`;
}

export function sms02Accepted(v: { isletme: string; no: string; saat: string; takipLink: string }): string {
  return `${v.isletme}: ${v.no} numaralı siparişiniz onaylandı. Tahmini teslim ${v.saat}. Takip: ${v.takipLink}`;
}

export function sms03aRejected(v: { isletme: string; no: string; sebep: string; subeTel: string }): string {
  return `${v.isletme}: ${v.no} numaralı siparişiniz alınamadı. Sebep: ${v.sebep}. Bilgi: ${v.subeTel}`;
}

export function sms03bCancelled(v: { isletme: string; no: string; sebep: string; subeTel: string; reason?: CancelReason }): string {
  if (v.reason === 'tenant_no_response') {
    return `${v.isletme}: ${v.no} numaralı siparişiniz zamanında onaylanamadığı için iptal edildi, özür dileriz. Telefonla sipariş için: ${v.subeTel}`;
  }
  return `${v.isletme}: ${v.no} numaralı siparişiniz iptal edildi. Sebep: ${v.sebep}. Bilgi: ${v.subeTel}`;
}

// ---------------------------------------------------------------------------
// Pencere dışı utility şablonları (02 §5.2; gövdeler Meta'da, burada ad + parametre sırası)

export const CUSTOMER_TEMPLATES = {
  siparis_alindi_v1: { params: ['musteriAdi', 'isletme', 'no', 'tutar'], button: 'track' },
  siparis_onaylandi_v1: { params: ['isletme', 'dk', 'no'], button: 'track' },
  siparis_hazir_v1: { params: ['isletme', 'no', 'subeAdres'], button: 'track' },
  siparis_yolda_v1: { params: ['isletme', 'dk', 'no', 'odeme'], button: 'track' },
  siparis_teslim_v1: { params: ['isletme', 'no'], button: 'review' },
  siparis_reddedildi_v1: { params: ['isletme', 'sebep', 'no'], button: null },
  siparis_iptal_v1: { params: ['no', 'sebep', 'isletme'], button: null },
  siparis_iptal_yanitsiz_v1: { params: ['no', 'isletme', 'subeTel'], button: null },
  yanit_bekliyor_v1: { params: ['musteriAdi', 'isletme'], button: 'quick_reply' },
} as const;
export type CustomerTemplateName = keyof typeof CUSTOMER_TEMPLATES;

/** Platform WABA şablonları (02 §5.3). */
export const PLATFORM_TEMPLATES = {
  isletme_yeni_siparis_v1: { params: ['isletme', 'no', 'beklemeDk', 'tutar'] },
  isletme_panel_cevrimdisi_v1: { params: ['sube', 'dk'] },
  kurye_giris_v1: { params: ['isletme'] },
  isletme_baglanti_sorunu_v1: { params: ['isletme', 'sorun'] },
  isletme_meta_odeme_v1: { params: ['isletme'] },
  isletme_kalite_uyari_v1: { params: ['isletme', 'kalite'] },
} as const;
export type PlatformTemplateName = keyof typeof PLATFORM_TEMPLATES;

// ---------------------------------------------------------------------------
// İşletmeye giden panel dışı uyarılar (00 §10 alarm zinciri, 06 §7.7)

/**
 * Yeni sipariş Web Push bildirimi (00 §10 t=0, 04 §4.5): müşteri adı/telefonu/adresi yok. Mutfak fiyat görmez
 * (00 §4): `totalKurus` null verilirse tutar yazılmaz. Kurulum testinde numara "TEST #…" olur.
 */
export function newOrderPushText(v: { number: number | string; itemCount: number; totalKurus: number | null; test?: boolean }): {
  title: string;
  body: string;
} {
  const no = v.test ? `TEST #${v.number}` : `#${v.number}`;
  const items = `${Math.max(0, v.itemCount)} ürün`;
  return {
    title: `Yeni sipariş ${no}`,
    body: v.totalKurus == null ? items : `${items} · ${formatTL(v.totalKurus)}`,
  };
}

/** Push test bildirimi (Ayarlar › Bu cihazda bildirimler). */
export const PUSH_TEST_TEXT = {
  title: 'Bildirimler açık',
  body: 'Yeni sipariş geldiğinde bu cihaza bildirim gelecek.',
} as const;

/**
 * Panel çevrimdışı uyarısının kayıt/önizleme metni (06 §7.7). Gönderim onaylı platform şablonuyla
 * (`isletme_panel_cevrimdisi_v1`, parametreler: şube/işletme adı, dakika) yapılır.
 */
export function panelOfflineAlertText(v: { isletme: string; dk: number }): string {
  return `${v.isletme}: sipariş ekranı ${Math.max(1, Math.round(v.dk))} dakikadır kapalı görünüyor. Siparişleri kaçırmamak için paneli açın.`;
}

/** Müşteri adı bilinmiyorsa şablon değişkeni (02 §5.1). */
export const UNKNOWN_CUSTOMER_NAME = 'değerli müşterimiz';

/** Şablon parametre dizisi üretir; boş değer gönderilmez. */
export function templateParams<N extends CustomerTemplateName>(
  name: N,
  values: Record<(typeof CUSTOMER_TEMPLATES)[N]['params'][number], string | number | null | undefined>,
): string[] {
  const spec = CUSTOMER_TEMPLATES[name];
  return spec.params.map((key) => {
    const v = (values as Record<string, string | number | null | undefined>)[key];
    if (v == null || v === '') return key === 'musteriAdi' ? UNKNOWN_CUSTOMER_NAME : '-';
    return String(v);
  });
}

/** Durum → pencere dışı şablon adı. */
export function templateForStatus(status: OrderStatus, ctx: { cancelReason?: CancelReason | null } = {}): CustomerTemplateName | null {
  switch (status) {
    case 'new':
      return 'siparis_alindi_v1';
    case 'accepted':
      return 'siparis_onaylandi_v1';
    case 'ready':
      return 'siparis_hazir_v1';
    case 'on_the_way':
      return 'siparis_yolda_v1';
    case 'delivered':
      return 'siparis_teslim_v1';
    case 'rejected':
      return 'siparis_reddedildi_v1';
    case 'cancelled':
      return ctx.cancelReason === 'tenant_no_response' ? 'siparis_iptal_yanitsiz_v1' : 'siparis_iptal_v1';
    default:
      return null;
  }
}

/** Storefront altbilgisi imzası (00 §7). */
export const STOREFRONT_SIGNATURE = 'Altyapı: Siparişin Önünde';

/** Mesafeli satış onay ibaresi (00 §9). */
export const PAYMENT_OBLIGATION_NOTICE = 'Siparişi onayladığınızda ödeme yükümlülüğü doğar.';

/** Cayma hakkı istisnası notu (03 M18). */
export const WITHDRAWAL_EXCEPTION_NOTICE =
  'Gıda siparişleri çabuk bozulabilen ürünler olduğundan cayma hakkı kapsamı dışındadır.';
