import type { MetadataRoute } from 'next';

// İşletme paneli PWA bildirimi (ana ekrana ekle). Kök app/manifest.ts yerine burada: dosya kuralı bağlantıyı HER sayfaya
// (vitrin, takip, pazarlama) ekliyordu; müşteri "Ana ekrana ekle" deyince panel girişi açılıyordu. Bağlantı yalnız
// panel düzeninde verilir (app/panel/layout.tsx metadata.manifest).

const MANIFEST: MetadataRoute.Manifest = {
  id: '/panel',
  name: 'Siparişin Önünde · İşletme paneli',
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

export function GET(): Response {
  return new Response(JSON.stringify(MANIFEST), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
