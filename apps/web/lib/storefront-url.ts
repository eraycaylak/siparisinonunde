import { ROOT_DOMAIN, getSiteUrl } from './site';

/**
 * Uygulama içi storefront bağlantısı: her iki host'ta da çalışır
 * (alt alan adında /s/ yolu proxy tarafından olduğu gibi bırakılır).
 */
export function storefrontHref(slug: string, subpath = ''): string {
  const p = subpath && !subpath.startsWith('/') ? `/${subpath}` : subpath;
  return `/s/${encodeURIComponent(slug)}${p}`;
}

/** Paylaşılacak tam storefront adresi (QR, afiş, WhatsApp): alt alan adı varsa onu kullanır. */
export function storefrontPublicUrl(slug: string, subpath = ''): string {
  const p = subpath && !subpath.startsWith('/') ? `/${subpath}` : subpath;
  if (ROOT_DOMAIN) {
    const secure = !ROOT_DOMAIN.startsWith('localhost');
    return `${secure ? 'https' : 'http'}://${slug}.${ROOT_DOMAIN}${p}`;
  }
  return `${getSiteUrl()}${storefrontHref(slug, p)}`;
}

/** Takip sayfası adresi (14 §7.4): APP_BASE_URL/t/{token}. */
export function trackingUrl(token: string): string {
  return `${getSiteUrl()}/t/${token}`;
}
