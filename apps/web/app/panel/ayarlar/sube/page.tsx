import type { Metadata } from 'next';
import { BranchPage } from '@/components/settings/branch-page';

// Şube bilgileri + sipariş alma durumu (04 §4.10, §7.2–§7.4).
export const metadata: Metadata = { title: 'Şube ve sipariş durumu' };

export default function Page() {
  return <BranchPage />;
}
