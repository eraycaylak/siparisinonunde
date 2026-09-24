'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Circle, Pause } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { OrderingStateBadge } from '@/components/ui/status-badge';
import { usePanelStream } from '@/components/panel/stream-provider';
import { cn } from '@/lib/cn';
import { currentBranchId, currentRole, useMe } from '@/lib/auth';
import { ORDERING_STATE_UI_LABELS } from '@/lib/labels';
import { OrderingStateControls, orderingDetail, useLiveBranchState, type LiveBranchState } from './ordering-state';

const DOT: Record<LiveBranchState['orderingState'], string> = {
  open: 'fill-status-ready-fg text-status-ready-fg',
  busy: 'fill-warning text-warning',
  paused: 'text-fg-muted',
  closed: 'fill-fg-muted text-fg-muted',
};

/**
 * Panel üst çubuğu sipariş alma durumu (04 §2.2, §4.10). Sahip/yönetici/kasiyer dokununca hızlı aksiyonlar açılır:
 * "Sipariş almayı durdur (15/30/60 dk / kapanışa kadar)" ve "Yoğunum (+10/+20 dk)". Mutfak yalnız durumu görür.
 */
export function OrderingQuickActions() {
  const me = useMe();
  const role = currentRole(me.data);
  const canControl = role === 'owner' || role === 'manager' || role === 'cashier';
  const branchId = currentBranchId(me.data);
  const live = useLiveBranchState(canControl ? branchId : null);
  const stream = usePanelStream();
  const [open, setOpen] = useState(false);
  const s: LiveBranchState | null = canControl ? live.state : (stream?.branchState ?? null);
  if (!s) return null;
  const detail = orderingDetail(s);
  const label = `Sipariş alma durumu: ${ORDERING_STATE_UI_LABELS[s.orderingState]}${detail ? ` (${detail})` : ''}`;

  if (!canControl) {
    return (
      <span className="hidden min-h-hit items-center px-2 sm:inline-flex" aria-label={label}>
        <OrderingStateBadge state={s.orderingState} detail={detail} />
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={label}
        className="inline-flex min-h-hit min-w-hit items-center justify-center rounded-md px-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="sm:hidden" aria-hidden>
          {s.orderingState === 'paused' ? <Pause className="size-5 text-fg-muted" /> : <Circle className={cn('size-4', DOT[s.orderingState])} />}
        </span>
        <OrderingStateBadge state={s.orderingState} detail={detail} className="hidden sm:inline-flex" />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Sipariş alma durumu" description="Yoğun ya da ara verdiğiniz zamanlarda buradan değiştirin.">
        <OrderingStateControls branchId={branchId} onDone={() => setOpen(false)} />
        {role !== 'cashier' ? (
          <Link href="/panel/ayarlar/sube" className="mt-4 inline-flex min-h-hit items-center text-sm font-semibold text-fg underline underline-offset-4" onClick={() => setOpen(false)}>
            Şube ayarları
          </Link>
        ) : null}
      </Sheet>
    </>
  );
}
