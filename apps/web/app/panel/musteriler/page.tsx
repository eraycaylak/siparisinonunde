import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: müşteriler (P-30/P-31).
export const metadata: Metadata = { title: 'Müşteriler' };

export default function Page() {
  return <ComingSoon title="Müşteriler" description="Müşteri listesi, sipariş geçmişi ve notlar." />;
}
