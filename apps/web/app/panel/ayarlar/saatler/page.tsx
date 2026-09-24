import type { Metadata } from 'next';
import { HoursEditor } from '@/components/settings/hours-editor';
import { SettingsShell } from '@/components/settings/settings-shell';
import { SpecialDays } from '@/components/settings/special-days';

// P-16: haftalık saatler ve özel günler (04 §7.3).
export const metadata: Metadata = { title: 'Çalışma saatleri' };

export default function Page() {
  return (
    <SettingsShell title="Çalışma saatleri" description="Haftalık saatler, gece yarısını aşan kapanış ve özel günler.">
      <div className="flex flex-col gap-4">
        <HoursEditor />
        <SpecialDays />
      </div>
    </SettingsShell>
  );
}
