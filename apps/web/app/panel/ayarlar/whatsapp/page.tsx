import type { Metadata } from 'next';
import { WhatsappSettingsPage } from '@/components/whatsapp/whatsapp-settings';

// WhatsApp bağlantısı (04 P-25) — dilim 3: sağlayıcı, numara, API anahtarı, webhook, test mesajı, sağlık.
export const metadata: Metadata = { title: 'WhatsApp bağlantısı' };

export default function Page() {
  return <WhatsappSettingsPage />;
}
