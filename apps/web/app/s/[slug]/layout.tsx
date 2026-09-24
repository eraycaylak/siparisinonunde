import type { ReactNode } from 'react';
import { StorefrontShell } from '@/components/storefront/storefront-shell';

// Storefront düzeni (/s/{slug}; alt alan adı proxy.ts ile buraya yazılır).
// Dilim #1: işletme adı/logosu, marka rengi, kapalı/yoğun bandı, yardım menüsü ve künye altbilgisi.
export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return <StorefrontShell>{children}</StorefrontShell>;
}
