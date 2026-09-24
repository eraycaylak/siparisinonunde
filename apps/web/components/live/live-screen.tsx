'use client';

// Canlı sipariş ekranı (P-04, 04 §4): tablet yatay öncelikli kanban, telefonda sekmeli; yeni siparişte döngüsel
// alarm + yanıp sönen kart + sekme başlığında sayaç; 'order.alarm' olayında ses yükselir; SSE panel kabuğunun tek
// bağlantısından (usePanelEvent); 45 sn emniyet sorgusu; ekranda görünen yeni sipariş ack'lenir.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BellOff, BellRing, CheckCheck, ChevronDown, ChevronUp, ClipboardList, Hourglass, PhoneCall, Plus, Printer, Volume2, VolumeX } from 'lucide-react';
import { SAFETY_POLL_INTERVAL_MS, type OrderAlarmPayload } from '@siparis/core/contracts/events';
import type { ActiveOrdersResponse, OrderCard } from '@siparis/core/orders/contracts';
import { Banner, Button, EmptyState, Spinner, StatusBadge, Switch, buttonVariants } from '@/components/ui';
import { STREAM_RECONNECTED, usePanelEvent, usePanelStream } from '@/components/panel/stream-provider';
import { useApiQuery } from '@/lib/api';
import { currentRole, useMe } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatMoney, formatTime } from '@/lib/format';
import { ORDERS_ACTIVE_KEY, applySummary, isOrderEventPayload, orderActions, orderDetailKey } from '@/components/orders/api';
import { OrderSheetsProvider, useOrderSheets } from '@/components/orders/order-sheets';
import { alarmSound, ScreenWake } from './alarm-sound';
import { KitchenBoard } from './kitchen-board';
import { CardBlinkStyle, OrderCardView } from './order-card';
import { ShiftStart } from './shift-start';
import { useNow } from './use-now';

const AUTO_PRINT_KEY = 'siparisinonunde:auto-print';
const DEVICE_LABEL_KEY = 'siparisinonunde:device-label';

function readPref(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function LiveScreen() {
  const me = useMe();
  const role = currentRole(me.data);
  if (!me.data || !role) return <Spinner label="Yükleniyor" />;
  return (
    <OrderSheetsProvider role={role}>
      <LiveInner businessName={me.data.tenant?.name ?? 'İşletme'} kitchen={role === 'kitchen'} />
    </OrderSheetsProvider>
  );
}

type ColumnKey = 'new' | 'accepted' | 'preparing' | 'ready' | 'on_the_way';

function LiveInner({ businessName, kitchen }: { businessName: string; kitchen: boolean }) {
  const qc = useQueryClient();
  const stream = usePanelStream();
  const now = useNow(1000);
  const [wake] = useState(() => new ScreenWake());
  const [shift, setShift] = useState<'pending' | 'started' | 'skipped'>('pending');
  const [audioOn, setAudioOn] = useState(false);
  const [silenced, setSilenced] = useState<Set<string>>(() => new Set());
  const [escalated, setEscalated] = useState<Set<string>>(() => new Set());
  const [showDone, setShowDone] = useState(false);
  const [tab, setTab] = useState<ColumnKey>('new');
  // Cihaz tercihi (localStorage); yoksa şubenin fiş ayarı (auto_print)
  const [autoPrintPref, setAutoPrintPref] = useState<boolean | null>(null);
  const acked = useRef(new Set<string>());
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = useApiQuery<ActiveOrdersResponse>(ORDERS_ACTIVE_KEY, '/panel/orders/active', {
    refetchInterval: SAFETY_POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
    staleTime: 2_000,
  });

  useEffect(() => {
    const pref = readPref(AUTO_PRINT_KEY, '');
    setAutoPrintPref(pref === '' ? null : pref === '1');
    const off = alarmSound.subscribe(() => setAudioOn(alarmSound.unlocked));
    setAudioOn(alarmSound.unlocked);
    return () => {
      off();
      alarmSound.stopLoop();
      wake.disable();
    };
  }, [wake]);

  const refetchSoon = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void qc.invalidateQueries({ queryKey: ORDERS_ACTIVE_KEY }), 250);
  }, [qc]);

  usePanelEvent(['order.created', 'order.updated', 'order.alarm', 'resync', STREAM_RECONNECTED], (e) => {
    if (e.type === 'order.created' || e.type === 'order.updated') {
      if (!isOrderEventPayload(e.data)) return;
      const summary = e.data.order;
      if (summary.testKind === 'canary') return;
      const found = applySummary(qc, summary);
      void qc.invalidateQueries({ queryKey: orderDetailKey(summary.id) });
      // Yeni kartın kalemleri ve rozetleri için listeyi tazele
      if (!found || e.type === 'order.created' || e.data.change === 'cancel_request') refetchSoon();
      if (kitchen && e.data.to === 'accepted' && audioOn) alarmSound.ding(0.5);
      return;
    }
    if (e.type === 'order.alarm') {
      const p = e.data as OrderAlarmPayload;
      if (p?.orderId && p.step >= 2) setEscalated((s) => new Set(s).add(p.orderId));
      refetchSoon();
      return;
    }
    refetchSoon();
  });

  const data = q.data;
  const autoPrint = autoPrintPref ?? data?.branch.receipt?.autoPrint ?? true;
  const printPlan = data?.branch.receipt;
  const usePreparingStep = Boolean(data?.branch.usePreparingStep) || Boolean(data?.items.some((c) => c.status === 'preparing'));
  const items = useMemo(() => (data?.items ?? []).filter((c) => c.testKind !== 'canary'), [data]);
  const awaiting = items.filter((c) => c.status === 'awaiting_customer');
  const byStatus = (s: OrderCard['status']) => items.filter((c) => c.status === s);
  const newOrders = byStatus('new');
  const alarming = kitchen
    ? []
    : newOrders.filter((c) => !c.rejectionScheduledAt && c.channel !== 'manual' && !silenced.has(c.id));
  const highLevel = alarming.some(
    (c) => escalated.has(c.id) || (c.alarmStep ?? 0) >= 2 || now - new Date(c.verifiedAt ?? c.placedAt).getTime() >= 60_000,
  );

  // Döngüsel alarm (ses açıksa); "Gördüm" ile susturulan sipariş new kaldıkça 30 sn'de bir kısa hatırlatma
  useEffect(() => {
    if (!audioOn || kitchen) {
      alarmSound.stopLoop();
      return;
    }
    if (alarming.length) alarmSound.startLoop(highLevel ? 'high' : 'normal');
    else alarmSound.stopLoop();
  }, [audioOn, kitchen, alarming.length, highLevel]);

  const silencedStillNew = newOrders.some((c) => silenced.has(c.id) && !c.rejectionScheduledAt);
  useEffect(() => {
    if (!audioOn || !silencedStillNew || alarming.length) return;
    const t = setInterval(() => alarmSound.ding(0.3), 30_000);
    return () => clearInterval(t);
  }, [audioOn, silencedStillNew, alarming.length]);

  // Sekme başlığında sayaç
  useEffect(() => {
    const base = 'Canlı siparişler · Panel';
    document.title = newOrders.length ? `(${newOrders.length}) Yeni sipariş · ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [newOrders.length]);

  // Ekranda görünen yeni siparişi ack'le (cihaz başına bir kez)
  useEffect(() => {
    if (kitchen || typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    const label = readPref(DEVICE_LABEL_KEY, 'Panel');
    for (const c of newOrders) {
      if (acked.current.has(c.id)) continue;
      acked.current.add(c.id);
      void orderActions.ack(c.id, label).catch(() => acked.current.delete(c.id));
    }
  }, [newOrders, kitchen]);

  // Yeni sipariş gelince telefonda "Yeni" sekmesi açılır
  const newCount = newOrders.length;
  const prevNew = useRef(newCount);
  useEffect(() => {
    if (newCount > prevNew.current) {
      setTab('new');
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([200, 100, 200]);
    }
    prevNew.current = newCount;
  }, [newCount]);

  const markSeen = useCallback((id: string) => {
    setSilenced((s) => (s.has(id) ? s : new Set(s).add(id)));
  }, []);
  const silenceAll = () => setSilenced((s) => new Set([...s, ...alarming.map((c) => c.id)]));

  const offline = stream?.status === 'offline';
  const toggleAutoPrint = (v: boolean) => {
    setAutoPrintPref(v);
    try {
      window.localStorage.setItem(AUTO_PRINT_KEY, v ? '1' : '0');
    } catch {
      /* yok say */
    }
  };

  if (shift === 'pending') {
    return (
      <ShiftStart
        businessName={businessName}
        wake={wake}
        onStarted={() => {
          setAudioOn(true);
          setShift('started');
        }}
        onSkip={() => setShift('skipped')}
      />
    );
  }

  if (kitchen) {
    return (
      <div className="flex flex-col gap-3">
        {!audioOn ? <SoundOffBand onEnable={() => void alarmSound.unlock()} /> : null}
        <h1 className="text-xl font-bold">Mutfak</h1>
        <KitchenBoard data={data} loading={q.isPending} now={now} usePreparingStep={usePreparingStep} />
      </div>
    );
  }

  const columns: { key: ColumnKey; title: string; cards: OrderCard[] }[] = [
    { key: 'new', title: 'Yeni', cards: newOrders },
    { key: 'accepted', title: 'Onaylandı', cards: byStatus('accepted') },
    ...(usePreparingStep ? [{ key: 'preparing' as const, title: 'Hazırlanıyor', cards: byStatus('preparing') }] : []),
    { key: 'ready', title: 'Hazır', cards: byStatus('ready') },
    { key: 'on_the_way', title: 'Yolda', cards: byStatus('on_the_way') },
  ];
  // Bant, yeni sipariş kaldıkça yerinde durur (susturunca kaybolup düzeni kaydırmaz); "Gördüm" yalnız çalan varken
  const bandOrders = newOrders.filter((c) => !c.rejectionScheduledAt && c.channel !== 'manual');
  const first = alarming[0] ?? bandOrders[0];

  return (
    <div className="flex flex-col gap-3">
      <CardBlinkStyle />
      {first ? (
        <Banner
          tone="alarm"
          icon={BellRing}
          action={
            alarming.length ? (
              <Button variant="secondary" size="md" onClick={silenceAll}>
                <BellOff aria-hidden /> Gördüm
              </Button>
            ) : null
          }
        >
          <a href={`#siparis-${first.id}`} className="underline-offset-4 hover:underline">
            YENİ SİPARİŞ #{first.number}
            {first.totalKurus != null ? ` · ${formatMoney(first.totalKurus)}` : ''}
            {bandOrders.length > 1 ? ` · +${bandOrders.length - 1} sipariş daha` : ''}
          </a>
        </Banner>
      ) : null}
      {!audioOn ? <SoundOffBand onEnable={() => void alarmSound.unlock()} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="me-auto text-xl font-bold">Canlı siparişler</h1>
        <span className="inline-flex items-center gap-1 text-sm text-fg-muted" aria-live="polite">
          {audioOn ? <Volume2 aria-hidden className="size-4" /> : <VolumeX aria-hidden className="size-4 text-status-new-fg" />}
          {audioOn ? 'Ses açık' : 'Ses kapalı'}
        </span>
        <Switch checked={autoPrint} onCheckedChange={toggleAutoPrint} label="Onayda fiş yazdır" />
        <Link href="/panel/telefon-siparisi" className={buttonVariants({ variant: 'primary', size: 'md' })}>
          <Plus aria-hidden /> Telefon siparişi
        </Link>
        <Link href="/panel/siparisler" className={buttonVariants({ variant: 'secondary', size: 'md' })}>
          <ClipboardList aria-hidden /> Siparişler
        </Link>
      </div>

      {awaiting.length ? <AwaitingStrip cards={awaiting} now={now} /> : null}

      {q.isPending ? <Spinner label="Siparişler yükleniyor" /> : null}
      {q.isError && !data ? <Banner tone="warn">Siparişler yüklenemedi. Bağlantı gelince yeniden denenecek.</Banner> : null}

      {/* Telefon: sekmeli */}
      <div role="tablist" aria-label="Sipariş durumları" className="flex gap-1 overflow-x-auto md:hidden">
        {columns.map((c) => (
          <button
            key={c.key}
            role="tab"
            type="button"
            aria-selected={tab === c.key}
            onClick={() => setTab(c.key)}
            className={cn(
              'min-h-hit shrink-0 rounded-md px-3 text-sm font-semibold',
              tab === c.key ? 'bg-primary text-primary-fg' : 'bg-surface-raised text-fg',
              c.key === 'new' && c.cards.length ? 'ring-2 ring-status-new-fg' : '',
            )}
          >
            {c.title} ({c.cards.length})
          </button>
        ))}
      </div>

      <div className={cn('grid gap-3', usePreparingStep ? 'md:grid-cols-3 xl:grid-cols-5' : 'md:grid-cols-2 xl:grid-cols-4')}>
        {columns.map((col) => (
          <section key={col.key} aria-label={col.title} className={cn('flex min-w-0 flex-col gap-3', tab !== col.key && 'max-md:hidden')}>
            <h2 className="hidden items-center gap-2 text-sm font-bold uppercase tracking-wide text-fg-muted md:flex">
              {col.title}
              <span className={cn('rounded-full px-2 py-0.5 text-xs', col.key === 'new' && col.cards.length ? 'bg-status-new-bg text-status-new-fg' : 'bg-surface')}>
                {col.cards.length}
              </span>
            </h2>
            {col.cards.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-fg-muted">
                {col.key === 'new' ? 'Yeni sipariş yok.' : 'Boş'}
              </p>
            ) : null}
            {sortColumn(col.key, col.cards).map((c) => (
              <div key={c.id} id={`siparis-${c.id}`}>
                <OrderCardView
                  card={c}
                  now={now}
                  usePreparingStep={usePreparingStep}
                  alarming={alarming.some((a) => a.id === c.id)}
                  onSeen={markSeen}
                  autoPrint={autoPrint}
                  printPlan={printPlan}
                  offline={offline}
                />
              </div>
            ))}
          </section>
        ))}
      </div>

      {items.length === 0 && !q.isPending ? (
        <EmptyState icon={CheckCheck} title="Şu an açık sipariş yok" description="Yeni sipariş gelince burada sesli uyarıyla görünür." />
      ) : null}

      <CompletedList cards={data?.completed ?? []} open={showDone} onToggle={() => setShowDone((v) => !v)} />
    </div>
  );
}

function sortColumn(key: ColumnKey, cards: OrderCard[]): OrderCard[] {
  const ts = (s: string | null | undefined) => (s ? new Date(s).getTime() : 0);
  if (key === 'new') return [...cards].sort((a, b) => ts(a.verifiedAt ?? a.placedAt) - ts(b.verifiedAt ?? b.placedAt));
  if (key === 'ready') return [...cards].sort((a, b) => ts(a.readyAt) - ts(b.readyAt));
  return [...cards].sort((a, b) => ts(a.estimatedReadyAt ?? a.placedAt) - ts(b.estimatedReadyAt ?? b.placedAt));
}

function SoundOffBand({ onEnable }: { onEnable: () => void }) {
  return (
    <Banner
      tone="alarm"
      icon={VolumeX}
      action={
        <Button variant="secondary" size="md" onClick={onEnable}>
          <Volume2 aria-hidden /> Sesi aç
        </Button>
      }
    >
      Ses kapalı — yeni siparişleri duyamazsınız.
    </Banner>
  );
}

/** Müşteri onayı bekleyen siparişler: soluk, sessiz satırlar + [Telefonla doğruladım] (04 §4.2). */
function AwaitingStrip({ cards, now }: { cards: OrderCard[]; now: number }) {
  const { actions, openDetail } = useOrderSheets();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <section aria-label="Müşteri onayı bekleyenler" className="flex flex-col gap-1">
      {cards.map((c) => {
        const left = Math.max(0, Math.ceil((new Date(c.placedAt).getTime() + 30 * 60_000 - now) / 60_000));
        return (
          <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-surface px-3 py-1.5 text-sm text-fg-muted">
            <Hourglass aria-hidden className="size-4" />
            <button type="button" className="min-h-10 font-semibold text-fg underline-offset-4 hover:underline" onClick={() => openDetail(c.id)}>
              #{c.number}
            </button>
            <span>
              Web{c.totalKurus != null ? ` · ${formatMoney(c.totalKurus)}` : ''} · Müşteri onayı bekleniyor · {left} dk kaldı
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="ms-auto"
              loading={busy === c.id}
              onClick={async () => {
                setBusy(c.id);
                await actions.verify(c.id).catch(() => undefined);
                setBusy(null);
              }}
            >
              <PhoneCall aria-hidden /> Telefonla doğruladım
            </Button>
          </div>
        );
      })}
    </section>
  );
}

function CompletedList({ cards, open, onToggle }: { cards: OrderCard[]; open: boolean; onToggle: () => void }) {
  const { openDetail } = useOrderSheets();
  return (
    <section aria-label="Bugün tamamlananlar" className="mt-2 rounded-lg border border-border bg-surface-raised">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-hit w-full items-center gap-2 px-4 text-base font-semibold">
        Tamamlanan ({cards.length})
        {open ? <ChevronUp aria-hidden className="ms-auto size-5" /> : <ChevronDown aria-hidden className="ms-auto size-5" />}
      </button>
      {open ? (
        <ul className="divide-y divide-border border-t border-border">
          {cards.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => openDetail(c.id)} className="flex min-h-hit w-full flex-wrap items-center gap-3 px-4 py-2 text-start">
                <span className="font-bold tabular-nums">#{c.number}</span>
                <StatusBadge status={c.status} size="sm" />
                <span className="text-sm text-fg-muted">
                  {c.customerName ?? ''} · {formatTime(c.deliveredAt ?? c.cancelledAt ?? c.rejectedAt ?? c.updatedAt)}
                </span>
                {c.totalKurus != null ? <span className="ms-auto tabular-nums">{formatMoney(c.totalKurus)}</span> : null}
                <Printer aria-hidden className="size-4 text-fg-muted" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
