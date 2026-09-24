import type { Metadata } from 'next';
import { ShoppingBag } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

// Yer tutucu — Dilim #2: checkout (teslim türü, iletişim, mahalle + adres, ödeme, ön bilgilendirme,
// "Siparişi onayla" + "ödeme yükümlülüğü doğar"), Akış B sonuç ekranı (14 §9).
export const metadata: Metadata = { title: 'Sipariş', robots: { index: false, follow: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  await params;
  return (
    <EmptyState
      icon={ShoppingBag}
      title="Sipariş sayfası hazırlanıyor"
      description="Online sipariş çok yakında bu sayfadan verilebilecek."
      className="mt-8"
    />
  );
}
