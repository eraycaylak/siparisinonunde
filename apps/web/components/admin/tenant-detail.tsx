'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, ExternalLink, ScrollText, ShieldAlert, ShoppingBag } from 'lucide-react';
import type { AdminOrderRow, AdminTenantDetail, AdminTenantOrdersResponse } from '@siparis/core/admin/contracts';
import { WA_MODE_LABELS } from '@siparis/core/enums';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Spinner } from '@/components/ui/spinner';
import { ChannelBadge, OrderingStateBadge, StatusBadge } from '@/components/ui/status-badge';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApiQuery } from '@/lib/api';
import { formatDateLong, formatDateTime, formatNumber, formatPhone, formatRelative, formatTime } from '@/lib/format';
import { CANCEL_REASON_LABELS, PLAN_CODE_LABELS, REJECTION_REASON_LABELS, TENANT_ROLE_LABELS } from '@/lib/labels';
import { storefrontHref } from '@/lib/storefront-url';
import { SUBSCRIPTION_STATUS_LABELS, SUSPENSION_REASON_LABELS } from './admin-labels';
import { InfoRow, LoadMore, QueryError, StageBadge, StatCard, useAdminAccess, useCursorList } from './common';
import { ImpersonateButton } from './impersonate-dialog';
import { TenantManageForm } from './tenant-manage-form';
import { TenantNotes } from './tenant-notes';
import { TenantWhatsappCard } from './tenant-whatsapp';
import { WaAccountsTable } from './wa-table';

type TabKey = 'genel' | 'whatsapp' | 'siparisler' | 'notlar' | 'uyeler';

/** A-04 işletme detayı (360°). */
export function TenantDetailScreen({ id }: { id: string }) {
  const q = useApiQuery<AdminTenantDetail>(['admin', 'tenant', id], `/admin/tenants/${id}`);
  const { can } = useAdminAccess();
  const [tab, setTab] = useState<TabKey>('genel');

  if (q.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" label="İşletme yükleniyor" />
      </div>
    );
  }
  if (q.isError) {
    if (q.error.status === 404) {
      return (
        <EmptyState
          title="İşletme bulunamadı"
          description="Kayıt silinmiş ya da adres hatalı olabilir."
          action={
            <Link href="/admin/isletmeler" className={buttonVariants({ variant: 'secondary' })}>
              İşletmelere dön
            </Link>
          }
        />
      );
    }
    return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  }

  const d = q.data;
  const t = d.tenant;

  return (
    <>
      <Link href="/admin/isletmeler" className="mb-3 inline-flex min-h-hit items-center gap-2 text-base font-semibold text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden className="size-5" />
        İşletmeler
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-bold leading-8 text-fg sm:text-3xl">{t.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <StageBadge stage={t.lifecycleStage} size="md" />
            {t.suspensionReason ? (
              <Badge variant="danger">{SUSPENSION_REASON_LABELS[t.suspensionReason]}</Badge>
            ) : null}
            <Badge variant="outline">{PLAN_CODE_LABELS[t.planCode]}</Badge>
            {!t.orderingEnabled ? <Badge variant="danger">Online sipariş kapalı</Badge> : null}
            {t.isDemo ? <Badge variant="outline">Demo</Badge> : null}
            <Badge variant={t.waMode === 'shared' ? 'info' : 'outline'}>
              {WA_MODE_LABELS[t.waMode]}
              {t.waCode ? ` · #${t.waCode}` : ''}
            </Badge>
            <span className="text-sm text-fg-muted">{t.slug}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={storefrontHref(t.slug)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary' })}>
            <ExternalLink aria-hidden />
            Vitrini aç
          </a>
          {can('audit:read') ? (
            <Link href={`/admin/denetim?tenantId=${t.id}`} className={buttonVariants({ variant: 'secondary' })}>
              <ScrollText aria-hidden />
              Denetim kaydı
            </Link>
          ) : null}
          {can('impersonation:start') ? <ImpersonateButton tenantId={t.id} tenantName={t.name} /> : null}
        </div>
      </div>

      {d.activeImpersonations.length ? (
        <Alert variant="warning" title="Açık destek erişimi" className="mb-4">
          {d.activeImpersonations
            .map((i) => `${i.impersonatorName ?? 'Bilinmeyen'} · bitiş ${formatTime(i.expiresAt)}`)
            .join(' · ')}
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList label="İşletme bölümleri">
          <TabsTrigger value="genel">Genel</TabsTrigger>
          <TabsTrigger value="whatsapp">
            WhatsApp
            {d.waAccounts.some((a) => a.health === 'red') ? <span className="size-2 rounded-full bg-status-new-fg" aria-label="hata var" /> : null}
          </TabsTrigger>
          <TabsTrigger value="siparisler">Siparişler</TabsTrigger>
          <TabsTrigger value="notlar">Notlar ({d.notes.length})</TabsTrigger>
          <TabsTrigger value="uyeler">Üyeler ({d.members.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="genel">
          <GeneralTab d={d} />
        </TabsContent>
        <TabsContent value="whatsapp">
          <div className="flex flex-col gap-4">
            <TenantWhatsappCard detail={d} />
            {d.waAccounts.length ? (
              <WaAccountsTable items={d.waAccounts} showTenant={false} />
            ) : (
              <EmptyState title="WhatsApp hesabı yok" description="İşletme henüz WhatsApp bağlamadı; web siparişleri SMS ile doğrulanır." />
            )}
          </div>
        </TabsContent>
        <TabsContent value="siparisler">
          <OrdersTab tenantId={t.id} />
        </TabsContent>
        <TabsContent value="notlar">
          <TenantNotes tenantId={t.id} />
        </TabsContent>
        <TabsContent value="uyeler">
          <MembersTab d={d} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function GeneralTab({ d }: { d: AdminTenantDetail }) {
  const t = d.tenant;
  const sub = d.subscription;
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Sipariş özeti" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Son 7 gün sipariş" value={formatNumber(d.stats.orders7d)} hint={d.stats.lastOrderAt ? `Son: ${formatRelative(d.stats.lastOrderAt)}` : 'Henüz sipariş yok'} />
        <StatCard label="30 gün teslim" value={formatNumber(d.stats.delivered30d)} hint={<Money kurus={d.stats.revenue30dKurus} moneyStyle="text" />} />
        <StatCard label="Kaçan (30 gün)" value={formatNumber(d.stats.missed30d)} tone={d.stats.missed30d > 0 ? 'danger' : 'ok'} />
        <StatCard label="Toplam sipariş" value={formatNumber(d.stats.ordersTotal)} hint="Test siparişleri hariç" />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profil</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              <InfoRow label="Ticari unvan">{t.legalName}</InfoRow>
              <InfoRow label="VKN / TCKN">{t.taxNo ? `${t.taxNo}${t.taxOffice ? ` · ${t.taxOffice}` : ''}` : null}</InfoRow>
              <InfoRow label="Telefon">{t.phone ? formatPhone(t.phone) : null}</InfoRow>
              <InfoRow label="E-posta">{t.email}</InfoRow>
              <InfoRow label="Adres">{t.address}</InfoRow>
              <InfoRow label="Kayıt">{formatDateLong(t.createdAt)}</InfoRow>
              <InfoRow label="Web canlı">{t.webLiveAt ? formatDateLong(t.webLiveAt) : null}</InfoRow>
              <InfoRow label="Tam canlı">{t.liveAt ? formatDateLong(t.liveAt) : null}</InfoRow>
              <InfoRow label="SMS yedeği">{t.smsFallbackEnabled ? 'Açık' : 'Kapalı'}</InfoRow>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Abonelik</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              <InfoRow label="Plan">{PLAN_CODE_LABELS[t.planCode]}</InfoRow>
              <InfoRow label="Durum">{sub ? SUBSCRIPTION_STATUS_LABELS[sub.status] : 'Abonelik kaydı yok'}</InfoRow>
              <InfoRow label="Deneme bitişi">{t.trialEndsAt ? formatDateLong(t.trialEndsAt) : null}</InfoRow>
              <InfoRow label="Dönem sonu">{sub?.currentPeriodEnd ? formatDateLong(sub.currentPeriodEnd) : null}</InfoRow>
              <InfoRow label="Kurucu indirimi">{sub?.founderDiscountBp != null ? `%${sub.founderDiscountBp / 100}` : null}</InfoRow>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Şubeler</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y divide-border">
            {d.branches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="flex flex-col">
                  <span className="text-base font-semibold text-fg">{b.name}</span>
                  <span className="text-sm text-fg-muted">
                    {[b.neighborhood, b.district, b.city].filter(Boolean).join(', ')}
                    {' · '}
                    {[b.acceptsDelivery ? 'Paket' : null, b.acceptsPickup ? 'Gel-al' : null].filter(Boolean).join(' + ') || 'Teslim türü kapalı'}
                  </span>
                </div>
                <OrderingStateBadge
                  state={b.orderingState}
                  detail={b.pausedUntil ? `${formatTime(b.pausedUntil)}'e kadar` : b.busyExtraMinutes ? `+${b.busyExtraMinutes} dk` : undefined}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <TenantManageForm detail={d} />

      {d.notes[0] ? (
        <Card>
          <CardHeader>
            <CardTitle>Son destek notu</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-base">{d.notes[0].body}</p>
            <p className="mt-2 text-sm text-fg-muted">
              {d.notes[0].authorName ?? 'Bilinmeyen'} · {formatDateTime(d.notes[0].createdAt)}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function approval(o: AdminOrderRow): string {
  if (o.approvalSeconds == null) return '—';
  const m = Math.floor(o.approvalSeconds / 60);
  const s = o.approvalSeconds % 60;
  return m ? `${m} dk ${s} sn` : `${s} sn`;
}

function OrdersTab({ tenantId }: { tenantId: string }) {
  const list = useCursorList<AdminOrderRow, AdminTenantOrdersResponse>(['admin', 'tenant', tenantId, 'orders'], `/admin/tenants/${tenantId}/orders`);
  if (list.isError) return <QueryError error={list.error} onRetry={() => void list.refetch()} />;
  if (list.isPending) return <Spinner label="Siparişler yükleniyor" />;
  if (!list.items.length) return <EmptyState icon={ShoppingBag} title="Sipariş yok" description="Bu işletmeye henüz sipariş düşmedi." />;
  return (
    <>
      <p className="mb-3 flex items-center gap-2 text-sm text-fg-muted">
        <ShieldAlert aria-hidden className="size-4" />
        Müşteri adı, telefonu ve adresi burada gösterilmez; gerekirse salt-okunur destek erişimiyle bakılır.
      </p>
      <Table>
        <THead>
          <TR>
            <TH>No</TH>
            <TH>Durum</TH>
            <TH>Kanal</TH>
            <TH className="text-end">Tutar</TH>
            <TH>Zaman</TH>
            <TH>Onay süresi</TH>
            <TH>Sebep</TH>
          </TR>
        </THead>
        <TBody>
          {list.items.map((o) => (
            <TR key={o.id}>
              <TD className="font-semibold tabular-nums">
                #{o.number}
                {o.testKind ? (
                  <Badge variant="outline" size="sm" className="ms-2">
                    Test
                  </Badge>
                ) : null}
              </TD>
              <TD>
                <StatusBadge status={o.status} size="sm" />
              </TD>
              <TD>
                <ChannelBadge channel={o.channel} />
              </TD>
              <TD className="text-end tabular-nums">
                <Money kurus={o.totalKurus} moneyStyle="text" />
              </TD>
              <TD className="whitespace-nowrap">{formatDateTime(o.placedAt)}</TD>
              <TD className="whitespace-nowrap">{approval(o)}</TD>
              <TD className="text-sm">
                {o.cancelReason ? CANCEL_REASON_LABELS[o.cancelReason] : o.rejectionReason ? REJECTION_REASON_LABELS[o.rejectionReason] : '—'}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
    </>
  );
}

function MembersTab({ d }: { d: AdminTenantDetail }) {
  if (!d.members.length) return <EmptyState title="Üye yok" />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Ad</TH>
          <TH>Rol</TH>
          <TH>E-posta / telefon</TH>
          <TH>Son giriş</TH>
          <TH>2FA</TH>
        </TR>
      </THead>
      <TBody>
        {d.members.map((m) => (
          <TR key={m.userId}>
            <TD className="font-semibold">
              {m.name}
              {m.disabled ? (
                <Badge variant="neutral" size="sm" className="ms-2">
                  Devre dışı
                </Badge>
              ) : null}
            </TD>
            <TD>
              {TENANT_ROLE_LABELS[m.role]}
              {m.branchId ? <div className="text-xs text-fg-muted">{d.branches.find((b) => b.id === m.branchId)?.name ?? 'Şube kısıtlı'}</div> : null}
            </TD>
            <TD>
              <div>{m.email ?? '—'}</div>
              {m.phone ? <div className="text-sm text-fg-muted">{m.phone}</div> : null}
            </TD>
            <TD className="whitespace-nowrap">{m.lastLoginAt ? formatRelative(m.lastLoginAt) : 'Hiç'}</TD>
            <TD>{m.hasTotp ? <Badge variant="success" size="sm">Açık</Badge> : <Badge variant="warning" size="sm">Yok</Badge>}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
