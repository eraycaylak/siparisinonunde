import type { MetadataRoute } from 'next';

/** İşletme paneli PWA bildirimi (ana ekrana ekle). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Siparişin Önünde',
    short_name: 'Siparişler',
    description: 'WhatsApp sipariş paneli',
    lang: 'tr',
    start_url: '/panel',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#14233a',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
