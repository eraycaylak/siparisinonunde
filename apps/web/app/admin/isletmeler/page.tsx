import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TenantsListScreen } from '@/components/admin/tenants-list';
import { ScreenLoading } from '@/components/common/screen-state';

// A-03 işletmeler listesi (05 §A.4).
export const metadata: Metadata = { title: 'İşletmeler' };

export default function Page() {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <TenantsListScreen />
    </Suspense>
  );
}
