import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #1 (menü + storefront okuma): menü yönetimi; kasiyer/mutfak yalnız tükendi.
export const metadata: Metadata = { title: 'Menü' };

export default function Page() {
  return <ComingSoon title="Menü" description="Kategoriler, ürünler, seçenekler ve tükenenler." />;
}
