import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site';

// Yalnız pazarlama sitesi sayfaları (panel, admin, storefront ve takip hariç).
const ROUTES: Array<{ path: string; priority: number; changeFrequency: 'weekly' | 'monthly' | 'yearly' }> = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/nasil-calisir', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/fiyatlar', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/hesaplayici', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/demo', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/sss', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/kunye', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/yasal/kullanim-kosullari', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/yasal/gizlilik', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/yasal/kvkk-aydinlatma', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/yasal/cerez', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/yasal/mesafeli-satis-sablonu', priority: 0.2, changeFrequency: 'yearly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  return ROUTES.map((r) => ({
    url: `${base}${r.path === '/' ? '' : r.path}`,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
