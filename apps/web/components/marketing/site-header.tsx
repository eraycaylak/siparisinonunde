'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { buttonVariants } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { MARKETING_NAV } from '@/lib/site';

/** Pazarlama sitesi üst menüsü: logo, bağlantılar, "İşletme girişi" ve "Ücretsiz dene". */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 print:hidden border-b border-border bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="-ms-1 rounded-md p-1" aria-label="Siparişin Önünde ana sayfa">
          <Logo textClassName="max-[400px]:sr-only" />
        </Link>
        <nav aria-label="Ana menü" className="ms-4 hidden flex-1 items-center gap-1 lg:flex">
          {MARKETING_NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-10 items-center rounded-md px-3 text-sm font-semibold transition-colors',
                  active ? 'bg-accent text-fg' : 'text-fg-muted hover:bg-accent hover:text-fg',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <Link href="/panel/giris" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}>
            İşletme girişi
          </Link>
          <Link href="/panel/kayit" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
            Ücretsiz dene
          </Link>
          <IconButton label="Menüyü aç" icon={<Menu />} className="lg:hidden" onClick={() => setOpen(true)} />
        </div>
      </div>
      <Sheet open={open} onOpenChange={setOpen} title="Menü" side="right" size="sm">
        <nav aria-label="Mobil menü" className="flex flex-col gap-1">
          {[{ href: '/', label: 'Ana sayfa' }, ...MARKETING_NAV].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={pathname === item.href ? 'page' : undefined}
              className="flex min-h-hit items-center rounded-md px-3 text-base font-semibold text-fg hover:bg-accent aria-[current=page]:bg-accent"
            >
              {item.label}
            </Link>
          ))}
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
            <Link href="/panel/giris" onClick={() => setOpen(false)} className={buttonVariants({ variant: 'secondary', block: true })}>
              İşletme girişi
            </Link>
            <Link href="/panel/kayit" onClick={() => setOpen(false)} className={buttonVariants({ variant: 'primary', block: true })}>
              Ücretsiz dene
            </Link>
          </div>
        </nav>
      </Sheet>
    </header>
  );
}
