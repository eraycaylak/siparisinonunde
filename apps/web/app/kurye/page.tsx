import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #2: kurye görünümü (K-02, K-03).
export const metadata: Metadata = { title: 'Siparişlerim' };

export default function Page() {
  return <ComingSoon title="Siparişlerim" description="Size atanan siparişler." />;
}
