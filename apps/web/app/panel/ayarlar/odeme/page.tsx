import type { Metadata } from 'next';
import { PaymentForm } from '@/components/settings/branch-options';
import { SettingsShell } from '@/components/settings/settings-shell';

// P-18: ödeme yöntemleri (04 §7.6).
export const metadata: Metadata = { title: 'Ödeme yöntemleri' };

export default function Page() {
  return (
    <SettingsShell title="Ödeme yöntemleri" description="Kapıda nakit, kart, yemek kartı ve kasada ödeme.">
      <PaymentForm />
    </SettingsShell>
  );
}
