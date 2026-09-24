import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { SettingsIndex } from '@/components/panel/settings-index';

export const metadata: Metadata = { title: 'Ayarlar' };

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Ayarlar" description="İşletmenizin sipariş, teslimat ve bildirim ayarları." />
      <SettingsIndex />
    </div>
  );
}
