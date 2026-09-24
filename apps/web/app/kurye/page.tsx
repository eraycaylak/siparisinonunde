import type { Metadata } from 'next';
import { CourierOrders } from '@/components/courier/courier-orders';

// Kurye görünümü (K-02, K-03; 04 §9) — dilim 2. Gün sonu özeti (K-04) Faz 2.
export const metadata: Metadata = { title: 'Siparişlerim' };

export default function Page() {
  return <CourierOrders />;
}
