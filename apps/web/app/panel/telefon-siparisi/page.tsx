import type { Metadata } from 'next';
import { PhoneOrder } from '@/components/orders/phone-order';

// Telefon siparişi (Akış E, P-06, 04 §4.13) — dilim 2.
export const metadata: Metadata = { title: 'Telefon siparişi' };

export default function Page() {
  return <PhoneOrder />;
}
