import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: P-26.
export const metadata: Metadata = { title: 'İşletme bilgileri' };

export default function Page() {
  return <ComingSoon title="İşletme bilgileri" description="Ad, künye, marka rengi ve logo." />;
}
