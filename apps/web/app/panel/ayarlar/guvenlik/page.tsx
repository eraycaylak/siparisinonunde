import type { Metadata } from 'next';
import { PanelSecurityScreen } from '@/components/security/security-screens';

// Kendi hesabının iki adımlı doğrulaması (00 §12a madde 7): kişisel hesabı olan tüm roller; sahibe önerilir.
export const metadata: Metadata = { title: 'Güvenlik' };

export default function Page() {
  return <PanelSecurityScreen />;
}
