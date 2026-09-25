import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';

// Vitrin 404'ü de bu sayfadır (/s/{bilinmeyen}): önizlemede platform tanıtımı değil nötr metin görünür
export const metadata: Metadata = {
  title: 'Sayfa bulunamadı',
  description: 'Aradığınız sayfa bulunamadı.',
  robots: { index: false },
  openGraph: { type: 'website', locale: 'tr_TR', title: 'Sayfa bulunamadı', description: 'Aradığınız sayfa bulunamadı.' },
};

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 py-16 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-surface text-fg-muted">
        <SearchX aria-hidden className="size-8" />
      </span>
      <h1 className="text-3xl font-bold text-fg">Sayfa bulunamadı</h1>
      <p className="max-w-md text-lg text-fg-muted">Aradığınız sayfa taşınmış ya da hiç var olmamış olabilir. Adresi kontrol edin.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
          Ana sayfaya dön
        </Link>
        <Link href="/panel" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
          İşletme paneli
        </Link>
      </div>
    </main>
  );
}
