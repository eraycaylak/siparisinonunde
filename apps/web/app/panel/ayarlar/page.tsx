import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { SettingsIndex } from '@/components/panel/settings-index';
import { OnboardingBanner } from '@/components/onboarding/onboarding-banner';

export const metadata: Metadata = { title: 'Ayarlar' };

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Ayarlar" description="İşletmenizin sipariş, teslimat ve bildirim ayarları." />
      <OnboardingBanner />
      <SettingsIndex />
    </div>
  );
}
