// Uygulama içi takip adresi (S-07, 03 §7.1). Sınırda doğrulanır çünkü adres `router.replace`'e verilir
// (Next: ham/denetlenmemiş URL verilmez) ve geçersiz bir token'la `/t/` adresine gidilirse müşteri 404'te kalır.
// Tam URL (mesaj, QR, fiş) için: lib/storefront-url.ts → trackingUrl().
//
// TOKEN BİÇİMİ — tek kaynak `apps/api/src/lib/tracking.ts` (14 §7.4):
//   base64url(sipariş kimliği, 16 bayt) + "." + base64url(HMAC-SHA256)[0..16]   → ör. "Ab-C_d…gH.XyZ…12"
// NOKTA ZORUNLUDUR. Önceki desen noktayı kabul etmiyordu: Akış B'de sipariş oluşuyor ama doğrulama ekranına
// geçiş `null` dönüp "Takip sayfanız açılamadı" çıkmaz sokağına düşüyordu (e2e 02 ve 03, 05.10.2026).
// Aynalayan test: apps/api/test/tracking.test.ts (gerçek token bu desenle eşleşiyor mu).

/** `<base64url>.<base64url>`; yol/şema enjeksiyonuna kapalı (nokta yalnız ayraç olarak, iki yanı dolu). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,48}\.[A-Za-z0-9_-]{8,32}$/;

export function isTrackingToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/** `/t/<token>` — token geçersizse null (çağıran çıkmaz sokak yerine açıklama gösterir). */
export function trackingPath(token: unknown): string | null {
  if (!isTrackingToken(token)) return null;
  return `/t/${token}`;
}
