import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/** Sayfa sonu çağrısı (05 C.3.1 "Son CTA"). */
export function CtaBand({
  title = 'Sadık müşterin için komisyon ödemeyi bırak. Kendi kanalını bugün aç.',
  className,
}: {
  title?: string;
  className?: string;
}) {
  return (
    <section aria-labelledby="cta-baslik" className={cn('bg-ink text-white', className)}>
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:py-16 md:flex-row md:items-center md:justify-between">
        <h2 id="cta-baslik" className="max-w-2xl text-2xl font-bold leading-tight sm:text-3xl">
          {title}
        </h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/demo" className={buttonVariants({ variant: 'brand', size: 'lg' })}>
            Demo iste
          </Link>
          <Link
            href="/hesaplayici"
            className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'border-white/60 bg-transparent text-white hover:bg-white/10')}
          >
            Hesapla
          </Link>
        </div>
      </div>
    </section>
  );
}
