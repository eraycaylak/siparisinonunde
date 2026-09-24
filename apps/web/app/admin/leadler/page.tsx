import type { Metadata } from 'next';
import { LeadsScreen } from '@/components/admin/leads';

// A-20 satış ve lead yönetimi (05 §A.4).
export const metadata: Metadata = { title: 'Lead’ler' };

export default function Page() {
  return <LeadsScreen />;
}
