import type { Metadata } from 'next';
import { TenantDetailScreen } from '@/components/admin/tenant-detail';

// A-04 işletme detayı (05 §A.4): Genel, WhatsApp, Siparişler, Notlar, Üyeler + salt-okunur destek erişimi.
export const metadata: Metadata = { title: 'İşletme detayı' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TenantDetailScreen id={id} />;
}
