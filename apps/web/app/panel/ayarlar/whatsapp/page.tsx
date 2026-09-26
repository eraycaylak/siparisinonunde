import type { Metadata } from 'next';
import { WhatsappSettingsPage } from '@/components/whatsapp/whatsapp-settings';

// WhatsApp (04 P-25): ortak numarada (00 §12a madde 8) dükkan kodu, müşteri bağlantısı, QR ve masa kartı; kendi numarada
// sağlayıcı, numara, API anahtarı, webhook, test mesajı, sağlık.
export const metadata: Metadata = { title: 'WhatsApp' };

export default function Page() {
  return <WhatsappSettingsPage />;
}
