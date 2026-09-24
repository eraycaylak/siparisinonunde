import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #3 (WhatsApp + SMS): gelen kutusu (P-08).
export const metadata: Metadata = { title: 'Sohbetler' };

export default function Page() {
  return <ComingSoon title="Sohbetler" description="WhatsApp konuşmaları, yanıtlama ve devralma." />;
}
