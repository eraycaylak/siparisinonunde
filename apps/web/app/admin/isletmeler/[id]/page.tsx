import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #5: A-04 işletme detayı (profil, lifecycle, plan, WhatsApp, siparişler, notlar, impersonation).
export const metadata: Metadata = { title: 'İşletme detayı' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await params;
  return <ComingSoon title="İşletme detayı" description="Profil, plan, WhatsApp sağlığı, siparişler, notlar ve destek erişimi." />;
}
