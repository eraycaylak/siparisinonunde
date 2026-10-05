// Tutar bağı (denetim B11 · FAZ 2.2): müşterinin EKRANDA GÖRDÜĞÜ toplam ile sunucunun hesapladığı toplam aynı mı.
//
// NEDEN: fiyatı yalnız sunucu hesaplar (CLAUDE.md kural 3) ama onay butonundaki sayı istemcinin elindeydi. `/quote`
// hata verdiğinde ya da 400 ms'lik gecikme penceresinde müşteri BAYAT (teslimat ücreti içermeyen) bir toplam görüp
// "Siparişi onayla"ya basabiliyordu; sunucu doğru ve daha yüksek tutarı kaydediyordu. Sonuç: kapıda fiyat tartışması
// ve "müşteri hangi tutarı onayladı" sorusunun cevapsız kalması.
//
// KURAL: istek gövdesindeki `expectedTotalKurus` sunucunun toplamıyla birebir aynı değilse sipariş OLUŞTURULMAZ;
// 409 `cart_changed` ile yeni tutar döner ve müşteriden onay yeniden istenir. Tutar istemciden FİYAT olarak değil
// ONAY KANITI olarak alınır: hesaba hiçbir noktada girmez, yalnız karşılaştırılır.

import { formatTL } from '@siparis/core';
import { AppError, conflict } from '../../lib/errors';

/** Sunucunun hesapladığı tutarlar (quoteCart sonucundan). */
export interface ServerTotals {
  subtotalKurus: number;
  deliveryFeeKurus: number;
  totalKurus: number;
}

/**
 * Onay tutarını göndermek zorunlu mu. Üretim derlemesinde zorunludur (tek istemci olan storefront her zaman gönderir);
 * geliştirme ve testte isteğe bağlıdır, böylece doğrudan API'ye istek atan testler ve yerel araçlar bozulmaz.
 */
export function expectedTotalRequired(config: { NODE_ENV: string }): boolean {
  return config.NODE_ENV === 'production';
}

/**
 * Ekranda görülen tutarı sunucunun hesabıyla karşılaştırır. Sorun yoksa `null`, varsa fırlatılacak hatayı döner.
 * Hata metni müşteriye gösterilir: yeni tutarı yazar, teknik ayrıntı sızdırmaz.
 */
export function expectedTotalProblem(
  expectedTotalKurus: number | undefined,
  totals: ServerTotals,
  opts: { required: boolean },
): AppError | null {
  if (expectedTotalKurus === undefined) {
    if (!opts.required) return null;
    return new AppError(
      400,
      'expected_total_missing',
      'Sipariş tutarı doğrulanamadı. Sayfayı yenileyip siparişinizi tekrar onaylayın.',
    );
  }
  if (expectedTotalKurus === totals.totalKurus) return null;
  return conflict('cart_changed', `Sepetiniz güncellendi, yeni tutar: ${formatTL(totals.totalKurus)}. Onaylıyorsanız tekrar onaya basın.`, {
    expectedTotalKurus,
    totalKurus: totals.totalKurus,
    subtotalKurus: totals.subtotalKurus,
    deliveryFeeKurus: totals.deliveryFeeKurus,
    /** Pozitif: sunucu toplamı ekranda görülenden yüksek (müşteri aleyhine fark). */
    differenceKurus: totals.totalKurus - expectedTotalKurus,
  });
}
