import { getSiteUrl } from '@/lib/site';

/**
 * Storefront ve takip sayfası altbilgisi imzası (00 §7, 12 §5.3): tek metin, küçük, logosuz,
 * rel="nofollow", ?src=sf_footer. Checkout başlığında ve onay butonu çevresinde kullanılmaz.
 */
export function PlatformSignature() {
  return (
    <a
      href={`${getSiteUrl()}/?src=sf_footer`}
      rel="nofollow"
      className="inline-flex min-h-10 items-center text-[13px] text-fg-muted underline-offset-4 hover:underline"
    >
      Altyapı: Siparişin Önünde
    </a>
  );
}
