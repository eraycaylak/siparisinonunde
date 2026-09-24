import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: fiş ayarları.
export const metadata: Metadata = { title: 'Fiş' };

export default function Page() {
  return <ComingSoon title="Fiş" description="Mutfak ve paket fişi ayarları." />;
}
