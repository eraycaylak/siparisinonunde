import type { Metadata } from 'next';
import { OnboardingWizard } from '@/components/onboarding/wizard';

// P-38: onboarding sihirbazı (04 §3). Kabuk bu yolda menüsüz, sade üst çubuk gösterir.
export const metadata: Metadata = { title: 'Kurulum' };

export default function Page() {
  return <OnboardingWizard />;
}
