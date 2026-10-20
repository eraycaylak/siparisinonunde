import type { ReactNode } from 'react';
import { DemoNotice } from '@/components/common/demo-notice';
import { PlatformSignature } from './platform-signature';

/**
 * Mobil öncelikli storefront kabuğu (03 §4.0). İşletme markası önde; platform yalnız altbilgideki işletmeci beyanında
 * (00 §7, §12a madde 11: "Bu sayfa {İşletme} tarafından işletilir; Yemek Gelsin yalnız yazılım altyapısı sağlar.").
 * `businessName` verilmezse beyan çizilmez: takip sayfası düzeni işletme adını bilmez, beyanı kendi altbilgisinde
 * (tracking-page.tsx) yazar.
 * Marka rengi (--brand, --brand-contrast …) dilim #1 tarafından <style> ile satır içi verilir (12 §5.1).
 * Yazdırırken altbilgi basılmaz (yasal metin sayfası künyeyi belge içinde taşır).
 */
export function StorefrontShell({ children, footer, businessName }: { children: ReactNode; footer?: ReactNode; businessName?: string | null }) {
  const hasFooter = Boolean(footer) || Boolean(businessName?.trim());
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <DemoNotice />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
        <main id="icerik" className="flex-1 px-4 py-4">
          {children}
        </main>
        {hasFooter ? (
          <footer className="mt-6 flex flex-col items-center gap-3 border-t border-border px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6 text-center print:hidden">
            {footer}
            <PlatformSignature businessName={businessName} />
          </footer>
        ) : null}
      </div>
    </div>
  );
}
