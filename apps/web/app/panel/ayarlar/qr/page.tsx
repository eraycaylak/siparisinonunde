import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: QR/afiş (P-36).
export const metadata: Metadata = { title: 'QR ve afiş' };

export default function Page() {
  return <ComingSoon title="QR ve afiş" description="QR kod ve A5 afiş yazdırma." />;
}
