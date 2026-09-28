/**
 * WhatsApp'taki kısa menü bağlantısı (/m/<token>): token'ın dükkan adresini API'den sorar (GET /api/v1/public/menu-link/:token).
 * Token burada TÜKETİLMEZ; vitrin /s/<slug>?l=<token> adresinde oturuma çevirir. Süresi dolmuş, geçersiz ya da API'ye
 * ulaşılamıyorsa null.
 */
type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const TOKEN_RE = /^[A-Za-z0-9_-]{8,400}$/;

export async function resolveMenuLink(
  token: string,
  fetchImpl: FetchFn = (input, init) => fetch(input, init),
  apiOrigin: string = process.env.API_INTERNAL_URL ?? 'http://localhost:4000',
): Promise<string | null> {
  if (!TOKEN_RE.test(token)) return null;
  try {
    const res = await fetchImpl(`${apiOrigin.replace(/\/+$/, '')}/api/v1/public/menu-link/${encodeURIComponent(token)}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { slug?: unknown };
    return typeof body.slug === 'string' && body.slug ? body.slug : null;
  } catch {
    return null;
  }
}

/** Vitrin adresi: token vitrine taşınır (orada oturuma çevrilir ve adres çubuğundan silinir). */
export function menuLinkTarget(slug: string, token: string): string {
  return `/s/${encodeURIComponent(slug)}?l=${encodeURIComponent(token)}`;
}
