import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4 (UI) + #3 (API): WhatsApp bağlantısı (P-25).
export const metadata: Metadata = { title: 'WhatsApp bağlantısı' };

export default function Page() {
  return <ComingSoon title="WhatsApp bağlantısı" description="Numara, bağlantı sağlığı ve test mesajı." />;
}
