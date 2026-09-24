import type { Metadata } from 'next';
import { Store } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

// Yer tutucu — Dilim #1 (menü + storefront okuma): S-01 menü, S-02 ürün, sepet çekmecesi, "Son siparişin" kartı,
// ?l= link token'ını POST /store/:slug/session ile çereze çevirme (03 §4, 14 §9).
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: { absolute: slug } };
}

export default async function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  await params;
  return (
    <EmptyState
      icon={Store}
      title="Menü hazırlanıyor"
      description="Bu işletmenin online menüsü çok yakında burada olacak."
      className="mt-8"
    />
  );
}
