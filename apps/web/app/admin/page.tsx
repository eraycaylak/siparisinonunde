import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #5 (admin): A-02 özet.
export const metadata: Metadata = { title: 'Özet' };

export default function Page() {
  return <ComingSoon title="Özet" description="İşletme sayıları, bugünkü siparişler, açık alarmlar ve başarısız işler." />;
}
