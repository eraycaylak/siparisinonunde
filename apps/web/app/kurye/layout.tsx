import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CourierShell } from '@/components/courier/courier-shell';

export const metadata: Metadata = {
  title: { default: 'Kurye', template: '%s · Kurye' },
  robots: { index: false, follow: false },
};

export default function CourierLayout({ children }: { children: ReactNode }) {
  return <CourierShell>{children}</CourierShell>;
}
