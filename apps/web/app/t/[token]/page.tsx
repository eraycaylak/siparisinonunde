import type { Metadata } from 'next';
import { TrackingPage } from '@/components/orders/tracking-page';

// Takip sayfası (S-07/S-08, 03 §7) — dilim 2. Süresi dolmuş link 410 → kişisel veri yok.
export const metadata: Metadata = { title: 'Sipariş takibi', robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TrackingPage token={token} />;
}
