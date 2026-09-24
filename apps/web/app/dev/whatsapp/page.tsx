import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { WhatsappSimulator } from '@/components/whatsapp/simulator';
import { devToolsEnabled } from '@/lib/dev-tools';

// WhatsApp simülatörü (14 §9) — dilim 3. Yalnız DEV_TOOLS=1 / NEXT_PUBLIC_DEV_TOOLS=1.
export const metadata: Metadata = { title: 'WhatsApp simülatörü', robots: { index: false, follow: false } };

export default async function DevWhatsAppPage() {
  await connection();
  if (!devToolsEnabled()) notFound();
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold">WhatsApp simülatörü</h1>
      <WhatsappSimulator />
    </div>
  );
}
