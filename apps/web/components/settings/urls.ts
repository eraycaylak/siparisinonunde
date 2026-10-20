// Paylaşılacak bağlantılar (QR, afiş, kurulum): alt alan adı varsa onu, yoksa tarayıcının kökenini kullanır.

import { qrLinkPath } from '@siparis/core';
import { ROOT_DOMAIN, getSiteUrl } from '@/lib/site';
import { storefrontPublicUrl } from '@/lib/storefront-url';

export function publicStorefrontUrl(slug: string, query = ''): string {
  if (!ROOT_DOMAIN && typeof window !== 'undefined') {
    return `${window.location.origin}/s/${encodeURIComponent(slug)}${query}`;
  }
  return `${storefrontPublicUrl(slug)}${query}`;
}

/**
 * QR kısa bağlantısı (00 §12a madde 11, O4): <kök>/q/<KOD> → işletmenin vitrini. Basılı QR'lar bunu kodlar; mod ya da
 * vitrin adresi değişince yeniden basım gerekmez. Kök: yapılandırılmış site adresi; yerelde (alt alan adı yokken)
 * tarayıcının kökeni.
 */
export function publicQrUrl(code: string): string {
  const base = !ROOT_DOMAIN && typeof window !== 'undefined' ? window.location.origin : getSiteUrl();
  return `${base}${qrLinkPath(code)}`;
}

/** QR'ın altına yazılan, elle yazılabilir kısa biçim: "yemekgelsin.net/q/BOZOK" (protokolsüz). */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/** wa.me bağlantısı; hazır mesaj ASCII (12 §7.2 — QR yoğunlaşmasın). */
export function waMeUrl(e164: string, text = 'Merhaba'): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
