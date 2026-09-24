import type { Metadata } from 'next';
import { FlagsScreen } from '@/components/admin/flags';

// A-13 feature flag ve kill-switch (05 §A.4).
export const metadata: Metadata = { title: 'Bayraklar' };

export default function Page() {
  return <FlagsScreen />;
}
