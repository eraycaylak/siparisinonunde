import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';

/** Giriş/kayıt sayfaları için ortalanmış kabuk. */
export function AuthLayout({
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="px-4 py-5">
        <Link href="/" className="inline-flex min-h-hit items-center rounded-md p-1" aria-label="Siparişin Önünde ana sayfa">
          <Logo />
        </Link>
      </header>
      <main id="icerik" className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center">
        <div className={wide ? 'w-full max-w-xl' : 'w-full max-w-md'}>
          <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm sm:p-8">
            <h1 className="text-2xl font-bold text-fg">{title}</h1>
            {description ? <div className="mt-2 text-base text-fg-muted">{description}</div> : null}
            <div className="mt-6">{children}</div>
          </div>
          {footer ? <div className="mt-6 text-center text-sm text-fg-muted">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
