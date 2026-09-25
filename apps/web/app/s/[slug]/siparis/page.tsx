import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui';
import { getStorefront } from '@/components/storefront/data';
import { CheckoutPage } from '@/components/storefront/checkout/checkout-page';

// Checkout (S-04/S-05) + Akış B sonuç ekranı (S-06B/C) — dilim 2 (14 §9, 03 §4.4–4.5).
// Başlık ve bağlantı önizlemesi işletmenin adıyla (kök düzenin platform tanıtımı ezilir, 00 §7).
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await getStorefront(slug);
  const name = result.kind === 'ok' ? result.store.tenant.name : null;
  const title = name ? `Siparişi tamamla · ${name}` : 'Siparişi tamamla';
  const description = name ? `${name} online sipariş.` : 'Online sipariş.';
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    openGraph: { type: 'website', locale: 'tr_TR', title, description, ...(name ? { siteName: name } : {}) },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getStorefront(slug);
  if (result.kind === 'not_found') notFound();
  if (result.kind === 'error') {
    return (
      <Alert variant="danger" title="İşletme bilgileri yüklenemedi" className="mt-6">
        Lütfen biraz sonra tekrar deneyin.
      </Alert>
    );
  }
  return <CheckoutPage slug={slug} store={result.store} />;
}
