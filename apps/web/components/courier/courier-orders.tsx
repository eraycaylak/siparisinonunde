'use client';

// Kurye görünümü (K-02/K-03, 04 §9.2): atanmış siparişler, adres + tarif, harita bağlantıları, müşteriyi ara,
// ödeme tipi + tahsilat + para üstü, "Yola çıktım" / "Teslim ettim". SSE yok: 30 sn yoklama.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bike, ChevronDown, ChevronUp, MapPin, Package, Phone, RefreshCw } from 'lucide-react';
import type { CourierOrder, CourierOrdersResponse } from '@siparis/core/orders/contracts';
import { MEAL_CARD_BRAND_LABELS, type MealCardBrand, type OrderStatus } from '@siparis/core/enums';
import { Alert, Button, EmptyState, IconButton, RadioGroup, Select, Sheet, Spinner, StatusBadge } from '@/components/ui';
import { apiFetch, errorMessage, useApiQuery } from '@/lib/api';
import { formatMoney, formatRelative, formatTime } from '@/lib/format';
import { mapLinks, paymentCourierLabel, telHref } from '@/components/orders/labels';
import { OrderItems } from '@/components/orders/order-items';

const KEY = ['courier', 'orders'] as const;

export function CourierOrders() {
  const q = useApiQuery<CourierOrdersResponse>(KEY, '/courier/orders', { refetchInterval: 30_000, refetchIntervalInBackground: true, staleTime: 5_000 });
  const [open, setOpen] = useState<string | null>(null);
  const [deliver, setDeliver] = useState<CourierOrder | null>(null);

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
        <CourierCard key={o.id} order={o} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} onDeliver={() => setDeliver(o)} />
      ))}
      <DeliverSheet order={deliver} onClose={() => setDeliver(null)} />
    </div>
  );
}

function CourierCard({ order: o, open, onToggle, onDeliver }: { order: CourierOrder; open: boolean; onToggle: () => void; onDeliver: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const address = [o.neighborhood ? `${o.neighborhood} Mah.` : null, o.addressLine].filter(Boolean).join(', ');
  const maps = mapLinks({ lat: o.lat, lng: o.lng, address: `${address}, Yozgat` });
  const onTheWay = o.status === 'on_the_way';
  const preparing = o.status === 'preparing';

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
        <Button size="xl" block variant="success" onClick={onDeliver}>
          Teslim ettim
        </Button>
      ) : (
        <>
          {/* preparing → on_the_way geçişi yok (00 durum makinesi): mutfak "Hazır" deyince açılır */}
          {preparing ? <p className="text-center text-sm font-semibold text-fg-muted">Mutfakta hazırlanıyor. Hazır olunca yola çıkabilirsiniz.</p> : null}
          <Button size="xl" block onClick={goOut} loading={busy} disabled={o.fulfillmentType !== 'delivery' || preparing}>
            <Bike aria-hidden /> Yola çıktım
          </Button>
        </>
      )}
    </article>
  );
}

/** Teslim + ödeme alt sayfası: "285 TL nakit alındı" (varsayılan) ya da "Farklı yöntemle ödendi". */
function DeliverSheet({ order: current, onClose }: { order: CourierOrder | null; onClose: () => void }) {
  const qc = useQueryClient();
  // Sheet hep bağlı kalır (yerel <dialog> açık/kapalı geçişi); kapanırken son sipariş gösterilir
  const [last, setLast] = useState<CourierOrder | null>(current);
  if (current && current !== last) setLast(current);
  const order = current ?? last;
  const [mode, setMode] = useState<'as_ordered' | 'card_on_delivery' | 'cash_on_delivery' | 'meal_card_on_delivery'>('as_ordered');
  const [brand, setBrand] = useState<MealCardBrand | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/courier/orders/${order.id}/delivered`, {
        method: 'POST',
        body: mode === 'as_ordered' ? {} : { paidWith: mode, ...(mode === 'meal_card_on_delivery' && brand ? { mealCardBrand: brand } : {}) },
      });
      toast.success(`#${order.number} teslim edildi.`);
      await qc.invalidateQueries({ queryKey: KEY });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      await qc.invalidateQueries({ queryKey: KEY });
    } finally {
      setBusy(false);
    }
  };
  const asOrdered = order ? `${formatMoney(order.totalKurus)} ${paymentCourierLabel(order.paymentMethod, order.mealCardBrand).toLocaleLowerCase('tr-TR')} alındı` : '';
  return (
    <Sheet
      open={Boolean(current)}
      onOpenChange={(o) => !o && onClose()}
      side="bottom"
      title={order ? `#${order.number} teslim` : 'Teslim'}
      footer={
        <Button size="xl" block variant="success" onClick={submit} loading={busy}>
          Teslim ettim
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <RadioGroup
          legend="Ödeme"
          value={mode}
          onValueChange={(v) => setMode(v as typeof mode)}
          options={[
            { value: 'as_ordered', label: asOrdered },
            { value: 'cash_on_delivery', label: 'Farklı yöntemle: nakit' },
            { value: 'card_on_delivery', label: 'Farklı yöntemle: kart' },
            { value: 'meal_card_on_delivery', label: 'Farklı yöntemle: yemek kartı' },
          ].filter((x) => x.value === 'as_ordered' || x.value !== order?.paymentMethod)}
        />
        {mode === 'meal_card_on_delivery' ? (
          <Select
            aria-label="Yemek kartı markası"
            value={brand}
            placeholder="Marka seçin"
            onChange={(e) => setBrand(e.target.value as MealCardBrand)}
            options={(Object.keys(MEAL_CARD_BRAND_LABELS) as MealCardBrand[]).map((b) => ({ value: b, label: MEAL_CARD_BRAND_LABELS[b] }))}
          />
        ) : null}
        {error ? <Alert variant="danger">{error}</Alert> : null}
      </div>
    </Sheet>
  );
}
