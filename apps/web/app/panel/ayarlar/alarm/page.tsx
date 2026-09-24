import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: alarm politikası (00 §10).
export const metadata: Metadata = { title: 'Sipariş alarmı' };

export default function Page() {
  return <ComingSoon title="Sipariş alarmı" description="Uyarı zinciri ve otomatik iptal süresi." />;
}
