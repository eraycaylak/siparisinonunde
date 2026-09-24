import type { Metadata } from 'next';
import { SITE_NAME } from './site';

/** Pazarlama sayfası metadata'sı: başlık, açıklama, kanonik adres ve OpenGraph (sayfaya özgü). */
export function pageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  absoluteTitle?: boolean;
}): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} · ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website', locale: 'tr_TR', siteName: SITE_NAME, title: fullTitle, description, url: path },
    twitter: { card: 'summary', title: fullTitle, description },
  };
}
