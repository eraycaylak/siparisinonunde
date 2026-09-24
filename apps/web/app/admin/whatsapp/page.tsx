import type { Metadata } from 'next';
import { WhatsappHealthScreen } from '@/components/admin/whatsapp-health';

// A-06 WhatsApp sağlık tablosu (05 §A.4).
export const metadata: Metadata = { title: 'WhatsApp sağlığı' };

export default function Page() {
  return <WhatsappHealthScreen />;
}
