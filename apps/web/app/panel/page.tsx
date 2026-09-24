import type { Metadata } from 'next';
import { LiveScreen } from '@/components/live/live-screen';

// Canlı sipariş ekranı (P-04, 04 §4) — dilim 2.
export const metadata: Metadata = { title: 'Canlı siparişler' };

export default function Page() {
  return <LiveScreen />;
}
