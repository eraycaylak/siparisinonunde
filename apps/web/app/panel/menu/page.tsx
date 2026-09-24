import type { Metadata } from 'next';
import { MenuPage } from '@/components/menu/menu-page';

// /panel/menu (04 §6, tablet öncelikli): kategoriler, ürünler, seçenek grupları, toplu fiyat, CSV.
// Kasiyer ve mutfak yalnız "Bugün tükendi" anahtarını kullanır (düzenleme kontrolleri gizli; yetki API'de).
export const metadata: Metadata = { title: 'Menü' };

export default function Page() {
  return <MenuPage />;
}
