import type { Metadata } from 'next';
import { OrderHistory } from '@/components/orders/order-history';

// Sipariş geçmişi (P-07, 04 §4.18) — dilim 2.
export const metadata: Metadata = { title: 'Siparişler' };

export default function Page() {
  return <OrderHistory />;
}
