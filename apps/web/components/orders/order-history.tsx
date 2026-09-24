'use client';

// Sipariş geçmişi (P-07, 04 §4.18): durum/tarih filtresi, arama (no, ad, telefonun son 4 hanesi), imleçli liste,
// detay çekmecesi ve yeniden yazdırma (KOPYA). Kasiyer bugün + dün görür (sunucu uygular).

import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ClipboardList, Printer, Search } from 'lucide-react';
import type { OrdersListResponse } from '@siparis/core/orders/contracts';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@siparis/core/enums';
import { Alert, Button, ChannelBadge, EmptyState, Field, FulfillmentBadge, IconButton, Input, PageHeader, Select, Spinner, StatusBadge } from '@/components/ui';
import { apiFetch, errorMessage } from '@/lib/api';
import { currentRole, useMe } from '@/lib/auth';
import { formatDateTime, formatMoney, toIstanbulDateKey } from '@/lib/format';
import { ORDERS_LIST_KEY, openReceipt } from './api';
import { OrderSheetsProvider, useOrderSheets } from './order-sheets';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Tüm durumlar' },
  { value: 'awaiting_customer,new', label: 'Bekleyen (yeni)' },
  { value: 'accepted,preparing,ready,on_the_way', label: 'Devam eden' },
  { value: 'delivered', label: ORDER_STATUS_LABELS.delivered },
  { value: 'rejected', label: ORDER_STATUS_LABELS.rejected },
  { value: 'cancelled', label: ORDER_STATUS_LABELS.cancelled },
];

export function OrderHistory() {
  const me = useMe();
  const role = currentRole(me.data);
  if (!role) return <Spinner label="Yükleniyor" />;
  return (
    <OrderSheetsProvider role={role}>
      <HistoryInner cashier={role === 'cashier'} />
    </OrderSheetsProvider>
  );
}

function HistoryInner({ cashier }: { cashier: boolean }) {
  const { openDetail } = useOrderSheets();
  const today = toIstanbulDateKey(new Date());
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const list = useInfiniteQuery({
    queryKey: [...ORDERS_LIST_KEY, { status, from, to, q }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch<OrdersListResponse>('/panel/orders', {
        signal,
        query: { status: status || undefined, from: q ? undefined : from || undefined, to: q ? undefined : to || undefined, q: q || undefined, cursor: pageParam, limit: 30 },
      }),
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Siparişler" description={cashier ? 'Bugün ve dünün siparişleri.' : 'Geçmiş siparişler, arama ve yeniden yazdırma.'} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Ara" hint="Sipariş no, ad ya da telefonun son 4 hanesi">
          <Input value={search} inputMode="search" onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <Field label="Durum">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_FILTERS} />
        </Field>
        <Field label="Başlangıç">
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Bitiş">
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {q ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Search aria-hidden className="size-4" /> Arama tüm tarihlerde yapılır.
        </p>
      ) : null}
      {list.isPending ? <Spinner label="Siparişler yükleniyor" /> : null}
      {list.isError ? <Alert variant="danger">{errorMessage(list.error)}</Alert> : null}
      {!list.isPending && rows.length === 0 ? <EmptyState icon={ClipboardList} title="Sipariş bulunamadı" description="Filtreleri değiştirip tekrar deneyin." /> : null}
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface-raised">
        {rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <button type="button" onClick={() => openDetail(c.id)} className="flex min-h-hit min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-start">
              <span className="text-lg font-bold tabular-nums">#{c.number}</span>
              <StatusBadge status={c.status as OrderStatus} size="sm" />
              <span className="text-sm text-fg-muted">{formatDateTime(c.placedAt)}</span>
              <span className="min-w-0 truncate text-base">{c.customerName ?? 'Müşteri'}</span>
              <ChannelBadge channel={c.channel} />
              <FulfillmentBadge type={c.fulfillmentType} />
              {c.testKind ? <span className="text-xs font-bold text-warning">TEST</span> : null}
            </button>
            {c.totalKurus != null ? <span className="font-semibold tabular-nums">{formatMoney(c.totalKurus)}</span> : null}
            <IconButton label={`#${c.number} fişini yeniden yazdır`} icon={<Printer />} onClick={() => openReceipt(c.id, 'delivery')} />
          </li>
        ))}
      </ul>
      {list.hasNextPage ? (
        <Button variant="secondary" size="lg" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
          Daha fazla göster
        </Button>
      ) : null}
    </div>
  );
}
