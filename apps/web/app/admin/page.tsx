import type { Metadata } from 'next';
import { AdminOverviewScreen } from '@/components/admin/overview';

// A-02 kontrol paneli (05 §A.4).
export const metadata: Metadata = { title: 'Özet' };

export default function Page() {
  return <AdminOverviewScreen />;
}
