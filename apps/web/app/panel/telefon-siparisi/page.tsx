import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #2: Akış E manuel sipariş (P-06).
export const metadata: Metadata = { title: 'Telefon siparişi' };

export default function Page() {
  return <ComingSoon title="Telefon siparişi" description="Telefonla gelen siparişi hızlıca girin." />;
}
