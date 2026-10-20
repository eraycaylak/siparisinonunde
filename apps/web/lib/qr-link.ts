/**
 * QR kısa bağlantısı (00 §2, §12a madde 11; O4): `yemekgelsin.net/q/<kod>` → işletmenin vitrini (302, `?src=qr`).
 * Kod = tenants.wa_code; büyük/küçük harf ve Türkçe harf duyarsız (core normalizeWaCode). Dükkanın adresi API'den sorulur
 * (GET /api/v1/public/q/:code, yanıt yalnız slug). Müşterinin IP'si X-Forwarded-For ile iletilir: API'nin oran sınırı
 * web sunucusunun değil müşterinin IP'sine göre işler. Üç sonuç ayrılır:
 * - `found`: API slug döndü → vitrine 302.
 * - `unknown`: kod biçimsiz ya da API 404 → listesiz nötr "QR kodu bulunamadı" sayfası (başka işletme önerilmez).
 * - `unavailable`: geçici platform hatası (429 oran sınırı, 5xx, zaman aşımı, ağ hatası, bozuk yanıt) → "şu an
 *   açılamadı, yeniden deneyin" (503). Geçerli bir basılı QR, platformun geçici sorunu yüzünden müşteriye "bu QR bir
 *   sipariş sayfasına bağlı değil" diye gösterilmez (işletmeye gereksiz yeniden basım ve destek yükü).
 */
import { normalizeWaCode, qrLinkPath } from '@siparis/core';
import { storefrontPublicUrl } from './storefront-url';

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const SLUG_RE = /^[a-z0-9](?:-?[a-z0-9]){2,39}$/;

export type QrResolution = { kind: 'found'; slug: string } | { kind: 'unknown' } | { kind: 'unavailable' };

export async function resolveQrCode(
  raw: string,
  opts: { forwardedFor?: string | null; fetchImpl?: FetchFn; apiOrigin?: string } = {},
): Promise<QrResolution> {
  const code = normalizeWaCode(raw);
  if (!code) return { kind: 'unknown' };
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const apiOrigin = opts.apiOrigin ?? process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.forwardedFor) headers['x-forwarded-for'] = opts.forwardedFor;
  try {
    const res = await fetchImpl(`${apiOrigin.replace(/\/+$/, '')}/api/v1/public${qrLinkPath(code)}`, {
      cache: 'no-store',
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 404) return { kind: 'unknown' };
    if (!res.ok) return { kind: 'unavailable' };
    const body = (await res.json()) as { slug?: unknown };
    // Bozuk yanıt platform hatasıdır (işletmenin QR'ı değil); geçersiz slug'a da asla yönlendirilmez (açık yönlendirme yok)
    return typeof body.slug === 'string' && SLUG_RE.test(body.slug) ? { kind: 'found', slug: body.slug } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Geçici hata yanıtında istemciye önerilen yeniden deneme süresi (sn). */
export const QR_RETRY_AFTER_SECONDS = 5;

/**
 * Geçici hata sayfası (503): listesiz, platform tanıtımı ya da panel bağlantısı yok; tek bağlantı aynı QR adresini
 * yeniden denemektir. Route handler'dan düz HTML döner (tasarım sistemi yüklenemese de okunur; açık/koyu tema).
 */
export function qrUnavailableHtml(retryPath: string): string {
  const href = retryPath.replace(/[^A-Za-z0-9/%_.~-]/g, '');
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sayfa şu an açılamadı</title>
<style>
:root{--bg:#ffffff;--fg:#111827;--muted:#4b5563;--accent:#111827;--accent-fg:#ffffff;color-scheme:light dark}
@media (prefers-color-scheme: dark){:root{--bg:#0b0f14;--fg:#f3f4f6;--muted:#9ca3af;--accent:#f3f4f6;--accent-fg:#0b0f14}}
body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:64px 16px;text-align:center;box-sizing:border-box}
h1{margin:0;font-size:28px}
p{margin:0;max-width:28rem;font-size:18px;color:var(--muted)}
a{display:inline-block;margin-top:8px;padding:12px 20px;border-radius:12px;background:var(--accent);color:var(--accent-fg);font-weight:600;text-decoration:none}
</style>
</head>
<body>
<main>
<h1>Sayfa şu an açılamadı</h1>
<p>Bir sorun oldu, QR kodunuz geçerli olabilir. Birkaç saniye sonra yeniden deneyin.</p>
<a href="${href}">Yeniden dene</a>
</main>
</body>
</html>`;
}

/** Yönlendirme hedefi: işletmenin herkese açık vitrin adresi (alt alan adı açıksa o) + `?src=qr` kaynak etiketi. */
export function qrTarget(slug: string): string {
  return `${storefrontPublicUrl(slug)}?src=qr`;
}

/** Bilinmeyen kodun nötr sayfası (app/q/not-found.tsx). */
export const QR_UNKNOWN_PATH = '/q';
