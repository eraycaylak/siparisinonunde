import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { WhatsappSimulator } from '@/components/whatsapp/simulator';
import { SimulatorDisabledNotice } from '@/components/whatsapp/simulator-disabled';
import { devToolsEnabled, probeDevApi } from '@/lib/dev-tools';

// WhatsApp simülatörü (14 §9) — dilim 3. Yalnız DEV_TOOLS=1 / NEXT_PUBLIC_DEV_TOOLS=1. API'nin geliştirici uçları kapalıysa
// (gerçek WhatsApp bağlı, 15 §13) simülatör yerine bilgilendirme gösterilir (200).
export const metadata: Metadata = { title: 'WhatsApp simülatörü', robots: { index: false, follow: false } };

export default async function DevWhatsAppPage() {
  await connection();
  if (!devToolsEnabled()) notFound();
  const devApi = await probeDevApi();
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold">WhatsApp simülatörü</h1>
      {devApi === 'disabled' ? <SimulatorDisabledNotice /> : <WhatsappSimulator />}
    </div>
  );
}
