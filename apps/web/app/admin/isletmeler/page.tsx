import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #5: A-03 işletmeler.
export const metadata: Metadata = { title: 'İşletmeler' };

export default function Page() {
  return <ComingSoon title="İşletmeler" description="İşletme listesi, yaşam döngüsü ve plan." />;
}
