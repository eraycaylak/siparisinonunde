import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuditScreen } from '@/components/admin/audit';
import { ScreenLoading } from '@/components/common/screen-state';

// A-18 audit log (05 §A.4).
export const metadata: Metadata = { title: 'Denetim kaydı' };

export default function Page() {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <AuditScreen />
    </Suspense>
  );
}
