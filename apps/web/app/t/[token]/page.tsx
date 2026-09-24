import { PackageSearch } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

// Yer tutucu — Dilim #2: takip sayfası (durum çizelgesi, tahmini süre, kalemler, iptal/iptal talebi,
// teslimden sonra 3 butonlu değerlendirme; süresi dolmuş link 410 → kişisel veri yok) (14 §9, 03 §7).
export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  await params;
  return (
    <EmptyState
      icon={PackageSearch}
      title="Sipariş takibi hazırlanıyor"
      description="Siparişinizin durumu çok yakında bu sayfada görünecek."
      className="mt-8"
    />
  );
}
