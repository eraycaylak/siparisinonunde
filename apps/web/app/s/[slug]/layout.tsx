import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { brandPalette, brandPaletteCss } from '@siparis/core/menu/brand-palette';
import { getStorefront } from '@/components/storefront/data';
import { StorefrontFooter } from '@/components/storefront/storefront-footer';
import { StorefrontShell } from '@/components/storefront/storefront-shell';

// Storefront düzeni (/s/{slug}; alt alan adı proxy.ts ile buraya yazılır). Menü (S-01) ve checkout (dilim 2) bunu paylaşır.
// İşletme markası önde: ana renk paleti (12 §5.1) SSR'da hesaplanır ve satır içi yazılır; istemci JS'i gerekmez.
// Palet değişkenleri: --brand, --brand-contrast, --brand-strong, --brand-ui, --brand-subtle ([data-sf-theme] altında).
export default async function StorefrontLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getStorefront(slug);
  if (result.kind === 'not_found') notFound();
  const store = result.kind === 'ok' ? result.store : null;
  const palette = brandPalette(store?.tenant.brandColor);
  return (
    <div data-sf-theme="">
      <style dangerouslySetInnerHTML={{ __html: brandPaletteCss(palette, '[data-sf-theme]') }} />
      <StorefrontShell footer={store ? <StorefrontFooter store={store} /> : null}>{children}</StorefrontShell>
    </div>
  );
}
