import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { JsonLd } from '@/components/common/json-ld';
import { getStorefront } from '@/components/storefront/data';
import { StorefrontMenu } from '@/components/storefront/storefront-menu';
import { storefrontPublicUrl } from '@/lib/storefront-url';

// S-01 Menü (03 §4.1): işletme başlığı + durum, "Son siparişin", kategori sekmeleri, ürün çekmecesi, sepet.
// ?l=<token> (Akış A) istemcide POST /store/:slug/session ile çereze çevrilir; GET isteği token'ı tüketmez.

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await getStorefront(slug);
  if (result.kind !== 'ok') {
    return { title: { absolute: 'Online sipariş' }, robots: { index: false, follow: false } };
  }
  const s = result.store;
  const title = `${s.tenant.name} · Online sipariş`;
  const description = `${s.tenant.name} menüsü ve online sipariş${s.branch.address ? ` · ${s.branch.address}` : ''}.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: storefrontPublicUrl(slug) },
    openGraph: {
      type: 'website',
      locale: 'tr_TR',
      siteName: s.tenant.name,
      title,
      description,
      ...(s.tenant.coverUrl ? { images: [{ url: s.tenant.coverUrl }] } : {}),
    },
    ...(s.tenant.logoUrl ? { icons: { icon: s.tenant.logoUrl } } : {}),
  };
}

/** schema.org Restaurant + hasMenu (03 §4.1 SEO). Fiyatlar TL (KDV dahil). */
function restaurantJsonLd(store: StorefrontView, slug: string): Record<string, unknown> {
  const url = storefrontPublicUrl(slug);
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: store.tenant.name,
    url,
    ...(store.branch.phone || store.tenant.phone ? { telephone: store.branch.phone ?? store.tenant.phone } : {}),
    ...(store.branch.address ? { address: { '@type': 'PostalAddress', streetAddress: store.branch.address, addressCountry: 'TR' } } : {}),
    ...(store.tenant.logoUrl ? { logo: store.tenant.logoUrl } : {}),
    hasMenu: {
      '@type': 'Menu',
      hasMenuSection: store.categories.map((c) => ({
        '@type': 'MenuSection',
        name: c.name,
        hasMenuItem: c.products.map((p) => ({
          '@type': 'MenuItem',
          name: p.name,
          ...(p.description ? { description: p.description } : {}),
          offers: { '@type': 'Offer', price: (p.priceKurus / 100).toFixed(2), priceCurrency: 'TRY' },
        })),
      })),
    },
  };
}

export default async function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getStorefront(slug);
  if (result.kind === 'not_found') notFound();
  const store = result.kind === 'ok' ? result.store : null;
  return (
    <>
      {store ? <JsonLd data={restaurantJsonLd(store, slug)} /> : null}
      <StorefrontMenu slug={slug} initialStore={store} />
    </>
  );
}
