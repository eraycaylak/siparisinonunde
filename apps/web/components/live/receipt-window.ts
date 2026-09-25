// Onayda otomatik fiş (04 §4.14, 06 §9 "Kabulde yazdırma penceresi açılır"). Tarayıcılar `await` sonrasındaki
// window.open çağrısını kullanıcı jesti dışında sayıp açılır pencere engeline takar. Bu yüzden fiş penceresi tıklama
// anında, onay isteğinden önce boş açılır; onay başarılıysa fiş adresine yönlendirilir (sayfa yüklenince kendisi
// yazdırır, kopya sayısı şube fiş ayarından), onay başarısızsa kapatılır.

import type { ReceiptKind } from '@/components/orders/api';

/** Kullanılan pencere API'si (tarayıcıda `window`; testte sahte nesne). */
export interface ReceiptWindowLike {
  closed: boolean;
  close(): void;
  location: { replace(url: string): void };
  document?: { title: string; body: { textContent: string | null } | null };
}

export interface ReceiptWindowHost {
  open(url: string, target: string, features: string): ReceiptWindowLike | null;
}

/** Fiş penceresi boyutu (orders/api.ts openReceipt ile aynı). */
export const RECEIPT_WINDOW_FEATURES = 'width=420,height=720';

/** /receipt/:id?type=kitchen,delivery&auto=1 — yüklenince yazdırır. */
export function receiptUrl(orderId: string, kinds: readonly ReceiptKind[]): string {
  return `/receipt/${orderId}?type=${kinds.join(',')}&auto=1`;
}

/** Aynı sipariş + fiş türleri için tek pencere (yeniden basışta aynı pencere kullanılır). */
export function receiptWindowName(orderId: string, kinds: readonly ReceiptKind[]): string {
  return `fis-${orderId}-${kinds.join('-')}`;
}

function defaultHost(): ReceiptWindowHost | null {
  return typeof window === 'undefined' ? null : window;
}

/**
 * Onay + otomatik fiş. `kinds` boşsa (otomatik yazdırma kapalı ya da şube ayarı fiş istemiyor) yalnız onaylar.
 * Pencere tıklama jesti içinde, ilk `await`ten önce açılmalıdır: bu fonksiyon tıklama işleyicisinden doğrudan
 * çağrılır ve `open` eşzamanlı çalışır. Onay hatası yeniden fırlatılır (çağıran tost gösterir).
 */
export async function acceptWithAutoPrint<T>(
  accept: () => Promise<T>,
  orderId: string,
  kinds: readonly ReceiptKind[],
  host: ReceiptWindowHost | null = defaultHost(),
): Promise<T> {
  const target = kinds.length > 0 ? host : null;
  const win = target ? target.open('about:blank', receiptWindowName(orderId, kinds), RECEIPT_WINDOW_FEATURES) : null;
  if (win?.document) {
    try {
      win.document.title = 'Fiş';
      if (win.document.body) win.document.body.textContent = 'Fiş hazırlanıyor…';
    } catch {
      /* boş pencere erişilemezse boş kalır */
    }
  }
  let result: T;
  try {
    result = await accept();
  } catch (err) {
    if (win && !win.closed) win.close();
    throw err;
  }
  if (win) {
    // Kullanıcı bekleme sırasında pencereyi kapattıysa yeniden açılmaz; fiş elle basılabilir
    if (!win.closed) win.location.replace(receiptUrl(orderId, kinds));
  } else if (target) {
    // Pencere açılamadıysa (engelleyici) eski davranış: bir kez daha dene
    target.open(receiptUrl(orderId, kinds), receiptWindowName(orderId, kinds), RECEIPT_WINDOW_FEATURES);
  }
  return result;
}
