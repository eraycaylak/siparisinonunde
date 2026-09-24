import type { Metadata } from 'next';
import { NotificationsForm } from '@/components/settings/branch-options';
import { SettingsShell } from '@/components/settings/settings-shell';

// P-20: müşteri bildirimleri — hangi durum mesajı gitsin (04 §7.8).
export const metadata: Metadata = { title: 'Müşteri bildirimleri' };

export default function Page() {
  return (
    <SettingsShell title="Müşteri bildirimleri" description="Sipariş durumu değişince müşteriye hangi mesajların gideceği.">
      <NotificationsForm />
    </SettingsShell>
  );
}
