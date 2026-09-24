import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // API, paneller, takip sayfası ve parametreli hesaplayıcı linkleri taranmaz (05 C.6.1).
        disallow: ['/api/', '/panel', '/admin', '/kurye', '/dev', '/t/', '/hesaplayici?'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
