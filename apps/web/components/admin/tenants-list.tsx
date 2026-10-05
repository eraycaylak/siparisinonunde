'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Building2, Search } from 'lucide-react';
import type { AdminTenantListItem, AdminTenantListResponse } from '@siparis/core/admin/contracts';
import { ADMIN_ONBOARDING_STUCK_HOURS, adminOnboardingStepLabel } from '@siparis/core/admin/onboarding';
import { LIFECYCLE_STAGES, WA_MODE_LABELS, type LifecycleStage } from '@siparis/core/enums';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { formatNumber, formatRelative } from '@/lib/format';
import { LIFECYCLE_STAGE_LABELS, PLAN_CODE_LABELS } from '@/lib/labels';
import { LoadMore, QueryError, StageBadge, WaStatusBadge, useCursorList } from './common';

function isStage(v: string | null): v is LifecycleStage {
  return v !== null && (LIFECYCLE_STAGES as readonly string[]).includes(v);
}

/**
 * A-03 işletmeler listesi: ad/slug/telefon araması, aşama filtresi, "takılanlar" görünümü. Filtreler URL'de tutulur.
 * Kurulum adımı ve son hareket sütunları onboarding hunisini görünür kılar (05 §A-03; denetim H28: `onboarding_step`
 * yazılıyordu ama hiçbir ekranda okunmuyordu, yani kurulumda takılan işletme fark edilmiyordu).
 */
export function TenantsListScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const initialStage = sp.get('stage');
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const [stage, setStage] = useState<LifecycleStage | ''>(isStage(initialStage) ? initialStage : '');
  const [stuck, setStuck] = useState(sp.get('stuck') === '1');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (debounced) next.set('q', debounced);
    if (stage) next.set('stage', stage);
    if (stuck) next.set('stuck', '1');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [debounced, stage, stuck, pathname, router]);

  const list = useCursorList<AdminTenantListItem, AdminTenantListResponse>(['admin', 'tenants'], '/admin/tenants', {
    q: debounced || undefined,
    stage: stage || undefined,
    stuck: stuck ? '1' : undefined,
  });

  return (
    <>
      <PageHeader title="İşletmeler" description="Ad, adres (slug) ya da telefonla arayın. Telefon tam eşleşir." />
      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
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
        <Switch
          checked={stuck}
          onCheckedChange={setStuck}
          label="Yalnız takılanlar"
          showStateText={false}
          className="self-end"
        />
      </div>
      {stuck ? (
        <p className="mb-3 text-sm text-fg-muted">
          Canlıya geçmemiş ve aynı kurulum adımında {ADMIN_ONBOARDING_STUCK_HOURS} saatten uzun kalmış işletmeler. Askıdaki ve kapanmış
          işletmeler listelenmez.
        </p>
      ) : null}

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
              <TH>Kurulum</TH>
              <TH>Şehir</TH>
              <TH className="text-end">7 gün</TH>
              <TH>Son sipariş</TH>
              <TH>Son hareket</TH>
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
                <TD>
                  <div className="flex flex-col items-start gap-1">
                    <span className="whitespace-nowrap text-sm">{adminOnboardingStepLabel(t.onboardingStep)}</span>
                    {t.onboardingStuck ? (
                      <Badge variant="warning" size="sm">
                        Takıldı · {formatRelative(t.onboardingStepAt)}
                      </Badge>
                    ) : null}
                  </div>
                </TD>
                <TD className="whitespace-nowrap">{[t.city, t.district].filter(Boolean).join(' / ') || '—'}</TD>
                <TD className="text-end tabular-nums">{formatNumber(t.orders7d)}</TD>
                <TD className="whitespace-nowrap text-fg-muted">{t.lastOrderAt ? formatRelative(t.lastOrderAt) : '—'}</TD>
                <TD className="whitespace-nowrap text-fg-muted">{t.lastActivityAt ? formatRelative(t.lastActivityAt) : 'Hiç'}</TD>
                <TD>
                  <div className="flex flex-col items-start gap-1">
                    <WaStatusBadge status={t.waStatus} />
                    <span className="whitespace-nowrap text-xs text-fg-muted">
                      {WA_MODE_LABELS[t.waMode]}
                      {t.waCode ? ` · #${t.waCode}` : ''}
                    </span>
                  </div>
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
