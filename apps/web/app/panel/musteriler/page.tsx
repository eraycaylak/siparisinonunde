import type { Metadata } from 'next';
import { CustomersView } from '@/components/customers/customers-view';

// P-30/P-31: müşteri listesi ve profil (04 §8); KVKK dışa aktarma/silme (08 §2.10).
export const metadata: Metadata = { title: 'Müşteriler' };

export default function Page() {
  return <CustomersView />;
}
