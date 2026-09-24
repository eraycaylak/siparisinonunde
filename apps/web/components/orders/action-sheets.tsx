'use client';

// Sipariş aksiyon alt sayfaları: ret (sebep çipleri + önizleme), onay sonrası iptal (onay penceresi),
// gecikme bildir, kurye ata (04 §4.7, §4.9, §4.10, §4.15).

import { useEffect, useState } from 'react';
import { Bike, CircleUserRound, PackageCheck, UserX } from 'lucide-react';
import type { OrderDetailExt, OrderCard, CourierListResponse } from '@siparis/core/orders/contracts';
import type { CancelReason, RejectionReason } from '@siparis/core/enums';
import { Alert, Button, Checkbox, ConfirmDialog, Field, RadioGroup, Sheet, Spinner, Textarea } from '@/components/ui';
import { useApiQuery } from '@/lib/api';
import { COURIERS_KEY, orderDetailKey } from './api';
import { CANCEL_CHIPS, DELAY_CHIPS, REJECT_CHIPS, REJECT_PREVIEW } from './labels';

interface BaseProps {
  order: OrderCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------

export function RejectSheet({
  order,
  open,
  onOpenChange,
  onSubmit,
}: BaseProps & {
  onSubmit: (body: { reason: RejectionReason; note?: string; soldOutProductIds?: string[]; blockCustomer?: boolean }) => Promise<void>;
}) {
  const [reason, setReason] = useState<RejectionReason | null>(null);
  const [note, setNote] = useState('');
  const [soldOut, setSoldOut] = useState<Record<string, boolean>>({});
  const [markSoldOut, setMarkSoldOut] = useState(true);
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detail = useApiQuery<OrderDetailExt>(orderDetailKey(order?.id ?? '-'), open && reason === 'item_unavailable' && order ? `/panel/orders/${order.id}` : null);

  useEffect(() => {
    if (open) {
      setReason(null);
      setNote('');
      setSoldOut({});
      setMarkSoldOut(true);
      setBlock(false);
      setError(null);
    }
  }, [open, order?.id]);

  const noteMissing = reason === 'other' && !note.trim();
  const submit = async () => {
    if (!reason || noteMissing) return;
    setBusy(true);
    setError(null);
    try {
      const ids = Object.entries(soldOut)
        .filter(([, v]) => v)
        .map(([k]) => k);
      await onSubmit({
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(reason === 'item_unavailable' && markSoldOut && ids.length ? { soldOutProductIds: ids } : {}),
        ...(reason === 'suspected_fake' && block ? { blockCustomer: true } : {}),
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ret gönderilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const products = (detail.data?.items ?? []).filter((i) => i.productId);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={order ? `#${order.number} siparişi reddet` : 'Reddet'}
      description="Sebebi seçin. 30 saniye içinde geri alabilirsiniz."
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="danger" size="lg" onClick={submit} disabled={!reason || noteMissing} loading={busy}>
            Reddet
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <RadioGroup legend="Ret sebebi" variant="chips" options={REJECT_CHIPS} value={reason} onValueChange={setReason} />
        {reason === 'other' ? (
          <Field label="Müşteriye gidecek açıklama" required hint={`${note.length}/140`} error={noteMissing ? 'Açıklama yazın.' : undefined}>
            <Textarea value={note} maxLength={140} rows={2} onChange={(e) => setNote(e.target.value)} />
          </Field>
        ) : null}
        {reason === 'item_unavailable' ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold">Hangi ürün kalmadı?</p>
            {detail.isPending ? <Spinner size="sm" label="Kalemler yükleniyor" /> : null}
            {products.map((i) => (
              <Checkbox
                key={i.id}
                label={`${i.quantity}× ${i.name}`}
                checked={Boolean(soldOut[i.productId!])}
                onChange={(e) => setSoldOut((s) => ({ ...s, [i.productId!]: e.target.checked }))}
              />
            ))}
            <Checkbox label="Seçilenleri bugün tükendi yap" checked={markSoldOut} onChange={(e) => setMarkSoldOut(e.target.checked)} />
          </div>
        ) : null}
        {reason === 'suspected_fake' ? (
          <Checkbox label="Müşteriyi kara listeye al" description="Ret kesinleşince bu müşteri online sipariş veremez." checked={block} onChange={(e) => setBlock(e.target.checked)} />
        ) : null}
        {reason ? (
          <div className="rounded-md border border-border bg-surface p-3 text-sm">
            <p className="mb-1 font-semibold text-fg-muted">Müşteriye gidecek mesaj</p>
            <p>{reason === 'other' && note.trim() ? `Siparişiniz alınamadı: ${note.trim()}` : REJECT_PREVIEW[reason]}</p>
          </div>
        ) : null}
        {error ? <Alert variant="danger">{error}</Alert> : null}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export function CancelSheet({
  order,
  open,
  onOpenChange,
  onSubmit,
}: BaseProps & { onSubmit: (body: { reason: CancelReason; note?: string }) => Promise<void> }) {
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason(null);
      setNote('');
      setError(null);
    }
  }, [open, order?.id]);

  const noteMissing = reason === 'other' && !note.trim();
  const run = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ reason, ...(note.trim() ? { note: note.trim() } : {}) });
      setConfirm(false);
      onOpenChange(false);
    } catch (e) {
      setConfirm(false);
      setError(e instanceof Error ? e.message : 'İptal edilemedi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet
        open={open && !confirm}
        onOpenChange={onOpenChange}
        title={order ? `#${order.number} siparişi iptal et` : 'İptal et'}
        description="Onaylanmış sipariş iptal edilir ve müşteriye bilgi gider."
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
              Vazgeç
            </Button>
            <Button variant="danger" size="lg" disabled={!reason || noteMissing} onClick={() => setConfirm(true)}>
              İptal et
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <RadioGroup legend="İptal sebebi" variant="chips" options={CANCEL_CHIPS} value={reason} onValueChange={setReason} />
          {reason === 'other' || reason === 'customer_request' ? (
            <Field label={reason === 'other' ? 'Açıklama' : 'Not (isteğe bağlı)'} required={reason === 'other'} error={noteMissing ? 'Açıklama yazın.' : undefined}>
              <Textarea value={note} maxLength={140} rows={2} onChange={(e) => setNote(e.target.value)} />
            </Field>
          ) : null}
          {error ? <Alert variant="danger">{error}</Alert> : null}
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => {
          if (!o) setConfirm(false);
        }}
        title="Sipariş iptal edilsin mi?"
        description="Müşteriye iptal mesajı gidecek. Bu işlem geri alınamaz."
        confirmLabel="Evet, iptal et"
        onConfirm={run}
        loading={busy}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

export function DelaySheet({ order, open, onOpenChange, onSubmit }: BaseProps & { onSubmit: (extraMinutes: number) => Promise<void> }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  const left = Math.max(0, 2 - (order?.delayNoticeCount ?? 0));
  const run = async (m: number) => {
    setBusy(m);
    setError(null);
    try {
      await onSubmit(m);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gecikme bildirilemedi.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Gecikme bildir"
      description={left > 0 ? `Tahmini saat uzar, müşteriye bilgi gider. Kalan hak: ${left}.` : 'Bu sipariş için gecikme hakkı doldu. Müşteriyi arayın.'}
    >
      <div className="flex flex-wrap gap-2">
        {DELAY_CHIPS.map((m) => (
          <Button key={m} variant="secondary" size="lg" className="min-w-24" disabled={left === 0} loading={busy === m} onClick={() => run(m)}>
            +{m} dk
          </Button>
        ))}
      </div>
      {error ? <Alert variant="danger" className="mt-4">{error}</Alert> : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export function CourierSheet({
  order,
  open,
  onOpenChange,
  onAssign,
  onSelfDeliver,
}: BaseProps & {
  onAssign: (userId: string | null, onTheWay: boolean) => Promise<void>;
  onSelfDeliver: () => Promise<void>;
}) {
  const list = useApiQuery<CourierListResponse>(COURIERS_KEY, open ? '/panel/orders/couriers' : null, { staleTime: 10_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İşlem yapılamadı.');
    } finally {
      setBusy(null);
    }
  };
  const canGo = order ? order.status === 'accepted' || order.status === 'ready' : false;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={order ? `#${order.number} · Kurye` : 'Kurye'} description="Kurye seçin ya da kendiniz götürün.">
      <div className="flex flex-col gap-3">
        {list.isPending ? <Spinner label="Kuryeler yükleniyor" /> : null}
        {list.data?.items.length === 0 ? <Alert>Kayıtlı kurye yok. Kuryeler bölümünden ekleyebilirsiniz.</Alert> : null}
        {list.data?.items.map((c) => (
          <div key={c.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <CircleUserRound aria-hidden className="size-5" />
              <span className="font-semibold">{c.name}</span>
              <span className="ms-auto inline-flex items-center gap-1 text-sm text-fg-muted">
                {c.onTheWayCount > 0 ? (
                  <>
                    <Bike aria-hidden className="size-4" /> Yolda · {c.onTheWayCount} sipariş
                  </>
                ) : (
                  'Müsait'
                )}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {canGo ? (
                <Button size="lg" loading={busy === `${c.id}:go`} onClick={() => run(`${c.id}:go`, () => onAssign(c.id, true))}>
                  <Bike aria-hidden /> Ata ve yola çıkar
                </Button>
              ) : null}
              <Button variant="secondary" size="lg" loading={busy === `${c.id}:assign`} onClick={() => run(`${c.id}:assign`, () => onAssign(c.id, false))}>
                {order?.courierUserId === c.id ? 'Atanmış' : 'Yalnız ata'}
              </Button>
            </div>
          </div>
        ))}
        {canGo ? (
          <Button variant="secondary" size="lg" loading={busy === 'self'} onClick={() => run('self', onSelfDeliver)}>
            <PackageCheck aria-hidden /> Kuryesiz / kendim götürüyorum
          </Button>
        ) : null}
        {order?.courierUserId ? (
          <Button variant="ghost" size="lg" loading={busy === 'none'} onClick={() => run('none', () => onAssign(null, false))}>
            <UserX aria-hidden /> Kuryeyi kaldır
          </Button>
        ) : null}
        {error ? <Alert variant="danger">{error}</Alert> : null}
      </div>
    </Sheet>
  );
}
