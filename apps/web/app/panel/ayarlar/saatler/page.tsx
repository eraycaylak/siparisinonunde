import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: saatler.
export const metadata: Metadata = { title: 'Çalışma saatleri' };

export default function Page() {
  return <ComingSoon title="Çalışma saatleri" description="Haftalık saatler ve özel günler." />;
}
