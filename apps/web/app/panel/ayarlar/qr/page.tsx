import type { Metadata } from 'next';
import { QrTools } from '@/components/settings/qr-tools';
import { SettingsShell } from '@/components/settings/settings-shell';

// P-36: QR, A5 afiş ve paket içi kart (04 §12.1, 12 §7).
export const metadata: Metadata = { title: 'QR ve afiş' };

export default function Page() {
  return (
    <SettingsShell title="QR ve afiş" description="Mağaza ve WhatsApp bağlantıları için QR kod, A5 afiş ve paket içi kart." className="max-w-5xl">
      <QrTools />
    </SettingsShell>
  );
}
