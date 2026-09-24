import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReceiptPrint } from '@/components/orders/receipt-print';

// Fiş yazdırma görünümü (04 §4.14) — dilim 2. Panel oturumu gerekir (API 401/403 döner).
export const metadata: Metadata = { title: 'Fiş', robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return (
    <Suspense fallback={null}>
      <ReceiptPrint orderId={orderId} />
    </Suspense>
  );
}
