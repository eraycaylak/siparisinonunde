import type { Metadata } from 'next';
import { TrackingPage } from '@/components/orders/tracking-page';

// Takip sayfası (S-07/S-08, 03 §7) — dilim 2. Süresi dolmuş link 410 → kişisel veri yok.
// Müşteri linki WhatsApp'ta paylaşınca önizleme platformun işletmelere dönük tanıtımını değil, nötr bir metni gösterir
// (kök düzenin açıklaması ve openGraph'ı burada ezilir; işletme markası önde, 00 §7).
const DESCRIPTION = 'Siparişinizin durumunu bu bağlantıdan izleyebilirsiniz.';
export const metadata: Metadata = {
  title: { absolute: 'Sipariş takibi' },
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: { type: 'website', locale: 'tr_TR', title: 'Sipariş takibi', description: DESCRIPTION },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TrackingPage token={token} />;
}
