import type { Metadata } from 'next';
import { JobsScreen } from '@/components/admin/jobs';

// A-11 kuyruklar ve DLQ (05 §A.4).
export const metadata: Metadata = { title: 'İşler' };

export default function Page() {
  return <JobsScreen />;
}
