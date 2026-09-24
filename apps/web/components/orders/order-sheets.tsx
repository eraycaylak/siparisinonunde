'use client';

// Sipariş alt sayfaları ve detay çekmecesi için tek sağlayıcı: kartlar ve çekmece aynı ret/iptal/gecikme/kurye
// sayfalarını ve "Geri al" şeritlerini (ret 30 sn — sunucudaki rejection_scheduled_at'ten; durum geçişi 5 sn — istemcide)
// kullanır (04 §1.1 #5, §4.7, §4.8).

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  Ban,
  Bike,
  CircleAlert,
  Clock,
  MapPin,
  MessageSquareWarning,
  Phone,
  Printer,
  Receipt,
  StickyNote,
  UserRound,
} from 'lucide-react';
import type { ActiveOrdersResponse, OrderCard, OrderDetailExt } from '@siparis/core/orders/contracts';
import type { TenantRole } from '@siparis/core/enums';
import {
  Alert,
  Badge,
  Button,
  ChannelBadge,
  ConfirmUndoBar,
  FulfillmentBadge,
  Sheet,
  Spinner,
  StatusBadge,
  UndoBarRegion,
} from '@/components/ui';
import { useApiQuery } from '@/lib/api';
import { formatDateTime, formatMoney, formatPhone, formatRelative, formatTime } from '@/lib/format';
import { ORDERS_ACTIVE_KEY, openReceipt, orderDetailKey } from './api';
import { CancelSheet, CourierSheet, DelaySheet, RejectSheet } from './action-sheets';
import { cancelLabel, changeText, eventLabel, mapLinks, paymentShort, rejectLabel, telHref } from './labels';
import { OrderItems } from './order-items';
import { useOrderActions, type OrderActions } from './use-order-actions';

type SheetKind = 'reject' | 'cancel' | 'delay' | 'courier';
type AdvanceTarget = 'preparing' | 'ready' | 'on_the_way' | 'delivered';

interface PendingAdvance {
  order: OrderCard;
  to: AdvanceTarget;
  label: string;
  deadline: number;
}

interface OrderSheetsValue {
  role: TenantRole;
  actions: OrderActions;
  openSheet: (kind: SheetKind, order: OrderCard) => void;
  openDetail: (orderId: string) => void;
  /** 5 sn "Geri al" penceresiyle durum geçişi (04 §4.8); süre dolunca API çağrılır. */
  scheduleAdvance: (order: OrderCard, to: AdvanceTarget) => void;
  pendingAdvance: (orderId: string) => AdvanceTarget | null;
}

const Ctx = createContext<OrderSheetsValue | null>(null);

export function useOrderSheets(): OrderSheetsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('OrderSheetsProvider eksik');
  return v;
}

const ADVANCE_LABELS: Record<AdvanceTarget, string> = {
  preparing: 'Hazırlanıyor olarak işaretlendi',
  ready: 'Hazır olarak işaretlendi',
  on_the_way: 'Yola çıktı olarak işaretlendi',
  delivered: 'Teslim edildi olarak işaretlendi',
};

export function OrderSheetsProvider({ role, children }: { role: TenantRole; children: ReactNode }) {
  const actions = useOrderActions();
  const [sheet, setSheet] = useState<{ kind: SheetKind; order: OrderCard } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [advances, setAdvances] = useState<PendingAdvance[]>([]);
  const active = useApiQuery<ActiveOrdersResponse>(ORDERS_ACTIVE_KEY, null);

  const openSheet = useCallback((kind: SheetKind, order: OrderCard) => setSheet({ kind, order }), []);
  const openDetail = useCallback((id: string) => setDetailId(id), []);
  const scheduleAdvance = useCallback((order: OrderCard, to: AdvanceTarget) => {
    setAdvances((list) => [...list.filter((a) => a.order.id !== order.id), { order, to, label: ADVANCE_LABELS[to], deadline: Date.now() + 5_000 }]);
  }, []);
  const pendingAdvance = useCallback((id: string) => advances.find((a) => a.order.id === id)?.to ?? null, [advances]);

  const commitAdvance = useCallback(
    (a: PendingAdvance) => {
      setAdvances((list) => list.filter((x) => x !== a));
      void actions.advance(a.order.id, a.to).catch(() => undefined);
    },
    [actions],
  );

  const close = () => setSheet(null);
  const current = sheet?.order ?? null;
  const pendingRejects = (active.data?.items ?? []).filter((c) => c.status === 'new' && c.rejectionScheduledAt);

  const value = useMemo<OrderSheetsValue>(
    () => ({ role, actions, openSheet, openDetail, scheduleAdvance, pendingAdvance }),
    [role, actions, openSheet, openDetail, scheduleAdvance, pendingAdvance],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <RejectSheet
        order={sheet?.kind === 'reject' ? current : null}
        open={sheet?.kind === 'reject'}
        onOpenChange={(o) => !o && close()}
        onSubmit={async (body) => {
          if (current) await actions.reject(current.id, body);
        }}
      />
      <CancelSheet
        order={sheet?.kind === 'cancel' ? current : null}
        open={sheet?.kind === 'cancel'}
        onOpenChange={(o) => !o && close()}
        onSubmit={async (body) => {
          if (current) await actions.cancel(current.id, body as never);
        }}
      />
      <DelaySheet
        order={sheet?.kind === 'delay' ? current : null}
        open={sheet?.kind === 'delay'}
        onOpenChange={(o) => !o && close()}
        onSubmit={async (m) => {
          if (current) await actions.delay(current.id, m);
        }}
      />
      <CourierSheet
        order={sheet?.kind === 'courier' ? current : null}
        open={sheet?.kind === 'courier'}
        onOpenChange={(o) => !o && close()}
        onAssign={async (userId, onTheWay) => {
          if (current) await actions.assignCourier(current.id, userId, onTheWay);
        }}
        onSelfDeliver={async () => {
          if (current) await actions.advance(current.id, 'on_the_way');
        }}
      />
      <OrderDrawer orderId={detailId} onClose={() => setDetailId(null)} />
      <UndoBarRegion>
        {pendingRejects.map((c) => (
          <ConfirmUndoBar
            key={`rej-${c.id}-${c.rejectionScheduledAt}`}
            message={`#${c.number} reddediliyor · ${rejectLabel(c.rejectionReason)}`}
            deadline={new Date(c.rejectionScheduledAt!).getTime() + 30_000}
            onUndo={() => void actions.undoReject(c.id).catch(() => undefined)}
            disabled={role === 'kitchen'}
          />
        ))}
        {advances.map((a) => (
          <ConfirmUndoBar
            key={`adv-${a.order.id}-${a.deadline}`}
            tone="neutral"
            message={`#${a.order.number} · ${a.label}`}
            deadline={a.deadline}
            onUndo={() => setAdvances((list) => list.filter((x) => x !== a))}
            onExpire={() => commitAdvance(a)}
          />
        ))}
      </UndoBarRegion>
    </Ctx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Detay çekmecesi (P-05)

function Section({ title, icon: Icon, children }: { title: string; icon: typeof UserRound; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0">
      <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-fg-muted">
        <Icon aria-hidden className="size-4" />
        {title}
      </h3>
      {children}
    </section>
  );
}

export function OrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { role, actions, openSheet } = useOrderSheets();
  const q = useApiQuery<OrderDetailExt>(orderDetailKey(orderId ?? '-'), orderId ? `/panel/orders/${orderId}` : null);
  const d = q.data;
  const kitchen = role === 'kitchen';
  const staff = role === 'owner' || role === 'manager' || role === 'cashier';
  const [busy, setBusy] = useState<string | null>(null);
  const card = d?.card;
  const open = Boolean(orderId);
  const address = d ? [d.neighborhood ? `${d.neighborhood} Mah.` : null, d.addressLine].filter(Boolean).join(', ') : '';
  const maps = d && d.fulfillmentType === 'delivery' && address ? mapLinks({ lat: d.lat, lng: d.lng, address: `${address}, Yozgat` }) : null;
  const activeStatus = d && ['accepted', 'preparing', 'ready', 'on_the_way'].includes(d.status);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={d ? `#${d.number}` : 'Sipariş'}
      description={
        d ? (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} size="sm" />
            <ChannelBadge channel={d.channel} />
            <FulfillmentBadge type={d.fulfillmentType} />
            <span>{formatDateTime(d.placedAt)}</span>
            {d.estimatedReadyAt ? <span>· Hedef {formatTime(d.estimatedReadyAt)}</span> : null}
            {d.testKind ? <Badge variant="warning">TEST</Badge> : null}
          </span>
        ) : undefined
      }
      footer={
        d ? (
          <div className="flex w-full flex-wrap gap-2">
            <Button variant="secondary" onClick={() => openReceipt(d.id, 'kitchen')}>
              <Printer aria-hidden /> Mutfak fişi
            </Button>
            {!kitchen ? (
              <Button variant="secondary" onClick={() => openReceipt(d.id, 'delivery')}>
                <Receipt aria-hidden /> Paket fişi
              </Button>
            ) : null}
            {staff && card && activeStatus ? (
              <>
                <Button variant="secondary" onClick={() => openSheet('delay', card)}>
                  <Clock aria-hidden /> Gecikme bildir
                </Button>
                {d.fulfillmentType === 'delivery' && d.status !== 'on_the_way' ? (
                  <Button variant="secondary" onClick={() => openSheet('courier', card)}>
                    <Bike aria-hidden /> Kurye ata
                  </Button>
                ) : null}
                <Button variant="ghost" className="text-destructive" onClick={() => openSheet('cancel', card)}>
                  <Ban aria-hidden /> İptal et
                </Button>
              </>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {q.isPending && open ? <Spinner label="Sipariş yükleniyor" /> : null}
      {q.isError ? <Alert variant="danger">Sipariş yüklenemedi.</Alert> : null}
      {d ? (
        <div className="flex flex-col gap-4">
          {d.cancellationRequest?.status === 'pending' && staff ? (
            <Alert
              variant="warning"
              title="Müşteri iptal istiyor"
              action={
                <>
                  <Button
                    variant="danger"
                    loading={busy === 'approve'}
                    onClick={async () => {
                      setBusy('approve');
                      await actions.decide(d.id, d.cancellationRequest!.id, true).catch(() => undefined);
                      setBusy(null);
                    }}
                  >
                    İptal et (müşteri istedi)
                  </Button>
                  <Button
                    variant="secondary"
                    loading={busy === 'reject'}
                    onClick={async () => {
                      setBusy('reject');
                      await actions.decide(d.id, d.cancellationRequest!.id, false).catch(() => undefined);
                      setBusy(null);
                    }}
                  >
                    Hazırlık başladı, iptal edilemez
                  </Button>
                </>
              }
            >
              {d.cancellationRequest.reason ? `Gerekçe: ${d.cancellationRequest.reason}` : 'Gerekçe yazılmadı.'}
            </Alert>
          ) : null}
          {d.status === 'rejected' ? <Alert variant="danger">Reddedildi · {rejectLabel(d.rejectionReason)}{d.rejectionNote ? ` · ${d.rejectionNote}` : ''}</Alert> : null}
          {d.status === 'cancelled' ? (
            <Alert variant="danger">
              İptal edildi · {cancelLabel(d.cancelReason)}
              {d.cancelledBy === 'customer' ? ' · Müşteri' : d.cancelledBy === 'system' ? ' · Sistem' : ''}
              {d.cancelNote ? ` · ${d.cancelNote}` : ''}
            </Alert>
          ) : null}

          {!kitchen ? (
            <Section title="Müşteri" icon={UserRound}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold">{d.customerName ?? 'Müşteri'}</span>
                {d.customer ? (
                  <Badge variant={d.customer.orderCount > 1 ? 'info' : 'neutral'}>
                    {d.customer.orderCount > 1 ? `${d.customer.orderCount}. sipariş` : 'Yeni müşteri'}
                  </Badge>
                ) : null}
                {d.customer?.isBlocked ? (
                  <Badge variant="danger">
                    <CircleAlert aria-hidden className="size-3.5" /> Kara listede
                  </Badge>
                ) : null}
              </div>
              {d.customerPhone ? (
                <a href={telHref(d.customerPhone)} className="inline-flex min-h-hit items-center gap-2 font-semibold underline underline-offset-4">
                  <Phone aria-hidden className="size-5" /> {formatPhone(d.customerPhone)}
                </a>
              ) : null}
              {d.customer?.notes ? <p className="rounded-sm bg-note px-2 py-1 text-sm text-note-fg">İşletme notu: {d.customer.notes}</p> : null}
              {d.customer?.recent.length ? (
                <ul className="flex flex-col gap-1 text-sm text-fg-muted">
                  {d.customer.recent.map((r) => (
                    <li key={r.id}>
                      #{r.number} · {formatRelative(r.placedAt)} · {r.itemsText}
                      {r.totalKurus != null ? ` · ${formatMoney(r.totalKurus)}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Section>
          ) : null}

          {!kitchen && d.fulfillmentType === 'delivery' ? (
            <Section title="Adres" icon={MapPin}>
              <p className="text-base">{address || '—'}</p>
              {d.directions ? <p className="rounded-sm bg-note px-2 py-1 font-semibold text-note-fg">Tarif: {d.directions}</p> : null}
              <p className="text-sm text-fg-muted">
                {d.zoneName ? `Bölge: ${d.zoneName}` : 'Bölge dışı (istisna)'}
              </p>
              {maps ? (
                <a href={maps.google} target="_blank" rel="noreferrer" className="inline-flex min-h-hit items-center gap-2 font-semibold underline underline-offset-4">
                  <MapPin aria-hidden className="size-5" /> Haritada aç
                </a>
              ) : null}
            </Section>
          ) : null}

          <Section title="Kalemler" icon={Receipt}>
            <OrderItems items={d.items.map((i) => ({ ...i, options: i.options.map((o) => o.optionName) }))} showPrices={!kitchen} />
            {!kitchen && d.totalKurus != null ? (
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-base">
                <dt className="text-fg-muted">Ara toplam</dt>
                <dd className="text-end tabular-nums">{formatMoney(d.subtotalKurus ?? 0)}</dd>
                {d.deliveryFeeKurus ? (
                  <>
                    <dt className="text-fg-muted">Teslimat</dt>
                    <dd className="text-end tabular-nums">{formatMoney(d.deliveryFeeKurus)}</dd>
                  </>
                ) : null}
                <dt className="font-bold">Toplam (KDV dahil)</dt>
                <dd className="text-end font-bold tabular-nums">{formatMoney(d.totalKurus)}</dd>
              </dl>
            ) : null}
            {!kitchen ? (
              <p className="text-base font-semibold">
                {paymentShort(d.paymentMethod, d.mealCardBrand)}
                {changeText(d.totalKurus, d.changeForKurus) ? ` · ${changeText(d.totalKurus, d.changeForKurus)}` : ''}
                {d.paymentStatus === 'paid' ? ' · Ödendi' : ''}
              </p>
            ) : null}
            {d.wantsCutlery ? <p className="text-sm">Çatal-bıçak istiyor</p> : null}
          </Section>

          {d.note ? (
            <Section title="Sipariş notu" icon={StickyNote}>
              <p className="rounded-sm bg-note px-2 py-1 font-bold text-note-fg">{d.note}</p>
              <p className="text-xs text-fg-muted">Not 30 gün sonra silinir.</p>
            </Section>
          ) : null}

          {card?.courierName ? (
            <Section title="Kurye" icon={Bike}>
              <p>
                {card.courierName}
                {card.onTheWayAt ? ` · Çıkış ${formatTime(card.onTheWayAt)}` : ''}
              </p>
            </Section>
          ) : null}

          {d.review ? (
            <Section title="Değerlendirme" icon={MessageSquareWarning}>
              <p>
                {d.review.rating === 'good' ? 'Harika' : d.review.rating === 'ok' ? 'İdare eder' : 'Beğenmedim'}
                {d.review.comment ? ` · "${d.review.comment}"` : ''}
              </p>
            </Section>
          ) : null}

          <Section title="Zaman çizelgesi" icon={Clock}>
            <ol className="flex flex-col gap-1 text-sm">
              {d.events
                .filter((e) => e.type !== 'alarm_step')
                .map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className="w-12 shrink-0 tabular-nums text-fg-muted">{formatTime(e.createdAt)}</span>
                    <span>
                      {eventLabel(e)}
                      {e.actorName ? ` · ${e.actorName}` : e.actorType === 'customer' ? ' · Müşteri' : e.actorType === 'system' ? ' · Sistem' : ''}
                      {e.note && e.type !== 'rejection_scheduled' ? ` · ${e.note}` : ''}
                    </span>
                  </li>
                ))}
              {d.acks.slice(0, 1).map((a) => (
                <li key={a.ackedAt} className="flex gap-2 text-fg-muted">
                  <span className="w-12 shrink-0 tabular-nums">{formatTime(a.ackedAt)}</span>
                  <span>Görüldü{a.deviceLabel ? ` (${a.deviceLabel})` : ''}</span>
                </li>
              ))}
            </ol>
            {d.trackingPath && !kitchen ? (
              <p className="text-xs text-fg-muted">
                Takip bağlantısı: <span className="break-all">{d.trackingPath}</span>
              </p>
            ) : null}
          </Section>
        </div>
      ) : null}
    </Sheet>
  );
}
