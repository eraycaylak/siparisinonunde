import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #5: A-18.
export const metadata: Metadata = { title: 'Denetim kaydı' };

export default function Page() {
  return <ComingSoon title="Denetim kaydı" description="Kritik işlemlerin kaydı." />;
}
