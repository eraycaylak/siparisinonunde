import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #2: sipariş geçmişi ve arama (P-07).
export const metadata: Metadata = { title: 'Siparişler' };

export default function Page() {
  return <ComingSoon title="Siparişler" description="Sipariş geçmişi, arama ve ayrıntılar." />;
}
