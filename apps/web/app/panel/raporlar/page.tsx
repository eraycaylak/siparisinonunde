import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: raporlar (P-32…P-34).
export const metadata: Metadata = { title: 'Raporlar' };

export default function Page() {
  return <ComingSoon title="Raporlar" description="Gün sonu, kanal karması ve tahmini tasarruf." />;
}
