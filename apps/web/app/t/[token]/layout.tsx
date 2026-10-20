import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { StorefrontShell } from '@/components/storefront/storefront-shell';

export const metadata: Metadata = {
  title: { default: 'Sipariş takibi', template: '%s' },
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

// İşletmeci beyanı (00 §7, §12a madde 11) takip sayfasının kendi altbilgisindedir: düzen işletme adını bilmez.
export default function TrackingLayout({ children }: { children: ReactNode }) {
  return <StorefrontShell>{children}</StorefrontShell>;
}
