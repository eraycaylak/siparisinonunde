// Paylaşılacak bağlantılar (QR, afiş, kurulum): alt alan adı varsa onu, yoksa tarayıcının kökenini kullanır.

import { ROOT_DOMAIN } from '@/lib/site';
import { storefrontPublicUrl } from '@/lib/storefront-url';

export function publicStorefrontUrl(slug: string, query = ''): string {
  if (!ROOT_DOMAIN && typeof window !== 'undefined') {
    return `${window.location.origin}/s/${encodeURIComponent(slug)}${query}`;
  }
  return `${storefrontPublicUrl(slug)}${query}`;
}

/** wa.me bağlantısı; hazır mesaj ASCII (12 §7.2 — QR yoğunlaşmasın). */
export function waMeUrl(e164: string, text = 'Merhaba'): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
