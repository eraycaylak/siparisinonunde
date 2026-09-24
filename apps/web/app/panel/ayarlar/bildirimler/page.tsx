import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: durum mesajları.
export const metadata: Metadata = { title: 'Müşteri bildirimleri' };

export default function Page() {
  return <ComingSoon title="Müşteri bildirimleri" description="Hangi durumda müşteriye mesaj gitsin." />;
}
