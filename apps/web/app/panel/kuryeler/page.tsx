import type { Metadata } from 'next';
import { CouriersView } from '@/components/couriers/couriers-view';

// P-24: kuryeler, giriş bağlantısı (QR + kopyala), aktif atamalar (04 §7.11).
export const metadata: Metadata = { title: 'Kuryeler' };

export default function Page() {
  return <CouriersView />;
}
