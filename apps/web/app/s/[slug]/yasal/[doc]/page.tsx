import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui';
import { getStorefront } from '@/components/storefront/data';
import { StoreLegalDocumentView } from '@/components/storefront/legal/store-legal-document';
import { STORE_LEGAL_TITLES, buildStoreLegalDocument, isStoreLegalDoc } from '@/components/storefront/legal/store-legal';

// S-10 Yasal metinler (03 §4.8; 08 §2.4-B, §4.4): /s/{slug}/yasal/{aydinlatma | on-bilgilendirme | mesafeli-satis}.
// Son müşteri için veri sorumlusu ve satıcı işletmedir; metinler işletme künyesiyle (GET /store/:slug `legal`) dolar.
// Arama motorlarına kapalı; marka paleti ve altbilgi storefront düzeninden gelir.

type Params = Promise<{ slug: string; doc: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, doc } = await params;
  const docTitle = isStoreLegalDoc(doc) ? STORE_LEGAL_TITLES[doc] : 'Yasal metin';
  const result = await getStorefront(slug);
  const name = result.kind === 'ok' ? result.store.tenant.name : null;
  const title = name ? `${docTitle} · ${name}` : docTitle;
  const description = name ? `${name} ${docTitle.toLocaleLowerCase('tr-TR')}.` : `${docTitle}.`;
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    openGraph: { type: 'website', locale: 'tr_TR', title, description, ...(name ? { siteName: name } : {}) },
  };
}

export default async function Page({ params }: { params: Params }) {
  const { slug, doc } = await params;
  if (!isStoreLegalDoc(doc)) notFound();
  const result = await getStorefront(slug);
  if (result.kind === 'not_found') notFound();
  if (result.kind === 'error') {
    return (
      <Alert variant="danger" title="İşletme bilgileri yüklenemedi" className="mt-6">
        Lütfen biraz sonra tekrar deneyin.
      </Alert>
    );
  }
  return <StoreLegalDocumentView store={result.store} document={buildStoreLegalDocument(doc, result.store)} />;
}
