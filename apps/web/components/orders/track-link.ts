// Uygulama içi takip adresi (S-07, 03 §7.1). Takip token'ı `base62(HMAC-SHA256(...))[:22]`'dir; sınırda
// doğrulanır çünkü adres `router.replace`'e verilir (Next: ham/denetlenmemiş URL verilmez) ve geçersiz bir
// token'la `/t/` adresine gidilirse müşteri 404'te kalır.
// Tam URL (mesaj, QR, fiş) için: lib/storefront-url.ts → trackingUrl().

/** Token biçimi: base62 + URL-güvenli ayraçlar; uzunluk sunucu değişirse de makul bir aralıkta. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isTrackingToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/** `/t/<token>` — token geçersizse null (çağıran çıkmaz sokak yerine açıklama gösterir). */
export function trackingPath(token: unknown): string | null {
  if (!isTrackingToken(token)) return null;
  return `/t/${token}`;
}
