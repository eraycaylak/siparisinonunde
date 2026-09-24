import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PanelShell } from '@/components/panel/panel-shell';

export const metadata: Metadata = {
  title: { default: 'İşletme paneli', template: '%s · Panel' },
  robots: { index: false, follow: false },
};

/** /panel/* düzeni: oturum koruması ve rol bazlı menü PanelShell'dedir (giris/kayit hariç). */
export default function PanelLayout({ children }: { children: ReactNode }) {
  return <PanelShell>{children}</PanelShell>;
}
