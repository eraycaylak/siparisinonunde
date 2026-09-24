import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #5: A-11.
export const metadata: Metadata = { title: 'İşler' };

export default function Page() {
  return <ComingSoon title="İşler" description="Arka plan işleri ve başarısız işler (DLQ)." />;
}
