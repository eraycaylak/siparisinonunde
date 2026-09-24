'use client';

import { useMemo, useState } from 'react';
import { History, Info, RotateCcw, UserRound } from 'lucide-react';
import type { StorefrontView, StoreSessionView } from '@siparis/core/menu/contracts';
import { Alert } from '@/components/ui/alert';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney } from '@/lib/format';
import { brandButtonClass } from './brand';
import { planReorder, type ReorderPlan } from './menu-logic';

/** Akış A bağlamı: "Merhaba Ayşe · Ben değilim" (03 §3.1 adım 4). Süresi dolmuş bağlantıda bilgi bandı. */
export function CustomerGreeting({ session, onForget, forgetting }: { session: StoreSessionView; onForget: () => void; forgetting: boolean }) {
  if (session.linkStatus === 'expired') {
    return (
      <Alert variant="info" title="Bağlantının süresi dolmuş">
        Sipariş verebilirsiniz; son adımda WhatsApp&apos;tan tek dokunuşla onaylayacaksınız.
      </Alert>
    );
  }
  if (!session.customer) return null;
  const { name, phoneMasked } = session.customer;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-[var(--brand-subtle)] px-3 py-2">
      <UserRound aria-hidden className="size-5 shrink-0 text-fg" />
      <p className="min-w-0 flex-1 text-base text-fg">
        <span className="font-semibold">Merhaba{name ? ` ${name}` : ''}</span>
        {phoneMasked ? <span className="block text-sm text-fg-muted">WhatsApp · {phoneMasked}</span> : null}
      </p>
      <button
        type="button"
        onClick={onForget}
        disabled={forgetting}
        className="min-h-hit-sf shrink-0 rounded-md px-2 text-sm font-semibold text-fg underline underline-offset-4 disabled:opacity-50"
      >
        Ben değilim
      </button>
    </div>
  );
}

export interface LastOrderCardProps {
  lastOrder: NonNullable<StoreSessionView['lastOrder']>;
  source: StoreSessionView['lastOrderSource'];
  store: StorefrontView;
  acceptsOrders: boolean;
  onReorder: (plan: ReorderPlan) => void;
  onForgetDevice: () => void;
}

/** "Son siparişin" kartı (03 §3.4): tarih, ilk 3 kalem, güncel tutar, "Aynısından tekrar". */
export function LastOrderCard({ lastOrder, source, store, acceptsOrders, onReorder, onForgetDevice }: LastOrderCardProps) {
  const plan = useMemo(() => planReorder(lastOrder, store), [lastOrder, store]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const shown = lastOrder.items.slice(0, 3);
  const more = lastOrder.items.length - shown.length;

  const run = () => {
    if (plan.notices.length) setNoticeOpen(true);
    else onReorder(plan);
  };

  return (
    <section aria-labelledby="son-siparis" className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4 shadow-sm">
      <h2 id="son-siparis" className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-fg-muted">
        <History aria-hidden className="size-4" />
        Son siparişin · {formatDate(lastOrder.createdAt)}
      </h2>
      <p className="break-words text-base text-fg">
        {shown.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
        {more > 0 ? ` ve ${more} ürün daha` : ''}
      </p>
      {plan.lines.length ? (
        <p className="text-sm text-fg-muted">
          Güncel tutar <span className="font-bold text-fg tabular-nums">{formatMoney(plan.totalKurus)}</span>
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-fg-muted">
          <Info aria-hidden className="size-4 shrink-0" />
          Bu siparişteki ürünler şu an satışta değil.
        </p>
      )}
      {plan.lines.length && acceptsOrders ? (
        <button type="button" onClick={run} className={cn(brandButtonClass, 'min-h-hit self-stretch text-base sm:self-end')}>
          <RotateCcw aria-hidden className="size-5" />
          Aynısından tekrar
        </button>
      ) : null}
      {source === 'device' ? (
        <button type="button" onClick={onForgetDevice} className="min-h-hit-sf self-start text-sm text-fg-muted underline underline-offset-4">
          Bu cihazı unut
        </button>
      ) : null}
      <Dialog
        open={noticeOpen}
        onOpenChange={setNoticeOpen}
        title="Sepetiniz güncellendi"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNoticeOpen(false)}>
              Menüye dön
            </Button>
            <Button
              onClick={() => {
                setNoticeOpen(false);
                onReorder(plan);
              }}
            >
              Devam et
            </Button>
          </>
        }
      >
        <ul className="flex list-disc flex-col gap-1 ps-5 text-base">
          {plan.notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Dialog>
    </section>
  );
}
