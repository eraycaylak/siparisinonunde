import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: ödeme yöntemleri.
export const metadata: Metadata = { title: 'Ödeme yöntemleri' };

export default function Page() {
  return <ComingSoon title="Ödeme yöntemleri" description="Kapıda nakit, kart ve yemek kartı." />;
}
