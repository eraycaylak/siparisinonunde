import type { Metadata } from 'next';
import { BusinessForm } from '@/components/settings/business-form';
import { SettingsShell } from '@/components/settings/settings-shell';

// P-26: işletme bilgileri, marka görünümü, künye, mağaza adresi (04 §7.2).
export const metadata: Metadata = { title: 'İşletme bilgileri' };

export default function Page() {
  return (
    <SettingsShell title="İşletme bilgileri" description="Ad, iletişim, marka rengi, logo, künye ve mağaza adresi.">
      <BusinessForm />
    </SettingsShell>
  );
}
