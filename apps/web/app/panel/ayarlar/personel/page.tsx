import type { Metadata } from 'next';
import { ComingSoon } from '@/components/common/coming-soon';

// Yer tutucu — Dilim #4: personel (P-23).
export const metadata: Metadata = { title: 'Personel' };

export default function Page() {
  return <ComingSoon title="Personel" description="Kullanıcılar, roller ve kurye giriş linki." />;
}
