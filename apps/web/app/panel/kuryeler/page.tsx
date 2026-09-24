import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: kuryeler (P-24).
export const metadata: Metadata = { title: 'Kuryeler' };

export default function Page() {
  return <ComingSoon title="Kuryeler" description="Kuryeler ve giriş linkleri." />;
}
