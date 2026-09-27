import type { MetadataRoute } from 'next';
import { BRAND_RED } from '@/lib/site';

// İşletme paneli PWA bildirimi (ana ekrana ekle). Kök app/manifest.ts yerine burada: dosya kuralı bağlantıyı HER sayfaya
// (vitrin, takip, pazarlama) ekliyordu; müşteri "Ana ekrana ekle" deyince panel girişi açılıyordu. Bağlantı yalnız
// panel düzeninde verilir (app/panel/layout.tsx metadata.manifest).

const MANIFEST: MetadataRoute.Manifest = {
  id: '/panel',
  name: 'Yemek Gelsin · İşletme paneli',
  short_name: 'Siparişler',
  description: 'WhatsApp sipariş paneli',
  lang: 'tr',
  start_url: '/panel',
  scope: '/',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: BRAND_RED,
  // Kırmızı kare + beyaz YG işareti; işaret maskelenebilir güvenli alanda (public/brand, components/brand/logo.tsx)
  icons: [
    { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
};

export function GET(): Response {
  return new Response(JSON.stringify(MANIFEST), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
