import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #5: A-06.
export const metadata: Metadata = { title: 'WhatsApp sağlığı' };

export default function Page() {
  return <ComingSoon title="WhatsApp sağlığı" description="Tüm WhatsApp hesaplarının bağlantı durumu." />;
}
