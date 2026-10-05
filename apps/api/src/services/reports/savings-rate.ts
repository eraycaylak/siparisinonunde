// Tasarruf raporunun oran ve komisyon aritmetiği (04 §11.3). Oranı işletme girer; **girilmemişse uydurulmaz** —
// rapor tutar yerine "Oranınızı girin" çağrısı taşır. Para hesabı kuruş tamsayısı + repo'nun `roundHalfUp`'ı ile
// yapılır (00 §12a madde 9); KDV oranı da ayrı bir sihirli sayı değil, hesaplayıcının kendi yapılandırmasıdır.

import { DEFAULT_CALCULATOR_CONFIG, roundHalfUp } from '@siparis/core';

/**
 * "Oran girilmedi" durumunun bugünkü gösterimi. `tenants.marketplace_commission_bp` hâlâ `NOT NULL DEFAULT 2500`
 * olduğu için boş bırakılan girdi 0 baz puan olarak kaydedilir; 0 bir oran değildir ("pazaryeri hiç kesinti
 * yapmıyor" iddiası kimsenin işletmesi için doğru değil) ve tasarruf kartına yazacak hiçbir şey vermez.
 * Kolon nullable olduğunda (bkz. docs/07 `savings_commission_bp`) `null` da aynı dalı kullanır; kod değişmez.
 */
export const COMMISSION_NOT_ENTERED_BP = 0;

/**
 * Depodaki ham oranı rapora uygun hâle getirir: girilmemiş (null/0/geçersiz) ise `null`, aksi hâlde baz puan.
 * Üst sınır **uygulanmaz**: saklanan oranı sessizce kırpmak, raporu veriyle çelişir hâle getirir.
 */
export function resolveCommissionBp(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const bp = Math.trunc(raw);
  return bp <= COMMISSION_NOT_ENTERED_BP ? null : bp;
}

/** Kaçınılan komisyon (KDV hariç): sepet × oran. Oran yoksa `null` (0 TL değil — "bilinmiyor" demek). */
export function avoidedCommissionKurus(basketTotalKurus: number, commissionBp: number | null): number | null {
  if (commissionBp == null) return null;
  return roundHalfUp((Math.max(0, basketTotalKurus) * commissionBp) / 10_000);
}

/** Aynı tutarın KDV dahil nakit etkisi (04 §11.3: Cp × k × 1,20). */
export function withVatKurus(kurus: number | null): number | null {
  if (kurus == null) return null;
  return roundHalfUp(kurus * (1 + DEFAULT_CALCULATOR_CONFIG.vatRate));
}
