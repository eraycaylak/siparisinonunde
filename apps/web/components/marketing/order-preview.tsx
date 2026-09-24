import { BellRing, CheckCheck } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * Ana sayfa görseli: panel sipariş kartı + müşteriye giden mesaj (HTML ile çizilir, fotoğraf yok).
 * Örnek veriler temsilidir.
 */
export function OrderPreview() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md select-none">
      <div className="rounded-xl border-2 border-status-new-fg bg-surface-raised p-5 shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <StatusBadge status="new" size="md" />
          <span className="text-2xl font-bold tabular-nums text-fg">#1051</span>
        </div>
        <p className="mt-3 text-sm text-fg-muted">WhatsApp · Paket servis · Kapıda nakit</p>
        <ul className="mt-3 space-y-1 text-base text-fg">
          <li>2 × Kıymalı pide (tam)</li>
          <li>1 × Mercimek çorbası</li>
          <li>2 × Ayran</li>
        </ul>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm text-fg-muted">Toplam</span>
          <span className="text-lg font-bold tabular-nums text-fg">485,00 TL</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {['20 dk', '30 dk', '45 dk'].map((t) => (
            <span
              key={t}
              className={
                t === '30 dk'
                  ? 'flex min-h-hit items-center justify-center rounded-md border-2 border-primary bg-accent text-sm font-bold text-fg'
                  : 'flex min-h-hit items-center justify-center rounded-md border border-border-strong text-sm font-semibold text-fg'
              }
            >
              {t}
            </span>
          ))}
        </div>
        <span className="mt-3 flex min-h-hit-primary items-center justify-center gap-2 rounded-md bg-primary text-lg font-bold text-primary-fg">
          <BellRing className="size-5" />
          Onayla · 30 dk
        </span>
      </div>
      <div className="-mt-4 ms-auto me-[-0.5rem] w-[85%] rotate-1 rounded-xl rounded-tr-sm border border-border bg-surface p-4 shadow-md sm:me-[-2rem]">
        <p className="text-xs font-semibold text-fg-muted">Müşteriye giden mesaj</p>
        <p className="mt-1 text-sm text-fg">
          Siparişiniz onaylandı. Tahmini teslim 20.35. Takip: bozok-pide.siparisinonunde.com/t/…
        </p>
        <p className="mt-2 flex items-center justify-end gap-1 text-xs text-fg-muted">
          20.05 <CheckCheck className="size-3.5" />
        </p>
      </div>
    </div>
  );
}
