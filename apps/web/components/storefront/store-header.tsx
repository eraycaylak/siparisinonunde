'use client';

import { Bike, Circle, Clock, Pause, Phone, ShoppingBasket, Store, Timer } from 'lucide-react';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { cn } from '@/lib/cn';
import { deliverySummary, type OrderingStatusText } from './format';

/** S-01 başlığı: kapak, logo, ad, durum rozeti (renk + ikon + kelime), teslimat özeti; kapalı/yoğun bandı (S-09). */
export function StoreHeader({ store, status }: { store: StorefrontView; status: OrderingStatusText }) {
  const phone = store.branch.phone ?? store.tenant.phone;
  const summary = deliverySummary(store);
  const StatusIcon = status.tone === 'open' ? Circle : status.tone === 'busy' ? Timer : store.branch.orderingState === 'paused' ? Pause : Clock;
  return (
    <header className="-mx-4 -mt-4 flex flex-col">
      {store.tenant.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={store.tenant.coverUrl} alt="" className="aspect-[1.91/1] max-h-56 w-full bg-surface object-cover" />
      ) : (
        <div aria-hidden className="h-16 w-full bg-[var(--brand)]" />
      )}
      <div className="flex items-start gap-3 px-4 pt-3">
        <div className="-mt-10 flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-bg bg-surface-raised shadow-md">
          {store.tenant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={store.tenant.logoUrl} alt={`${store.tenant.name} logosu`} className="size-full object-cover" />
          ) : (
            <Store aria-hidden className="size-7 text-[var(--brand-strong)]" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="break-words text-2xl font-bold leading-8 text-fg">{store.tenant.name}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 font-semibold',
                status.tone === 'open' ? 'text-status-ready-fg' : status.tone === 'busy' ? 'text-warning' : 'text-fg-muted',
              )}
            >
              <StatusIcon aria-hidden className={cn('size-3.5', status.tone === 'open' && 'fill-current')} />
              {status.label}
            </span>
            {status.detail ? <span className="text-fg-muted">· {status.detail}</span> : null}
          </p>
        </div>
        {phone ? (
          <a
            href={`tel:${phone}`}
            aria-label="İşletmeyi ara"
            title="İşletmeyi ara"
            className="inline-flex size-hit shrink-0 items-center justify-center rounded-full border border-border-strong text-fg hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Phone aria-hidden className="size-5" />
          </a>
        ) : null}
      </div>
      {summary.length ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-2 text-sm text-fg-muted" aria-label="Teslimat bilgisi">
          {summary.map((s) => {
            const Icon = s.kind === 'eta' ? Clock : s.kind === 'fee' ? Bike : s.kind === 'min' ? ShoppingBasket : Store;
            return (
              <li key={s.text} className="inline-flex items-center gap-1.5">
                <Icon aria-hidden className="size-4 shrink-0" />
                {s.text}
              </li>
            );
          })}
        </ul>
      ) : null}
      {status.band ? (
        <div
          role="status"
          className={cn(
            'mx-4 mt-3 flex items-start gap-2 rounded-md px-3 py-2.5 text-sm font-semibold',
            status.tone === 'busy' ? 'bg-band-warn text-band-warn-fg' : 'bg-surface text-fg ring-1 ring-border-strong',
          )}
        >
          <StatusIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{status.band}</span>
        </div>
      ) : null}
    </header>
  );
}
