'use client';

import { Bike, Circle, Clock, Pause, Phone, ShoppingBasket, Store, Timer } from 'lucide-react';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { ResponsiveImage } from '@/components/common/responsive-image';
import { cn } from '@/lib/cn';
import { deliverySummary, storeInitials, type OrderingStatusText } from './format';

/**
 * S-01 başlığı (12 §5.1): kapak (yoksa marka renginde geçişli alan), logo (yoksa baş harf amblemi), ad, durum etiketi
 * (renk + ikon + kelime), teslimat bilgisi etiketleri; kapalı/yoğun bandı (S-09).
 */
export function StoreHeader({ store, status }: { store: StorefrontView; status: OrderingStatusText }) {
  const phone = store.branch.phone ?? store.tenant.phone;
  const summary = deliverySummary(store);
  const StatusIcon = status.tone === 'open' ? Circle : status.tone === 'busy' ? Timer : store.branch.orderingState === 'paused' ? Pause : Clock;
  return (
    <header className="-mx-4 -mt-4 flex flex-col">
      {store.tenant.coverUrl ? (
        <div className="relative">
          {/* Sayfanın LCP adayı: tembel yüklenmez, yüksek öncelikle iner. Kutu genişliği kabuğun max-w-2xl'i (672 px). */}
          <ResponsiveImage
            url={store.tenant.coverUrl}
            alt=""
            sizes="(max-width: 672px) 100vw, 672px"
            priority
            className="aspect-[2/1] max-h-64 w-full bg-surface object-cover"
          />
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/25 to-transparent" />
        </div>
      ) : (
        <div
          aria-hidden
          className="relative h-28 w-full overflow-hidden sm:h-36"
          style={{ backgroundImage: 'linear-gradient(135deg, var(--brand) 0%, var(--brand-strong) 100%)' }}
        >
          {/* Hafif desen: düz renk bandı yerine dokulu kapak */}
          <div
            className="absolute inset-0 opacity-[0.14]"
            style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1.5px, transparent 0)', backgroundSize: '18px 18px' }}
          />
          <div className="absolute -right-10 -top-16 size-48 rounded-full bg-white/10" />
          <div className="absolute -bottom-20 left-1/3 size-40 rounded-full bg-black/10" />
        </div>
      )}

      <div className="px-4">
        <div className="relative z-[1] -mt-10 flex items-end justify-between gap-3">
          <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-4 border-bg bg-surface-raised shadow-md">
            {store.tenant.logoUrl ? (
              <ResponsiveImage url={store.tenant.logoUrl} alt={`${store.tenant.name} logosu`} sizes="80px" className="size-full object-cover" />
            ) : (
              <span
                aria-hidden
                className="flex size-full items-center justify-center bg-[var(--brand)] text-2xl font-extrabold tracking-tight text-[var(--brand-contrast)]"
              >
                {storeInitials(store.tenant.name)}
              </span>
            )}
          </div>
          {phone ? (
            <a
              href={`tel:${phone}`}
              aria-label="İşletmeyi ara"
              title="İşletmeyi ara"
              className="mb-1 inline-flex size-hit shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised text-fg shadow-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Phone aria-hidden className="size-5" />
            </a>
          ) : null}
        </div>

        <h1 className="mt-3 break-words text-2xl font-extrabold leading-tight tracking-tight text-fg sm:text-3xl">{store.tenant.name}</h1>

        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold',
              status.tone === 'open'
                ? 'bg-status-ready-bg text-status-ready-fg'
                : status.tone === 'busy'
                  ? 'bg-warning-bg text-warning'
                  : 'bg-surface text-fg-muted ring-1 ring-border',
            )}
          >
            <StatusIcon aria-hidden className={cn('size-3', status.tone === 'open' && 'fill-current')} />
            {status.label}
          </span>
          {status.detail ? <span className="text-fg-muted">{status.detail}</span> : null}
        </p>

        {summary.length ? (
          <ul className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Teslimat bilgisi">
            {summary.map((s) => {
              const Icon = s.kind === 'eta' ? Clock : s.kind === 'fee' ? Bike : s.kind === 'min' ? ShoppingBasket : Store;
              return (
                <li key={s.text} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface-raised px-3 py-1.5 text-[13px] font-medium text-fg">
                  <Icon aria-hidden className="size-4 shrink-0 text-[var(--brand-strong)]" />
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
              'mt-4 flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold',
              status.tone === 'busy' ? 'bg-band-warn text-band-warn-fg' : 'bg-surface text-fg ring-1 ring-border',
            )}
          >
            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', status.tone === 'busy' ? 'bg-black/10' : 'bg-bg')}>
              <StatusIcon aria-hidden className="size-4" />
            </span>
            <span>{status.band}</span>
          </div>
        ) : null}
      </div>
    </header>
  );
}
