import { responsiveImage } from '@/lib/image';

/**
 * Yüklenen görseli duyarlı biçimde çizer (06 §12, 12 §5.2): WebP `srcset` + `sizes`, açık `width`/`height`
 * (en-boy oranı → CLS), doğru `loading`/`fetchpriority`.
 *
 * Varyantı olmayan adreslerde (eski yükleme ya da elle girilmiş `https://…`) tek `src` ile çizer; `srcset`
 * üretmez. Bu yüzden eski menüler kırılmaz.
 *
 * `<picture>` neden: WebP'yi `<source>` ile vermek, `srcset` destekleyip WebP desteklemeyen eski Safari'de
 * (iOS 13 ve altı) görselin kırılmasını önler — `src` o istemcilerde özgün biçimdeki kareye düşer.
 * `display: contents` (`contents` sınıfı) `<picture>`'ı yerleşimden tamamen çıkarır, böylece `<img>` eskiden
 * olduğu gibi kendi kapsayıcısının/flex satırının doğrudan öğesi kalır.
 */
export function ResponsiveImage({
  url,
  alt,
  className,
  sizes,
  priority = false,
}: {
  url: string;
  /** Bilgi taşımayan süs görselinde boş metin verilir. */
  alt: string;
  className?: string;
  /** Görselin CSS'te kapladığı kutu (ör. `104px`). `srcset` seçimi buna göre yapılır. */
  sizes: string;
  /** Sayfanın en büyük görseli (LCP adayı, ör. vitrin kapağı): hemen ve yüksek öncelikle indirilir. */
  priority?: boolean;
}) {
  const img = responsiveImage(url, sizes);
  if (!img) return null;

  const attrs = {
    alt,
    className,
    loading: priority ? ('eager' as const) : ('lazy' as const),
    decoding: priority ? ('sync' as const) : ('async' as const),
    fetchPriority: priority ? ('high' as const) : ('auto' as const),
    ...(img.width && img.height ? { width: img.width, height: img.height } : {}),
  };

  if (!img.webpSrcSet) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={img.src} {...attrs} />;
  }
  return (
    <picture className="contents">
      <source type="image/webp" srcSet={img.webpSrcSet} sizes={img.sizes} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img.src} {...attrs} />
    </picture>
  );
}
