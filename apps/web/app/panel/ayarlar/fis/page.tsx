import type { Metadata } from 'next';
import { ReceiptSettingsForm } from '@/components/settings/receipt-settings';
import { SettingsShell } from '@/components/settings/settings-shell';

// P-22: fiş ayarları + 80 mm önizleme (04 §4.14, 12 §7.4).
export const metadata: Metadata = { title: 'Fiş' };

export default function Page() {
  return (
    <SettingsShell title="Fiş" description="Kağıt genişliği, fiş türleri, alt bilgi ve önizleme." className="max-w-5xl">
      <ReceiptSettingsForm />
    </SettingsShell>
  );
}
