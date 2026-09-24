'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Building2, Search } from 'lucide-react';
import type { AdminTenantListItem, AdminTenantListResponse } from '@siparis/core/admin/contracts';
import { LIFECYCLE_STAGES, type LifecycleStage } from '@siparis/core/enums';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { formatNumber, formatRelative } from '@/lib/format';
import { LIFECYCLE_STAGE_LABELS, PLAN_CODE_LABELS } from '@/lib/labels';
import { LoadMore, QueryError, StageBadge, WaStatusBadge, useCursorList } from './common';

function isStage(v: string | null): v is LifecycleStage {
  return v !== null && (LIFECYCLE_STAGES as readonly string[]).includes(v);
}

/** A-03 işletmeler listesi: ad/slug/telefon araması, aşama filtresi. Filtreler URL'de tutulur. */
export function TenantsListScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const initialStage = sp.get('stage');
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const [stage, setStage] = useState<LifecycleStage | ''>(isStage(initialStage) ? initialStage : '');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (debounced) next.set('q', debounced);
    if (stage) next.set('stage', stage);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [debounced, stage, pathname, router]);

  const list = useCursorList<AdminTenantListItem, AdminTenantListResponse>(['admin', 'tenants'], '/admin/tenants', {
    q: debounced || undefined,
    stage: stage || undefined,
  });

  return (
    <>
      <PageHeader title="İşletmeler" description="Ad, adres (slug) ya da telefonla arayın. Telefon tam eşleşir." />
      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Ara" hideLabel>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="İşletme adı, slug ya da 0 5xx xxx xx xx"
              className="ps-10"
              aria-label="İşletme ara"
            />
          </div>
        </Field>
        <Field label="Aşama" hideLabel>
          <Select
            aria-label="Aşama"
            value={stage}
            onChange={(e) => setStage(e.target.value as LifecycleStage | '')}
            options={[{ value: '', label: 'Tüm aşamalar' }, ...LIFECYCLE_STAGES.map((s) => ({ value: s, label: LIFECYCLE_STAGE_LABELS[s] }))]}
          />
        </Field>
      </div>

      {list.isError ? <QueryError error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner label="İşletmeler yükleniyor" />
        </div>
      ) : null}
      {list.isSuccess && list.items.length === 0 ? (
        <EmptyState icon={Building2} title="İşletme bulunamadı" description="Aramayı ya da aşama filtresini değiştirin." />
      ) : null}
      {list.items.length > 0 ? (
        <Table>
          <THead>
            <TR>
              <TH>İşletme</TH>
              <TH>Aşama</TH>
              <TH>Plan</TH>
              <TH>Şehir</TH>
              <TH className="text-end">7 gün</TH>
              <TH>Son sipariş</TH>
              <TH>WhatsApp</TH>
            </TR>
          </THead>
          <TBody>
            {list.items.map((t) => (
              <TR key={t.id} className="hover:bg-accent">
                <TD>
                  <Link
                    href={`/admin/isletmeler/${t.id}`}
                    className="flex min-h-hit flex-col justify-center font-semibold text-fg underline-offset-4 hover:underline"
                  >
                    <span>{t.name}</span>
                    <span className="text-sm font-normal text-fg-muted">{t.slug}</span>
                  </Link>
                </TD>
                <TD>
                  <div className="flex flex-wrap items-center gap-1">
                    <StageBadge stage={t.lifecycleStage} />
                    {!t.orderingEnabled ? (
                      <Badge variant="danger" size="sm">
                        Sipariş kapalı
                      </Badge>
                    ) : null}
                    {t.isDemo ? (
                      <Badge variant="outline" size="sm">
                        Demo
                      </Badge>
                    ) : null}
                  </div>
                </TD>
                <TD>{PLAN_CODE_LABELS[t.planCode]}</TD>
                <TD className="whitespace-nowrap">{[t.city, t.district].filter(Boolean).join(' / ') || '—'}</TD>
                <TD className="text-end tabular-nums">{formatNumber(t.orders7d)}</TD>
                <TD className="whitespace-nowrap text-fg-muted">{t.lastOrderAt ? formatRelative(t.lastOrderAt) : '—'}</TD>
                <TD>
                  <WaStatusBadge status={t.waStatus} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : null}
      <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
    </>
  );
}
