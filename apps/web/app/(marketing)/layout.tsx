import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#icerik"
        className="sr-only z-50 rounded-md bg-primary px-4 py-3 font-semibold text-primary-fg focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        İçeriğe geç
      </a>
      <SiteHeader />
      <main id="icerik" className="flex-1" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
