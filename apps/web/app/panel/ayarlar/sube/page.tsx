import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: şube ayarları, ordering_state anahtarı.
export const metadata: Metadata = { title: 'Şube ve sipariş durumu' };

export default function Page() {
  return <ComingSoon title="Şube ve sipariş durumu" description="Adres, hazırlık süresi, yoğun ve durdur." />;
}
