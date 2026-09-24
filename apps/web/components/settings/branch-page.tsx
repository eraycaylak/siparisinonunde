'use client';

import { BranchForm } from './branch-form';
import { useBranchId } from './api';
import { OrderingStateControls } from './ordering-state';
import { Section, SettingsShell } from './settings-shell';

export function BranchPage() {
  const branchId = useBranchId();
  return (
    <SettingsShell title="Şube ve sipariş durumu" description="Adres, konum, teslim türleri ve hazırlık süresi; yoğun ve durdurma ayarı.">
      <Section title="Sipariş alma durumu" description="Üst çubuktaki durum göstergesinden de değiştirebilirsiniz." className="mb-4">
        <OrderingStateControls branchId={branchId} />
      </Section>
      <BranchForm />
    </SettingsShell>
  );
}
