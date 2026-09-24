import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: onboarding sihirbazı (P-38).
export const metadata: Metadata = { title: 'Kurulum' };

export default function Page() {
  return <ComingSoon title="Kurulum" description="İşletmenizi birkaç adımda hazırlayın." />;
}
