import type { Metadata } from 'next';
import { ReportsView } from '@/components/reports/reports-view';

// P-32–P-34: gün sonu kasa özeti, satış/kanal, ısı haritası, tasarruf (04 §11).
export const metadata: Metadata = { title: 'Raporlar' };

export default function Page() {
  return <ReportsView />;
}
