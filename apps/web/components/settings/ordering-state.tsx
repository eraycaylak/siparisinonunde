'use client';

// Sipariş alma durumu (04 §4.10): duraklat 15/30/60 dk / kapanışa kadar, yoğun +10/+20 dk, normale dön.
// İlk durum GET /panel/branches/:id'den, sonrakiler 'branch.state' SSE olayından ve aksiyon yanıtından gelir.

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock3, Hourglass, Pause, Play } from 'lucide-react';
import type { BranchState } from '@siparis/core/settings/contracts';
import type { OrderingState } from '@siparis/core';
import { Button } from '@/components/ui/button';
import { OrderingStateBadge } from '@/components/ui/status-badge';
import { usePanelEvent, usePanelStream } from '@/components/panel/stream-provider';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { SETTINGS_KEYS, pauseBranch, setBranchBusy, useBranchSettings } from './api';

export interface LiveBranchState {
  orderingState: OrderingState;
  pausedUntil: string | null;
  busyExtraMinutes: number;
  nextOpenAt: string | null;
}

/** Canlı şube durumu (sorgu + SSE + aksiyon yanıtı) ve aksiyonlar. */
export function useLiveBranchState(branchId: string | null) {
  const q = useBranchSettings(branchId);
  const stream = usePanelStream();
  const qc = useQueryClient();
  const [state, setState] = useState<LiveBranchState | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (q.data) setState(pick(q.data.state));
  }, [q.data]);

  usePanelEvent(['branch.state'], (e) => setState(pick(e.data as LiveBranchState)));

  // Sağlayıcı ilk yüklemede son olayı tutuyorsa onu kullan
  useEffect(() => {
    if (stream?.branchState) setState((s) => s ?? pick(stream.branchState as LiveBranchState));
  }, [stream?.branchState]);

  // Duraklatma süresi dolunca tazele (sunucu olay yollamaz; durum hesaplanır)
  const refetch = q.refetch;
  useEffect(() => {
    if (state?.orderingState !== 'paused' || !state.pausedUntil) return;
    const ms = Date.parse(state.pausedUntil) - Date.now() + 1500;
    if (ms > 2_147_000_000) return;
    const t = window.setTimeout(() => void refetch(), Math.max(1000, ms));
    return () => window.clearTimeout(t);
  }, [state?.orderingState, state?.pausedUntil, refetch]);

  const run = useCallback(
    async (key: string, fn: () => Promise<BranchState>, success: string) => {
      if (!branchId) return;
      setPending(key);
      try {
        const next = await fn();
        setState(pick(next));
        void qc.invalidateQueries({ queryKey: SETTINGS_KEYS.branch(branchId) });
        toast.success(success);
      } catch (err) {
        toast.error(errorMessage(err, 'Durum değiştirilemedi.'));
      } finally {
        setPending(null);
      }
    },
    [branchId, qc],
  );

  return {
    state,
    loading: q.isPending,
    error: q.error,
    pending,
    pause: (minutes: number | 'until_close') =>
      run(`pause:${minutes}`, () => pauseBranch(branchId!, minutes), minutes === 'until_close' ? 'Sipariş alma kapanışa kadar durduruldu.' : `Sipariş alma ${minutes} dk durduruldu.`),
    resume: () =>
      run('resume', async () => {
        const s = await pauseBranch(branchId!, null);
        return s.busyExtraMinutes ? setBranchBusy(branchId!, 0) : s;
      }, 'Sipariş alma yeniden açıldı.'),
    busy: (extra: number) => run(`busy:${extra}`, () => setBranchBusy(branchId!, extra), extra ? `Yoğun mod: süreler +${extra} dk.` : 'Yoğun mod kapatıldı.'),
  };
}

function pick(s: LiveBranchState): LiveBranchState {
  return { orderingState: s.orderingState, pausedUntil: s.pausedUntil, busyExtraMinutes: s.busyExtraMinutes, nextOpenAt: s.nextOpenAt };
}

export function orderingDetail(s: LiveBranchState): string | null {
  if (s.orderingState === 'busy' && s.busyExtraMinutes > 0) return `+${s.busyExtraMinutes} dk`;
  if (s.orderingState === 'paused' && s.pausedUntil) return `${formatTime(s.pausedUntil)}’e kadar`;
  if (s.orderingState === 'closed' && s.nextOpenAt) return `${formatTime(s.nextOpenAt)}’de açılır`;
  return null;
}

const PAUSE_OPTIONS: { value: number | 'until_close'; label: string }[] = [
  { value: 15, label: '15 dk' },
  { value: 30, label: '30 dk' },
  { value: 60, label: '60 dk' },
  { value: 'until_close', label: 'Kapanışa kadar' },
];
const BUSY_OPTIONS = [10, 20];

/** Durum kartı içeriği: rozet + durdur + yoğun + normale dön. */
export function OrderingStateControls({ branchId, onDone }: { branchId: string | null; onDone?: () => void }) {
  const live = useLiveBranchState(branchId);
  const s = live.state;
  const after = (p: Promise<void>) => void p.then(() => onDone?.());
  if (!s) return <p className="text-sm text-fg-muted">{live.error ? errorMessage(live.error) : 'Durum yükleniyor…'}</p>;
  const abnormal = s.orderingState === 'paused' || s.busyExtraMinutes > 0;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <OrderingStateBadge state={s.orderingState} detail={orderingDetail(s)} className="text-base" />
        {abnormal ? (
          <Button variant="success" onClick={() => after(live.resume())} loading={live.pending === 'resume'} className="ms-auto">
            <Play aria-hidden />
            Normale dön
          </Button>
        ) : null}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
          <Pause aria-hidden className="size-4" />
          Sipariş almayı durdur
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PAUSE_OPTIONS.map((o) => (
            <Button key={String(o.value)} variant="secondary" size="lg" onClick={() => after(live.pause(o.value))} loading={live.pending === `pause:${o.value}`}>
              {o.value === 'until_close' ? <Clock3 aria-hidden /> : null}
              {o.label}
            </Button>
          ))}
        </div>
        <p className="text-sm text-fg-muted">Süre bitince sipariş alma kendiliğinden açılır. Bu sürede mağaza ve bot sipariş almaz.</p>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
          <Hourglass aria-hidden className="size-4" />
          Yoğunum
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {BUSY_OPTIONS.map((m) => (
            <Button
              key={m}
              variant={s.busyExtraMinutes === m ? 'primary' : 'secondary'}
              size="lg"
              aria-pressed={s.busyExtraMinutes === m}
              onClick={() => after(live.busy(m))}
              loading={live.pending === `busy:${m}`}
            >
              +{m} dk
            </Button>
          ))}
          {s.busyExtraMinutes > 0 ? (
            <Button variant="ghost" size="lg" onClick={() => after(live.busy(0))} loading={live.pending === 'busy:0'}>
              Yoğun modu kapat
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-fg-muted">Sipariş alınmaya devam eder; müşteriye uzatılmış süre gösterilir.</p>
      </fieldset>
    </div>
  );
}
