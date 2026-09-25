'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui';

/** Yasal metni yazdır / PDF olarak kaydet (tarayıcının yazdırma penceresi). Yazdırılan sayfada görünmez. */
export function PrintButton() {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden />
      Yazdır
    </Button>
  );
}
