import type { Metadata } from 'next';
import { SearchX } from 'lucide-react';

// Vitrin 404'ü (/s/{bilinmeyen}, alt alan adında bilinmeyen dükkan, vitrindeki bilinmeyen yasal metin): 00 §12a madde 11
// "yalnız yazılım" — vitrin müşteriye platformu tanıtmaz. Kök 404'teki (app/not-found.tsx) "Ana sayfaya dön" ve
// "İşletme paneli" bağlantıları burada YOKTUR; başka işletme, liste ya da öneri de gösterilmez. Önizlemede nötr metin.
// DİKKAT: Next iç içe not-found.tsx'in `metadata`'sını UYGULAMAZ (yalnız kök/global not-found); başlığı eşleşen sayfa
// verir: bilinmeyen slug'da app/s/[slug]/page.tsx generateMetadata ("Online sipariş"), eşleşmeyen alt yolda
// app/s/[slug]/[...rest]/page.tsx bu nesneyi yeniden dışa aktarır.
export const metadata: Metadata = {
  title: { absolute: 'Sayfa bulunamadı' },
  description: 'Aradığınız sayfa bulunamadı.',
  robots: { index: false, follow: false },
  openGraph: { type: 'website', locale: 'tr_TR', title: 'Sayfa bulunamadı', description: 'Aradığınız sayfa bulunamadı.' },
};

export default function StorefrontNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-bg px-4 py-16 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-surface text-fg-muted">
        <SearchX aria-hidden className="size-8" />
      </span>
      <h1 className="text-3xl font-bold text-fg">Sayfa bulunamadı</h1>
      <p className="max-w-md text-lg text-fg-muted">
        Bu adreste bir sipariş sayfası yok. Bağlantıyı kontrol edin ya da işletmenin paylaştığı güncel bağlantıyı açın.
      </p>
    </main>
  );
}
