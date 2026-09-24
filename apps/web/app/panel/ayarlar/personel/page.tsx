import type { Metadata } from 'next';
import { SettingsShell } from '@/components/settings/settings-shell';
import { StaffManager } from '@/components/settings/staff-manager';

// P-23: personel, roller, parola sıfırlama, devre dışı bırakma (04 §7.11).
export const metadata: Metadata = { title: 'Personel' };

export default function Page() {
  return (
    <SettingsShell title="Personel" description="Kullanıcılar, roller ve kurye giriş bağlantısı.">
      <StaffManager />
    </SettingsShell>
  );
}
