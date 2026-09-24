import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #5: A-20.
export const metadata: Metadata = { title: 'Lead’ler' };

export default function Page() {
  return <ComingSoon title="Lead’ler" description="Demo talepleri ve hesaplayıcı lead’leri." />;
}
