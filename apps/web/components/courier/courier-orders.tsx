'use client';

// Kurye görünümü (K-02/K-03, 04 §9.2): atanmış siparişler, adres + tarif, harita bağlantıları, müşteriyi ara,
// ödeme tipi + tahsilat + para üstü, "Yola çıktım" / "Teslim ettim" / "Teslim edilemedi". SSE yok: 30 sn yoklama.
// Teslim 5 sn "Geri al" penceresinden sonra gönderilir (yanlışlıkla basılan teslim geri alınabilsin).

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bike, ChevronDown, ChevronUp, MapPin, Package, PackageX, Phone, RefreshCw } from 'lucide-react';
import type { CourierOrder, CourierOrdersResponse } from '@siparis/core/orders/contracts';
import type { MealCardBrand, OrderStatus } from '@siparis/core/enums';
import type { DeliveryFailureReason } from '@siparis/core/orders/delivery';
import { Alert, Button, ConfirmUndoBar, EmptyState, IconButton, Spinner, StatusBadge, UndoBarRegion } from '@/components/ui';
import { apiFetch, errorMessage, useApiQuery } from '@/lib/api';
import { formatMoney, formatRelative, formatTime } from '@/lib/format';
import { mapLinks, paymentCourierLabel, telHref } from '@/components/orders/labels';
import { OrderItems } from '@/components/orders/order-items';
import { DeliverSheet, UndeliverableSheet } from './courier-deliver';
import { canReportUndeliverable, deliverBody, deliveryFailureText, DELIVER_UNDO_MS, type DeliverMode } from './courier-logic';

const KEY = ['courier', 'orders'] as const;

interface PendingDeliver {
  order: CourierOrder;
  body: Record<string, string>;
  deadline: number;
}

export function CourierOrders() {
  const qc = useQueryClient();
  const q = useApiQuery<CourierOrdersResponse>(KEY, '/courier/orders', { refetchInterval: 30_000, refetchIntervalInBackground: true, staleTime: 5_000 });
  const [open, setOpen] = useState<string | null>(null);
  const [deliver, setDeliver] = useState<CourierOrder | null>(null);
  const [failed, setFailed] = useState<CourierOrder | null>(null);
  const [pending, setPending] = useState<PendingDeliver[]>([]);

  const schedule = useCallback((order: CourierOrder, mode: DeliverMode, brand: MealCardBrand | '') => {
    setPending((list) => [...list.filter((p) => p.order.id !== order.id), { order, body: deliverBody(mode, brand), deadline: Date.now() + DELIVER_UNDO_MS }]);
    setDeliver(null);
  }, []);

  const commit = useCallback(
    async (p: PendingDeliver) => {
      setPending((list) => list.filter((x) => x !== p));
      try {
        await apiFetch(`/courier/orders/${p.order.id}/delivered`, { method: 'POST', body: p.body });
        toast.success(`#${p.order.number} teslim edildi.`);
      } catch (e) {
        toast.error(errorMessage(e));
      }
      await qc.invalidateQueries({ queryKey: KEY });
    },
    [qc],
  );

  const reportFailure = useCallback(
    async (order: CourierOrder, body: { reason: DeliveryFailureReason; note?: string }) => {
      await apiFetch(`/courier/orders/${order.id}/undeliverable`, { method: 'POST', body });
      toast.success(`#${order.number} için işletmeye bildirildi.`);
      await qc.invalidateQueries({ queryKey: KEY });
    },
    [qc],
  );

  if (q.isPending) return <Spinner label="Siparişler yükleniyor" />;
  if (q.isError) {
    return (
      <Alert variant="danger" title="Siparişler yüklenemedi" action={<Button onClick={() => void q.refetch()}>Tekrar dene</Button>}>
        {errorMessage(q.error)}
      </Alert>
    );
  }
  const items = q.data?.items ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold">Bugün {q.data?.deliveredToday ?? 0} teslimat</h1>
        <IconButton className="ms-auto" label="Yenile" icon={<RefreshCw />} onClick={() => void q.refetch()} />
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Package} title="Size atanmış sipariş yok" description="İşletme sipariş atadığında burada görünür. Liste 30 saniyede bir yenilenir." />
      ) : null}
      {items.map((o) => (
        <CourierCard
          key={o.id}
          order={o}
          open={open === o.id}
          onToggle={() => setOpen(open === o.id ? null : o.id)}
          onDeliver={() => setDeliver(o)}
          onFailed={() => setFailed(o)}
          delivering={pending.some((p) => p.order.id === o.id)}
        />
      ))}
      <DeliverSheet order={deliver} onClose={() => setDeliver(null)} onConfirm={schedule} />
      <UndeliverableSheet order={failed} onClose={() => setFailed(null)} onSubmit={reportFailure} />
      <UndoBarRegion>
        {pending.map((p) => (
          <ConfirmUndoBar
            key={`del-${p.order.id}-${p.deadline}`}
            tone="neutral"
            message={`#${p.order.number} teslim edildi olarak işaretlendi`}
            deadline={p.deadline}
            seconds={DELIVER_UNDO_MS / 1000}
            onUndo={() => setPending((list) => list.filter((x) => x !== p))}
            onExpire={() => void commit(p)}
          />
        ))}
      </UndoBarRegion>
    </div>
  );
}

function CourierCard({
  order: o,
  open,
  onToggle,
  onDeliver,
  onFailed,
  delivering,
}: {
  order: CourierOrder;
  open: boolean;
  onToggle: () => void;
  onDeliver: () => void;
  onFailed: () => void;
  /** 5 sn "Geri al" penceresi sürerken butonlar kapalı. */
  delivering: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const address = [o.neighborhood ? `${o.neighborhood} Mah.` : null, o.addressLine].filter(Boolean).join(', ');
  const maps = mapLinks({ lat: o.lat, lng: o.lng, address: `${address}, Yozgat` });
  const onTheWay = o.status === 'on_the_way';
  const preparing = o.status === 'preparing';
  const failureText = deliveryFailureText(o.lastDeliveryFailure, o.deliveryAttempts);

  const goOut = async () => {
    setBusy(true);
    try {
      await apiFetch(`/courier/orders/${o.id}/on-the-way`, { method: 'POST' });
      toast.success(`#${o.number} yolda.`);
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      toast.error(errorMessage(e));
      await qc.invalidateQueries({ queryKey: KEY });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 text-start">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xl font-extrabold tabular-nums">
            #{o.number} · {o.neighborhood ?? 'Adres'}
          </span>
          <span className="text-base font-bold">
            {paymentCourierLabel(o.paymentMethod, o.mealCardBrand)} {formatMoney(o.totalKurus)}
            {o.changeKurus ? ` · ${formatMoney(o.changeForKurus!)}'ye ${formatMoney(o.changeKurus)} üstü` : ''}
          </span>
          <span className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <StatusBadge status={o.status as OrderStatus} size="sm" />
            {onTheWay && o.onTheWayAt ? `${formatRelative(o.onTheWayAt)} çıktınız` : o.status === 'ready' ? 'Hazır · Sizi bekliyor' : o.estimatedReadyAt ? `Hedef ${formatTime(o.estimatedReadyAt)}` : ''}
          </span>
          {failureText ? <span className="text-sm font-bold text-destructive">{failureText}</span> : null}
        </span>
        {open ? <ChevronUp aria-hidden className="size-6" /> : <ChevronDown aria-hidden className="size-6" />}
      </button>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <p className="text-base font-semibold">{o.customerName ?? 'Müşteri'}</p>
          <p className="text-base">{address || '—'}</p>
          {o.directions ? <p className="rounded-md bg-note px-3 py-2 text-base font-bold text-note-fg">Tarif: {o.directions}</p> : null}
          <div className="grid grid-cols-3 gap-2">
            <a href={maps.google} target="_blank" rel="noreferrer" className="inline-flex min-h-hit items-center justify-center gap-1 rounded-md border border-border-strong text-sm font-semibold">
              <MapPin aria-hidden className="size-4" /> Google
            </a>
            <a href={maps.yandex} target="_blank" rel="noreferrer" className="inline-flex min-h-hit items-center justify-center rounded-md border border-border-strong text-sm font-semibold">
              Yandex
            </a>
            <a href={maps.apple} target="_blank" rel="noreferrer" className="inline-flex min-h-hit items-center justify-center rounded-md border border-border-strong text-sm font-semibold">
              Apple
            </a>
          </div>
          {o.customerPhone ? (
            <a href={telHref(o.customerPhone)} className="inline-flex min-h-hit-primary items-center justify-center gap-2 rounded-md border-2 border-primary text-lg font-bold">
              <Phone aria-hidden className="size-6" /> Müşteriyi ara
            </a>
          ) : null}
          <OrderItems items={o.items} />
          {o.note ? <p className="rounded-md bg-note px-3 py-2 text-base font-semibold text-note-fg">Not: {o.note}</p> : null}
          <p className="text-base">
            Tahsil: <strong>{formatMoney(o.totalKurus)}</strong> · {paymentCourierLabel(o.paymentMethod, o.mealCardBrand)}
            {o.changeKurus ? (
              <span className="block">
                Para üstü: {formatMoney(o.changeKurus)} ({formatMoney(o.changeForKurus!)}&apos;ye)
              </span>
            ) : null}
          </p>
        </div>
      ) : null}

      {onTheWay ? (
        <>
          <Button size="xl" block variant="success" onClick={onDeliver} disabled={delivering}>
            Teslim ettim
          </Button>
          {canReportUndeliverable(o) ? (
            <Button size="lg" block variant="secondary" onClick={onFailed} disabled={delivering}>
              <PackageX aria-hidden /> Teslim edilemedi
            </Button>
          ) : null}
          {o.lastDeliveryFailure ? (
            <p className="text-center text-sm text-fg-muted">
              İşletmeye bildirildi. {o.customerPhone ? 'Tekrar denemek için müşteriyi arayabilirsiniz.' : 'İşletmenin kararını bekleyin.'}
            </p>
          ) : null}
        </>
      ) : (
        <>
          {/* preparing → on_the_way geçişi yok (00 durum makinesi): mutfak "Hazır" deyince açılır */}
          {preparing ? <p className="text-center text-sm font-semibold text-fg-muted">Mutfakta hazırlanıyor. Hazır olunca yola çıkabilirsiniz.</p> : null}
          <Button size="xl" block onClick={goOut} loading={busy} disabled={o.fulfillmentType !== 'delivery' || preparing || delivering}>
            <Bike aria-hidden /> Yola çıktım
          </Button>
        </>
      )}
    </article>
  );
}
