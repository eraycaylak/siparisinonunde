import { getSiteUrl } from '@/lib/site';
import { QR_RETRY_AFTER_SECONDS, QR_UNKNOWN_PATH, qrTarget, qrUnavailableHtml, resolveQrCode } from '@/lib/qr-link';
import { normalizeWaCode, qrLinkPath } from '@siparis/core';

// QR kısa bağlantısı (00 §2, §12a madde 11; O4): yemekgelsin.net/q/<kod> → 302 işletmenin vitrini (?src=qr). Basılı
// QR'lar bunu kodlar; işletmenin modu ya da vitrin adresi değişince yeniden basım gerekmez. Sipariş almayan işletme de
// vitrine gider (vitrin bandı durumu gösterir). Bilinmeyen kod (API 404) → 302 /q: listesiz nötr sayfa
// (app/q/not-found.tsx). Geçici platform hatası (429, 5xx, zaman aşımı) → 503 + Retry-After "yeniden deneyin" sayfası:
// geçerli QR "bağlı değil" diye gösterilmez. Route handler kullanılır çünkü redirect() 307 döner; karar 302'dir.
// Önbelleğe alınmaz (işletmenin vitrin adresi değişebilir; emekli kodlar eski sahibine çözülür, 00 §3 "Emekli QR kodu").
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await params;
  const r = await resolveQrCode(code, { forwardedFor: request.headers.get('x-forwarded-for') ?? request.headers.get('cf-connecting-ip') });
  if (r.kind === 'unavailable') {
    // Yeniden dene bağlantısı aynı QR adresidir (katlanmış kod; `unavailable` yalnız geçerli biçimli kodda oluşur)
    return new Response(qrUnavailableHtml(qrLinkPath(normalizeWaCode(code) ?? '')), {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': String(QR_RETRY_AFTER_SECONDS),
        'X-Robots-Tag': 'noindex',
      },
    });
  }
  const location = r.kind === 'found' ? qrTarget(r.slug) : `${getSiteUrl()}${QR_UNKNOWN_PATH}`;
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
