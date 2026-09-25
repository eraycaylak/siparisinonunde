'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, Download, Printer } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export interface RecoveryCodesPanelProps {
  codes: string[];
  /** Kullanıcı "kaydettim" deyip kapatınca: kodlar bellekten atılır, bir daha gösterilmez. */
  onDone: () => void;
}

const PRINT_ID = 'kurtarma-kodlari';

function codesText(codes: string[]): string {
  return [
    'Siparişin Önünde — iki adımlı doğrulama kurtarma kodları',
    'Her kod yalnız bir kez kullanılabilir. Kimseyle paylaşmayın.',
    '',
    ...codes,
    '',
  ].join('\n');
}

/**
 * Yeni kurtarma kodları (yalnız bir kez gösterilir): kopyala / yazdır / indir ve "kaydettim" onayı.
 * Kodlar sunucuda yalnız özet olarak saklanır; bu ekran kapanınca tekrar görülemez.
 */
export function RecoveryCodesPanel({ codes, onDone }: RecoveryCodesPanelProps) {
  const [saved, setSaved] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('Kodlar kopyalandı. Güvenli bir yere yapıştırın.');
    } catch {
      toast.error('Kopyalanamadı. Kodları elle yazın ya da yazdırın.');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([codesText(codes)], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'siparisinonunde-kurtarma-kodlari.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #${PRINT_ID}, #${PRINT_ID} * { visibility: visible !important; }
        #${PRINT_ID} { position: absolute !important; inset: 0 auto auto 0 !important; width: 100% !important; padding: 16mm !important; border: 0 !important; box-shadow: none !important; background: #fff !important; color: #000 !important; }
      }`}</style>
      <Alert variant="warning" title="Kurtarma kodlarınızı şimdi kaydedin" assertive>
        Bu kodlar yalnız şimdi gösterilir. Telefonunuzu kaybederseniz girişte doğrulama kodu yerine bunlardan birini
        yazarsınız; her kod bir kez çalışır. Kodları parola yöneticinize kaydedin ya da yazdırıp güvenli bir yerde saklayın;
        kimseyle paylaşmayın.
      </Alert>

      <div id={PRINT_ID} className="rounded-lg border border-border bg-surface p-4">
        <p className="mb-3 hidden text-base font-semibold print:block">Siparişin Önünde — kurtarma kodları (her biri bir kez kullanılır)</p>
        <ol className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2" aria-label="Kurtarma kodları">
          {codes.map((code) => (
            <li key={code} className="rounded-md bg-surface-raised px-3 py-2 text-center font-mono text-lg font-semibold tracking-wider text-fg">
              {code}
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copy()}>
          <Copy aria-hidden />
          Kopyala
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer aria-hidden />
          Yazdır
        </Button>
        <Button variant="secondary" onClick={download}>
          <Download aria-hidden />
          İndir (.txt)
        </Button>
      </div>

      <Checkbox label="Kodları güvenli bir yere kaydettim" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
      <Button size="lg" className="self-start" disabled={!saved} onClick={onDone}>
        Tamam
      </Button>
    </div>
  );
}
