import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: bölgeler (maplibre).
export const metadata: Metadata = { title: 'Teslimat bölgeleri' };

export default function Page() {
  return <ComingSoon title="Teslimat bölgeleri" description="Mahalle listesi, harita, ücret ve minimum sepet." />;
}
