import type { Metadata } from 'next';
import { AlarmForm } from '@/components/settings/branch-options';
import { SettingsShell } from '@/components/settings/settings-shell';

// P-19: sipariş alarmı — kademeli uyarı zinciri ve otomatik iptal (00 §10, 04 §7.7).
export const metadata: Metadata = { title: 'Sipariş alarmı' };

export default function Page() {
  return (
    <SettingsShell title="Sipariş alarmı" description="Onaylanmayan siparişte uyarı zinciri, müşteri bilgisi ve otomatik iptal süresi.">
      <AlarmForm />
    </SettingsShell>
  );
}
