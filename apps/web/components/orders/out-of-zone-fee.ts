// Telefon siparişinde bölge dışı istisna ücreti (04 §4.13, 00 §4). Kasiyerin yazdığı TL tutarı kuruşa çevirir.
// Kendi `Number(...)` ayrıştırmamızı kullanmak yasak: "1.000" Türkçe yazımda bin liradır, `Number('1.000')` ise
// 1 verir ve kasiyer 1.000 TL yazarken siparişe 1,00 TL teslimat ücreti girerdi. Tek doğru yol repo'nun kendi
// yardımcısı `parseTlToKurus` (binlik nokta / ondalık virgül kurallarıyla, kuruşa yarım yukarı yuvarlanmış).

import { formatMoney, parseTlToKurus } from '@/lib/format';

/**
 * Üst sınır: 10.000 TL. Bölge dışı ücret elle yazılan tek serbest para alanıdır; sepet toplamı `int4` kuruş
 * olduğu için (docs/07) sınırsız bir ücret taşma yoluna dönüşür. Sınır tasarım kararıdır, yazım hatası kalkanıdır.
 */
export const OUT_OF_ZONE_FEE_MAX_KURUS = 1_000_000;

export type OutOfZoneFee =
  /** Boş alan: ücretsiz istisna (0 kuruş). */
  | { readonly kind: 'empty'; readonly kurus: 0 }
  | { readonly kind: 'valid'; readonly kurus: number }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'too_large' };

/** Girdiyi tek yerde yorumlar: önizleme, doğrulama ve gönderilen gövde aynı sonucu kullanır. */
export function parseOutOfZoneFee(input: string): OutOfZoneFee {
  if (input.trim() === '') return { kind: 'empty', kurus: 0 };
  const kurus = parseTlToKurus(input);
  if (kurus == null) return { kind: 'invalid' };
  if (kurus > OUT_OF_ZONE_FEE_MAX_KURUS) return { kind: 'too_large' };
  return { kind: 'valid', kurus };
}

/** Önizlemede kullanılacak tutar; geçersiz girdide tutar yazmayız (0 göstermek yanlış tahsilat demek). */
export function outOfZoneFeeKurus(fee: OutOfZoneFee): number | null {
  return fee.kind === 'empty' || fee.kind === 'valid' ? fee.kurus : null;
}

export const OUT_OF_ZONE_FEE_ERRORS: Record<'invalid' | 'too_large', string> = {
  invalid: 'Geçerli bir tutar girin (örnek: 1.000 ya da 25,50).',
  // Metin sınırdan türetilir: sabit ile mesaj birbirinden ayrı düşemez.
  too_large: `Ücret en çok ${formatMoney(OUT_OF_ZONE_FEE_MAX_KURUS, 'short')} olabilir.`,
};

/** Alan hatası metni; geçerli girdide `null`. */
export function outOfZoneFeeError(fee: OutOfZoneFee): string | null {
  return fee.kind === 'invalid' || fee.kind === 'too_large' ? OUT_OF_ZONE_FEE_ERRORS[fee.kind] : null;
}
