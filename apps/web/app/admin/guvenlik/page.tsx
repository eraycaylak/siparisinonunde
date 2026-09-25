import type { Metadata } from 'next';
import { AdminSecurityScreen } from '@/components/security/security-screens';

// Platform hesabının iki adımlı doğrulaması (00 §12a madde 7). TOTP zorunluyken kurulmamış yönetici buraya yönlenir.
export const metadata: Metadata = { title: 'Güvenlik' };

export default function Page() {
  return <AdminSecurityScreen />;
}
