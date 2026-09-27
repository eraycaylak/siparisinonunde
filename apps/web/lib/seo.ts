import type { Metadata } from 'next';
import { OG_IMAGE, SITE_NAME } from './site';

/** Pazarlama sayfası metadata'sı: başlık, açıklama, kanonik adres, OpenGraph ve Twitter kartı (varsayılan marka görseli). */
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
    openGraph: { type: 'website', locale: 'tr_TR', siteName: SITE_NAME, title: fullTitle, description, url: path, images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title: fullTitle, description, images: [OG_IMAGE.url] },
  };
}
