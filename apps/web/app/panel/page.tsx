import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #2 (sipariş yaşam döngüsü): canlı sipariş ekranı, vardiya başlat, alarm, kanban (14 §9).
export const metadata: Metadata = { title: 'Canlı siparişler' };

export default function Page() {
  return <ComingSoon title="Canlı siparişler" description="Yeni siparişler burada sesli uyarıyla görünür." />;
}
