'use client';

// Mutfak görünümü (P-41, 04 §10.1): fiyatsız; Onaylanan · Hazırlanıyor (adım açıksa) · Hazır (son 10 dk).
// Büyük sipariş no ve kalemler; [Hazırlanıyor] ve [HAZIR] (5 sn geri al).

import { ChefHat, StickyNote, Timer } from 'lucide-react';
import type { ActiveOrdersResponse, OrderCard } from '@siparis/core/orders/contracts';
import { Button, EmptyState, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatElapsed, formatTime, trUpper } from '@/lib/format';
import { OrderItems } from '@/components/orders/order-items';
import { useOrderSheets } from '@/components/orders/order-sheets';

export function KitchenBoard({
  data,
  loading,
  now,
  usePreparingStep,
}: {
  data: ActiveOrdersResponse | undefined;
  loading: boolean;
  now: number;
  usePreparingStep: boolean;
}) {
  const items = data?.items ?? [];
  const accepted = items.filter((c) => c.status === 'accepted');
  const preparing = items.filter((c) => c.status === 'preparing');
  const ready = items.filter((c) => c.status === 'ready' && (!c.readyAt || now - new Date(c.readyAt).getTime() < 10 * 60_000));
  const cols = [
    { key: 'accepted', title: 'Onaylanan', cards: accepted },
    ...(usePreparingStep ? [{ key: 'preparing', title: 'Hazırlanıyor', cards: preparing }] : []),
    { key: 'ready', title: 'Hazır', cards: ready },
  ];
  if (loading) return <Spinner label="Siparişler yükleniyor" />;
  if (!accepted.length && !preparing.length && !ready.length) {
    return <EmptyState icon={ChefHat} title="Hazırlanacak sipariş yok" description="Onaylanan siparişler burada görünür." />;
  }
  return (
    <div className={cn('grid gap-4', usePreparingStep ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
      {cols.map((col) => (
        <section key={col.key} aria-label={col.title} className="flex flex-col gap-3">
          <h2 className="text-base font-bold uppercase tracking-wide text-fg-muted">
            {col.title} ({col.cards.length})
          </h2>
          {col.cards.map((c) => (
            <KitchenCard key={c.id} card={c} now={now} usePreparingStep={usePreparingStep} />
          ))}
        </section>
      ))}
    </div>
  );
}

function KitchenCard({ card, now, usePreparingStep }: { card: OrderCard; now: number; usePreparingStep: boolean }) {
  const { scheduleAdvance, pendingAdvance } = useOrderSheets();
  const since = Math.max(0, (now - new Date(card.acceptedAt ?? card.placedAt).getTime()) / 1000);
  const pending = pendingAdvance(card.id);
  return (
    <article className="flex flex-col gap-3 rounded-lg border-2 border-border bg-surface-raised p-4">
      <header className="flex items-center gap-3">
        <span className="text-4xl font-extrabold tabular-nums">#{card.number}</span>
        <span className="rounded-md bg-surface px-2 py-1 text-base font-bold">{trUpper(card.fulfillmentType === 'delivery' ? 'Paket' : 'Gel-al')}</span>
        <span className="ms-auto flex flex-col items-end text-base font-semibold tabular-nums text-fg-muted">
          <span className="inline-flex items-center gap-1">
            <Timer aria-hidden className="size-5" /> {formatElapsed(since)}
          </span>
          {card.estimatedReadyAt ? <span>Hedef {formatTime(card.estimatedReadyAt)}</span> : null}
        </span>
      </header>
      <OrderItems items={card.items} large />
      {card.note ? (
        <p className="flex items-start gap-2 rounded-md bg-note px-3 py-2 text-lg font-semibold text-note-fg">
          <StickyNote aria-hidden className="mt-1 size-5 shrink-0" /> {card.note}
        </p>
      ) : null}
      {pending ? null : card.status === 'accepted' && usePreparingStep ? (
        <Button size="xl" block variant="secondary" onClick={() => scheduleAdvance(card, 'preparing')}>
          Hazırlanıyor
        </Button>
      ) : null}
      {pending || card.status === 'ready' ? null : (
        <Button size="xl" block onClick={() => scheduleAdvance(card, 'ready')}>
          HAZIR
        </Button>
      )}
    </article>
  );
}
