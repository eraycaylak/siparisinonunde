// Tasarruf raporu oranı girdisi (04 §11.3, P-34). Oran işletmeye aittir ve **boş bırakılabilir**: boş oran
// "girilmedi" demektir, rapor o zaman tutar yerine "Oranınızı girin" çağrısı gösterir. Yüzdeyi `Number(...)` ile
// okumak yasak — "1.000" Türkçe yazımda bindir, `Number('1.000')` 1 verir; repo'nun `parseTlToKurus` yardımcısı
// kuruş ile aynı iki-ondalık ölçeği kullandığı için baz puan da (%25,5 → 2550) aynı kurallarla çözülür.

import { MARKETPLACE_COMMISSION_BP_MAX } from '@siparis/core/settings/validation';
import { parseTlToKurus } from '@/lib/format';

/**
 * "Oran girilmedi" gösterimi. `tenants.marketplace_commission_bp` bugün `NOT NULL DEFAULT 2500` olduğu için
 * boş girdi 0 baz puan olarak kaydedilir; sunucu tarafı (`savings-rate.ts`) 0'ı "girilmedi" sayar. Kolon
 * nullable olduğunda yerine `null` yazılır, bu dosyadaki ayrıştırma değişmez.
 */
export const COMMISSION_NOT_ENTERED_BP = 0;

export type CommissionRate =
  | { readonly kind: 'empty'; readonly bp: 0 }
  | { readonly kind: 'valid'; readonly bp: number }
  | { readonly kind: 'invalid' };

/** Metni baz puana çevirir: boş → girilmedi, 0–60 arası dışı ya da sayı olmayan → geçersiz. */
export function parseCommissionRate(input: string): CommissionRate {
  if (input.trim() === '') return { kind: 'empty', bp: COMMISSION_NOT_ENTERED_BP };
  const bp = parseTlToKurus(input);
  if (bp == null || bp > MARKETPLACE_COMMISSION_BP_MAX) return { kind: 'invalid' };
  return bp <= COMMISSION_NOT_ENTERED_BP ? { kind: 'empty', bp: COMMISSION_NOT_ENTERED_BP } : { kind: 'valid', bp };
}

/** Baz puanı forma yazılacak metne çevirir; girilmemiş oran boş alandır (0 yazmak uydurma bir orandır). */
export function commissionRateInput(bp: number | null | undefined): string {
  if (bp == null || bp <= COMMISSION_NOT_ENTERED_BP) return '';
  return String(bp / 100).replace('.', ',');
}
