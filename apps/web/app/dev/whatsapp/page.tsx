import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ComingSoon } from '@/components/common/coming-soon';
import { devToolsEnabled } from '@/lib/dev-tools';

// Yer tutucu — Dilim #3: WhatsApp simülatörü (14 §9). Yalnız DEV_TOOLS=1 / NEXT_PUBLIC_DEV_TOOLS=1.
export const metadata: Metadata = { title: 'WhatsApp simülatörü', robots: { index: false, follow: false } };

export default async function DevWhatsAppPage() {
  await connection();
  if (!devToolsEnabled()) notFound();
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <ComingSoon title="WhatsApp simülatörü" description="Mock WhatsApp hesabıyla müşteri gibi yazın, butonlara basın, SMS kutusunu görün." />
    </div>
  );
}
