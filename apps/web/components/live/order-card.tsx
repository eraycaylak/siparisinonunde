'use client';

// Canlı ekran sipariş kartı (04 §4.4, §4.6, §4.8): tek birincil buton, süre çipleri, ret, durum ilerletme.

import { useState } from 'react';
import { AlertTriangle, BellRing, Ellipsis, Hourglass, MessageSquareWarning, PhoneCall, Printer, StickyNote, Timer, Undo2 } from 'lucide-react';
import type { OrderCard } from '@siparis/core/orders/contracts';
import { Badge, Button, ChannelBadge, FulfillmentBadge, IconButton, StatusBadge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatElapsed, formatMoney, formatTime } from '@/lib/format';
import { autoPrintKinds, openReceipt } from '@/components/orders/api';
import { changeText, paymentShort, rejectLabel } from '@/components/orders/labels';
import { OrderItems } from '@/components/orders/order-items';
import { useOrderSheets } from '@/components/orders/order-sheets';

const ETA_OPTIONS = [15, 20, 30, 45, 60];

export interface OrderCardProps {
  card: OrderCard;
  now: number;
  usePreparingStep: boolean;
  alarming: boolean;
  onSeen?: (id: string) => void;
  autoPrint?: boolean;
  /** Şube fiş ayarı: onayda hangi fişler basılır */
  printPlan?: { printKitchen: boolean; printDelivery: boolean };
  offline?: boolean;
}

function elapsedFrom(card: OrderCard): string {
  if (card.status === 'new') return card.verifiedAt ?? card.placedAt;
  return card.acceptedAt ?? card.placedAt;
}

export function OrderCardView({ card, now, usePreparingStep, alarming, onSeen, autoPrint, printPlan, offline }: OrderCardProps) {
  const { role, actions, openSheet, openDetail, scheduleAdvance, pendingAdvance } = useOrderSheets();
  const [busy, setBusy] = useState<string | null>(null);
  const kitchen = role === 'kitchen';
  const staff = !kitchen;
  const since = Math.max(0, (now - new Date(elapsedFrom(card)).getTime()) / 1000);
  const late = card.status === 'new' && since >= 120;
  const pendingReject = card.status === 'new' && Boolean(card.rejectionScheduledAt);
  const rejectLeft = pendingReject ? Math.min(30, Math.max(0, Math.ceil((new Date(card.rejectionScheduledAt!).getTime() + 30_000 - now) / 1000))) : null;
  const overdue =
    card.estimatedReadyAt && ['accepted', 'preparing', 'ready'].includes(card.status) ? Math.floor((now - new Date(card.estimatedReadyAt).getTime()) / 60_000) : null;
  const eta = card.suggestedEtaMinutes ?? 20;
  const advancing = pendingAdvance(card.id);

  const accept = async (minutes: number) => {
    setBusy(`accept-${minutes}`);
    onSeen?.(card.id);
    try {
      await actions.accept(card.id, minutes, card.version);
      if (autoPrint) openReceipt(card.id, autoPrintKinds(printPlan, card.fulfillmentType));
    } catch {
      /* tost gösterildi */
    } finally {
      setBusy(null);
    }
  };

  const primary = (() => {
    if (card.status === 'new') {
      if (pendingReject) return null;
      return (
        <div className="flex flex-col gap-2">
          <Button size="xl" block variant="primary" disabled={offline} loading={busy === `accept-${eta}`} onClick={() => accept(eta)}>
            Onayla · {eta} dk
          </Button>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Farklı süreyle onayla">
            {ETA_OPTIONS.filter((m) => m !== eta)
              .slice(0, 4)
              .map((m) => (
                <Button key={m} variant="secondary" size="md" className="min-w-16 flex-1" disabled={offline || Boolean(busy)} onClick={() => accept(m)}>
                  {m} dk
                </Button>
              ))}
          </div>
        </div>
      );
    }
    if (advancing) return null;
    const go = (to: 'preparing' | 'ready' | 'on_the_way' | 'delivered', label: string) => (
      <Button size="xl" block variant={to === 'delivered' ? 'success' : 'primary'} disabled={offline} onClick={() => scheduleAdvance(card, to)}>
        {label}
      </Button>
    );
    switch (card.status) {
      case 'accepted':
        return usePreparingStep ? go('preparing', 'Hazırlanıyor') : go('ready', 'Hazır');
      case 'preparing':
        return go('ready', 'Hazır');
      case 'ready':
        if (kitchen) return null;
        if (card.fulfillmentType === 'delivery') {
          return (
            <Button size="xl" block disabled={offline} onClick={() => openSheet('courier', card)}>
              Yola çıkar
            </Button>
          );
        }
        return go('delivered', 'Teslim edildi');
      case 'on_the_way':
        return kitchen ? null : go('delivered', 'Teslim edildi');
      default:
        return null;
    }
  })();

  return (
    <article
      aria-label={`Sipariş ${card.number}`}
      onClickCapture={() => alarming && onSeen?.(card.id)}
      className={cn(
        'flex flex-col gap-3 rounded-lg border-2 bg-surface-raised p-3 shadow-sm',
        card.status === 'new' ? 'border-status-new-fg' : 'border-border',
        pendingReject && 'border-dashed',
      )}
      style={alarming ? { animation: 'so-card-blink 1s steps(1) infinite' } : undefined}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => openDetail(card.id)} className="min-h-hit rounded-md text-2xl font-extrabold tabular-nums underline-offset-4 hover:underline">
          #{card.number}
        </button>
        <ChannelBadge channel={card.channel} />
        <FulfillmentBadge type={card.fulfillmentType} />
        {card.testKind ? <Badge variant="warning">TEST</Badge> : null}
        <span
          className={cn(
            'ms-auto inline-flex items-center gap-1 text-lg font-bold tabular-nums',
            late ? 'text-status-new-fg' : 'text-fg-muted',
          )}
          aria-label={`Geçen süre ${formatElapsed(since)}`}
        >
          {late ? <AlertTriangle aria-hidden className="size-5" /> : <Timer aria-hidden className="size-5" />}
          {formatElapsed(since)}
        </span>
      </header>

      {!kitchen ? (
        <div className="flex flex-wrap items-center gap-2 text-base">
          <span className="font-semibold">{card.customerName ?? `Müşteri ${card.customerPhoneMasked?.slice(-5) ?? ''}`}</span>
          {card.customerOrderCount != null ? (
            <Badge variant={card.customerOrderCount > 1 ? 'info' : 'neutral'} size="sm">
              {card.customerOrderCount > 1 ? `${card.customerOrderCount}. sipariş` : 'Yeni müşteri'}
            </Badge>
          ) : null}
          {card.customerBlocked ? (
            <Badge variant="danger" size="sm">
              <AlertTriangle aria-hidden className="size-3.5" /> Şüpheli
            </Badge>
          ) : null}
          <span className="text-fg-muted">
            {card.fulfillmentType === 'delivery' ? (card.neighborhood ? `${card.neighborhood}` : 'Adres') : 'Gel-al'}
          </span>
        </div>
      ) : null}

      <OrderItems items={card.items} max={kitchen ? undefined : 3} large={kitchen} />

      {card.note ? (
        <p className="flex items-start gap-1 rounded-sm bg-note px-2 py-1 text-sm font-semibold text-note-fg">
          <StickyNote aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="line-clamp-2">{card.note}</span>
        </p>
      ) : null}

      {!kitchen && card.totalKurus != null ? (
        <p className="text-base">
          <span className="font-bold tabular-nums">{formatMoney(card.totalKurus)}</span>
          <span className="text-fg-muted"> · {paymentShort(card.paymentMethod, card.mealCardBrand)}</span>
          {changeText(card.totalKurus, card.changeForKurus) ? <span className="block text-sm text-fg-muted">{changeText(card.totalKurus, card.changeForKurus)}</span> : null}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {pendingReject && rejectLeft != null ? <StatusBadge status="new" pendingRejectSeconds={rejectLeft} detail={rejectLabel(card.rejectionReason)} /> : null}
        {card.status === 'accepted' || card.status === 'preparing' || card.status === 'ready' ? (
          <StatusBadge status={card.status} size="sm" detail={card.estimatedReadyAt ? `Hedef ${formatTime(card.estimatedReadyAt)}` : null} />
        ) : null}
        {card.status === 'on_the_way' ? <StatusBadge status="on_the_way" size="sm" detail={card.courierName ?? (card.onTheWayAt ? formatTime(card.onTheWayAt) : null)} /> : null}
        {overdue != null && overdue > 0 ? (
          <Badge variant="danger" size="sm">
            <Hourglass aria-hidden className="size-3.5" /> Süre aşıldı · +{overdue} dk
          </Badge>
        ) : null}
        {card.status === 'new' && card.firstAckedAt == null && !pendingReject ? (
          <Badge variant="danger" size="sm">
            <BellRing aria-hidden className="size-3.5" /> Görülmedi
          </Badge>
        ) : null}
        {card.status === 'new' && (card.alarmStep ?? 0) >= 3 ? (
          <Badge variant="warning" size="sm">
            {(card.alarmStep ?? 0) >= 5 ? 'Müşteriye bilgi verildi · Bekliyor' : (card.alarmStep ?? 0) >= 4 ? 'SMS gönderildi' : 'Sahibine bildirildi'}
          </Badge>
        ) : null}
        {card.cancelRequestId ? (
          <Badge variant="warning" size="sm">
            <MessageSquareWarning aria-hidden className="size-3.5" /> Müşteri iptal istiyor
          </Badge>
        ) : null}
        {card.courierName && card.status !== 'on_the_way' ? (
          <Badge variant="neutral" size="sm">
            Kurye: {card.courierName}
          </Badge>
        ) : null}
      </div>

      {pendingReject ? (
        <Button variant="secondary" size="lg" block disabled={kitchen} onClick={() => void actions.undoReject(card.id).catch(() => undefined)}>
          <Undo2 aria-hidden /> Geri al · {rejectLeft} sn
        </Button>
      ) : null}

      {primary}

      <footer className="mt-1 flex items-center gap-2 border-t border-border pt-2">
        {staff && card.status === 'new' && !pendingReject ? (
          <Button variant="ghost" size="md" className="text-destructive" onClick={() => openSheet('reject', card)}>
            Reddet
          </Button>
        ) : null}
        {card.cancelRequestId && staff ? (
          <Button variant="secondary" size="md" onClick={() => openDetail(card.id)}>
            <PhoneCall aria-hidden /> İptal talebi
          </Button>
        ) : null}
        <span className="ms-auto flex gap-1">
          <IconButton label="Mutfak fişi yazdır" icon={<Printer />} onClick={() => openReceipt(card.id, 'kitchen')} />
          <IconButton label="Diğer işlemler ve ayrıntı" icon={<Ellipsis />} onClick={() => openDetail(card.id)} />
        </span>
      </footer>
    </article>
  );
}

/** Kart yanıp sönme animasyonu (azaltılmış harekette global CSS süreyi sıfırlar). */
export function CardBlinkStyle() {
  return <style>{`@keyframes so-card-blink { 0% { box-shadow: 0 0 0 4px var(--status-new-fg); } 50% { box-shadow: none; } }`}</style>;
}
