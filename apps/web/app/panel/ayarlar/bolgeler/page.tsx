import type { Metadata } from 'next';
import { SettingsShell } from '@/components/settings/settings-shell';
import { ZonesManager } from '@/components/settings/zones-manager';

// P-17: teslimat bölgeleri — mahalle listesi, haritada çokgen, yarıçap (04 §7.5).
export const metadata: Metadata = { title: 'Teslimat bölgeleri' };

export default function Page() {
  return (
    <SettingsShell title="Teslimat bölgeleri" description="Mahalle listesi, haritada alan ya da yarıçap; bölge başına ücret, en az sepet ve süre.">
      <ZonesManager />
    </SettingsShell>
  );
}
