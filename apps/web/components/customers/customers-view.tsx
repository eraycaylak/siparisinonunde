'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Download, MessageCircle, Phone, Search, StickyNote, Trash2, UserRound, UsersRound } from 'lucide-react';
import { FULFILLMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from '@siparis/core';
import type { CustomerDetail, CustomerListItem, CustomerOrderItem } from '@siparis/core/settings/contracts';
import { SettingsError, SettingsLoading } from '@/components/settings/settings-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Sheet } from '@/components/ui/sheet';
import { StatusBadge } from '@/components/ui/status-badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, errorMessage, useApiQuery } from '@/lib/api';
import { currentRole, useMe } from '@/lib/auth';
import { formatDateTime, formatMoney, formatPhone, formatRelative } from '@/lib/format';

type Page = { items: CustomerListItem[]; nextCursor?: string };
const LIST_KEY = ['panel', 'customers'] as const;

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Müşteriler (04 §8, P-30/P-31): arama, liste (maskeli telefon), profil çekmecesi, not, kara liste, KVKK. */
export function CustomersView() {
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const [selected, setSelected] = useState<string | null>(null);
  const list = useInfiniteQuery<Page>({
    queryKey: [...LIST_KEY, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => apiFetch<Page>('/panel/customers', { signal, query: { q: query || undefined, cursor: pageParam as string | undefined, limit: 30 } }),
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageHeader title="Müşteriler" description="Sipariş veren müşterileriniz. Telefonlar listede gizli, profilde tam görünür." />
      <form onSubmit={(e) => e.preventDefault()} role="search">
        <Field label="Ara" hideLabel>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad ya da telefonun son 4 hanesi" className="ps-10" type="search" />
          </div>
        </Field>
      </form>
      {list.isPending ? (
        <SettingsLoading rows={4} />
      ) : list.isError ? (
        <SettingsError error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={UsersRound} title={query ? 'Eşleşen müşteri yok' : 'Henüz müşteri yok'} description={query ? 'Aramayı değiştirip tekrar deneyin.' : 'İlk siparişle birlikte müşterileriniz burada listelenir.'} />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface-raised">
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setSelected(c.id)} className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-start hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring sm:px-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-fg-muted">
                  <UserRound aria-hidden className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-2 font-semibold text-fg">
                    <span className="truncate">{c.name || 'İsimsiz'}</span>
                    {c.isBlocked ? (
                      <Badge variant="danger" size="sm">
                        Kara liste
                      </Badge>
                    ) : null}
                    {c.hasWhatsapp ? <MessageCircle aria-label="WhatsApp" className="size-4 text-fg-muted" /> : null}
                    {c.hasNotes ? <StickyNote aria-label="Not var" className="size-4 text-fg-muted" /> : null}
                  </span>
                  <span className="text-sm text-fg-muted">
                    {c.phoneMasked ?? 'Telefon yok'} · {c.orderCount} sipariş{c.lastOrderAt ? ` · son ${formatRelative(c.lastOrderAt)}` : ''}
                  </span>
                </span>
                <span className="hidden flex-col items-end text-sm sm:flex">
                  <span className="font-semibold tabular-nums text-fg">{formatMoney(c.totalSpentKurus)}</span>
                  <span className="text-fg-muted">ort. {formatMoney(c.avgBasketKurus)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage ? (
        <Button variant="secondary" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage} className="self-center">
          Daha fazla göster
        </Button>
      ) : null}
      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)} title="Müşteri" side="auto" size="lg">
        {selected ? <CustomerDrawer id={selected} onErased={() => setSelected(null)} /> : null}
      </Sheet>
    </div>
  );
}

function CustomerDrawer({ id, onErased }: { id: string; onErased: () => void }) {
  const me = useMe();
  const role = currentRole(me.data);
  const canKvkk = role === 'owner' || role === 'manager';
  const qc = useQueryClient();
  const detail = useApiQuery<CustomerDetail>(['panel', 'customer', id], `/panel/customers/${id}`);
  const orders = useApiQuery<{ items: CustomerOrderItem[]; nextCursor?: string }>(['panel', 'customer', id, 'orders'], `/panel/customers/${id}/orders`, { query: { limit: 20 } });
  const [notes, setNotes] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [blockOpen, setBlockOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (detail.isPending) return <SettingsLoading rows={3} />;
  if (detail.isError) return <SettingsError error={detail.error} onRetry={() => void detail.refetch()} />;
  const c = detail.data;
  const noteValue = notes ?? c.notes ?? '';

  async function patch(body: Record<string, unknown>, ok: string) {
    setBusy('patch');
    try {
      const updated = await apiFetch<CustomerDetail>(`/panel/customers/${id}`, { method: 'PATCH', body });
      qc.setQueryData(['panel', 'customer', id], updated);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success(ok);
      setNotes(null);
    } catch (err) {
      toast.error(errorMessage(err, 'Kaydedilemedi.'));
    } finally {
      setBusy(null);
    }
  }

  async function exportData() {
    setBusy('export');
    try {
      const data = await apiFetch<unknown>(`/panel/customers/${id}/export`, { method: 'POST' });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `musteri-${id.slice(0, 8)}-kvkk.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success('Müşteri verileri indirildi.');
    } catch (err) {
      toast.error(errorMessage(err, 'Dışa aktarılamadı.'));
    } finally {
      setBusy(null);
    }
  }

  async function erase() {
    setBusy('erase');
    try {
      await apiFetch(`/panel/customers/${id}/erase`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success('Müşteri verileri silindi; sipariş kayıtları anonim olarak kaldı.');
      setEraseOpen(false);
      onErased();
    } catch (err) {
      toast.error(errorMessage(err, 'Silinemedi.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-xl font-bold text-fg">
          {c.name || 'İsimsiz'}
          {c.isBlocked ? <Badge variant="danger">Kara liste</Badge> : null}
        </span>
        {c.phone ? (
          <a href={`tel:${c.phone}`} className="inline-flex min-h-hit items-center gap-2 self-start text-base font-semibold text-fg underline underline-offset-4">
            <Phone aria-hidden className="size-4" />
            {formatPhone(c.phone)}
          </a>
        ) : (
          <span className="text-sm text-fg-muted">Telefon yok</span>
        )}
        {c.waUsername ? <span className="text-sm text-fg-muted">WhatsApp: {c.waUsername}</span> : null}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Sipariş', String(c.orderCount)],
          ['Toplam', formatMoney(c.totalSpentKurus)],
          ['Ort. sepet', formatMoney(c.avgBasketKurus)],
          ['İlk sipariş', c.firstOrderAt ? formatRelative(c.firstOrderAt) : '—'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md bg-surface p-3">
            <dt className="text-sm text-fg-muted">{k}</dt>
            <dd className="font-semibold tabular-nums text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      {c.preferredFulfillment || c.preferredPaymentMethod || c.topProducts.length ? (
        <p className="text-sm text-fg">
          {c.preferredFulfillment ? `Genelde ${FULFILLMENT_TYPE_LABELS[c.preferredFulfillment].toLocaleLowerCase('tr-TR')}` : ''}
          {c.preferredPaymentMethod ? ` · ${PAYMENT_METHOD_LABELS[c.preferredPaymentMethod]}` : ''}
          {c.topProducts.length ? ` · Sık: ${c.topProducts.map((p) => `${p.name} (${p.quantity})`).join(', ')}` : ''}
        </p>
      ) : null}

      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void patch({ notes: noteValue.trim() || null }, 'Not kaydedildi.');
        }}
        className="flex flex-col gap-2"
      >
        <Field label="İşletme notu" hint="Örn: acısız sever, zili çalmayın. Sağlık bilgisi (alerji, hastalık) yazmayın.">
          <Textarea value={noteValue} onChange={(e) => setNotes(e.target.value)} maxLength={140} rows={2} />
        </Field>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-fg-muted">{noteValue.length}/140</span>
          <Button type="submit" variant="secondary" disabled={notes === null || noteValue === (c.notes ?? '')} loading={busy === 'patch'}>
            Notu kaydet
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <Switch
          checked={c.isBlocked}
          onCheckedChange={(on) => (on ? setBlockOpen(true) : void patch({ isBlocked: false }, 'Kara listeden çıkarıldı.'))}
          label={
            <span className="inline-flex items-center gap-2">
              <Ban aria-hidden className="size-4" />
              Kara liste
            </span>
          }
          description="Kara listedeki müşteri çevrimiçi sipariş veremez; işletmeyi araması istenir."
        />
      </div>

      {c.addresses.length ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-fg">Adresler</h3>
          <ul className="flex flex-col gap-2">
            {c.addresses.map((a) => (
              <li key={a.id} className="rounded-md bg-surface p-3 text-sm text-fg">
                <span className="font-semibold">{a.neighborhood}</span> {a.addressLine}
                {a.directions ? <span className="block text-fg-muted">Tarif: {a.directions}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-fg">Siparişler</h3>
        {orders.isPending ? (
          <SettingsLoading rows={1} />
        ) : orders.data?.items.length ? (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {orders.data.items.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="font-semibold text-fg">#{o.number}</span>
                <StatusBadge status={o.status} size="sm" />
                <span className="text-fg-muted">{formatDateTime(o.placedAt)}</span>
                <span className="ms-auto font-semibold tabular-nums text-fg">{formatMoney(o.totalKurus)}</span>
                <span className="w-full truncate text-fg-muted">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">Sipariş yok.</p>
        )}
      </section>

      {canKvkk ? (
        <section className="flex flex-col gap-2 rounded-md border border-border p-3">
          <h3 className="text-base font-semibold text-fg">Kişisel veri talepleri (KVKK)</h3>
          <p className="text-sm text-fg-muted">Müşteri verisini isterse dışa aktarın; silinmesini isterse anonimleştirin. Başvurular 30 gün içinde yanıtlanmalıdır.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void exportData()} loading={busy === 'export'}>
              <Download aria-hidden />
              Verileri dışa aktar
            </Button>
            <Button variant="danger" onClick={() => setEraseOpen(true)} disabled={c.openOrderCount > 0}>
              <Trash2 aria-hidden />
              Sil / anonimleştir
            </Button>
          </div>
          {c.openOrderCount > 0 ? <p className="text-sm text-fg-muted">Açık siparişi varken silinemez.</p> : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        title="Kara listeye al"
        description="Sebep zorunludur ve kayıt altına alınır."
        confirmLabel="Kara listeye al"
        loading={busy === 'patch'}
        onConfirm={() => {
          if (blockReason.trim().length < 3) {
            toast.error('Kara liste sebebini yazın.');
            return;
          }
          void patch({ isBlocked: true, blockReason: blockReason.trim() }, 'Kara listeye alındı.').then(() => {
            setBlockOpen(false);
            setBlockReason('');
          });
        }}
      >
        <Field label="Sebep" required>
          <Input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} maxLength={140} placeholder="Ör. Sahte sipariş verdi" />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={eraseOpen}
        onOpenChange={setEraseOpen}
        title="Müşteri verileri silinsin mi?"
        description="Ad, telefon, adresler, not ve sohbet içerikleri kalıcı olarak silinir. Sipariş tutarları mali kayıt olarak anonim kalır. Bu işlem geri alınamaz."
        confirmLabel="Sil ve anonimleştir"
        loading={busy === 'erase'}
        onConfirm={() => void erase()}
      />
    </div>
  );
}
