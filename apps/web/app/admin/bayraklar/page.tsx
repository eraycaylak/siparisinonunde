import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #5: A-13.
export const metadata: Metadata = { title: 'Bayraklar' };

export default function Page() {
  return <ComingSoon title="Bayraklar" description="Acil durdurma anahtarları ve özellik bayrakları." />;
}
