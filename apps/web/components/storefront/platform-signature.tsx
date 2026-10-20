import { STOREFRONT_SIGNATURE } from '@siparis/core/messages/tr';
import { getSiteUrl } from '@/lib/site';

/**
 * Vitrin ve takip sayfası altbilgisindeki işletmeci beyanı (00 §7 "Storefront imzası", §12a madde 11; 12 §5.3):
 * "Bu sayfa {İşletme} tarafından işletilir; Yemek Gelsin yalnız yazılım altyapısı sağlar." Satıcı ve veri sorumlusu
 * işletmedir; işletme adı önde ve vurgulu, platform adı küçük bir rel="nofollow" bağlantıdır (?src=sf_footer). Metin
 * core `storefrontSignature` ile birebir aynıdır. Logo yok; checkout başlığında ve onay butonu çevresinde kullanılmaz.
 * İşletme adı bilinmiyorsa (vitrin verisi alınamadı) hiçbir şey çizilmez: beyan işletmesiz yazılamaz.
 */
export function PlatformSignature({ businessName }: { businessName: string | null | undefined }) {
  const name = businessName?.trim();
  if (!name) return null;
  const s = STOREFRONT_SIGNATURE;
  return (
    <p data-testid="operator-statement" className="max-w-md text-[13px] leading-5 text-fg-muted">
      {s.before}
      <span className="font-semibold text-fg">{name}</span>
      {s.after}
      <a href={`${getSiteUrl()}/?src=sf_footer`} rel="nofollow" className="underline underline-offset-4 hover:text-fg">
        {s.platform}
      </a>
      {s.role}
    </p>
  );
}
