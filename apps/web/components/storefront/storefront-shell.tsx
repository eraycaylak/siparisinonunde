import type { ReactNode } from 'react';
import { PlatformSignature } from './platform-signature';

/**
 * Mobil öncelikli storefront kabuğu (03 §4.0). İşletme markası önde; platform yalnız altbilgide.
 * Marka rengi (--brand, --brand-contrast …) dilim #1 tarafından <style> ile satır içi verilir (12 §5.1).
 */
export function StorefrontShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
        <main id="icerik" className="flex-1 px-4 py-4">
          {children}
        </main>
        <footer className="flex flex-col items-center gap-2 border-t border-border px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4 text-center">
          {footer}
          <PlatformSignature />
        </footer>
      </div>
    </div>
  );
}
