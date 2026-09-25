'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  AlertOctagon,
  Archive,
  Briefcase,
  Building2,
  Clock,
  Inbox,
  MessageCircleWarning,
  RefreshCw,
  ShoppingBag,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { AdminOverview } from '@siparis/core/admin/contracts';
import { LIFECYCLE_STAGES } from '@siparis/core/enums';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiQuery } from '@/lib/api';
import { formatMoney, formatNumber, formatRelative, formatTime } from '@/lib/format';
import { LIFECYCLE_STAGE_LABELS } from '@/lib/labels';
import { LEAD_SOURCE_LABELS } from './admin-labels';
import { QueryError, StatCard } from './common';

/** A-02 kontrol paneli: "şu an ne bozuk" + "iş nasıl gidiyor". 30 sn'de bir yenilenir. */
export function AdminOverviewScreen() {
  const q = useApiQuery<AdminOverview>(['admin', 'overview'], '/admin/overview', { refetchInterval: 30_000 });
  const o = q.data;

  return (
    <>
      <PageHeader
        title="Özet"
        description={o ? `Son güncelleme ${formatTime(o.generatedAt)} · 30 saniyede bir yenilenir` : 'Platform geneli durum'}
        actions={
          <Button variant="secondary" onClick={() => void q.refetch()} loading={q.isFetching}>
            <RefreshCw aria-hidden />
            Yenile
          </Button>
        }
      />
      {q.isError ? <QueryError error={q.error} onRetry={() => void q.refetch()} /> : null}
      {!o && q.isPending ? <OverviewSkeleton /> : null}
      {o ? (
        <div className="flex flex-col gap-6">
          <section aria-label="Canlı operasyon" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              icon={ShoppingBag}
              label="Bugünkü sipariş"
              value={formatNumber(o.ordersToday)}
              hint={`Ciro ${formatMoney(o.revenueTodayKurus)} · test siparişleri hariç`}
            />
            <StatCard
              icon={Clock}
              label="Onay bekleyen"
              value={formatNumber(o.openNewOrders)}
              tone={o.lateNewOrders > 0 ? 'warning' : 'neutral'}
              hint={o.lateNewOrders > 0 ? `${o.lateNewOrders} sipariş 2 dakikayı aştı` : '2 dakikayı aşan yok'}
            />
            <StatCard
              icon={AlertOctagon}
              label="Kaçan sipariş (24 sa)"
              value={formatNumber(o.missedOrders24h)}
              tone={o.missedOrders24h > 0 ? 'danger' : 'ok'}
              hint="İşletme yanıt vermedi, otomatik iptal"
            />
            <StatCard
              icon={Briefcase}
              label="Başarısız iş"
              value={formatNumber(o.failedJobs)}
              tone={o.failedJobs > 0 ? 'danger' : 'ok'}
              href="/admin/isler"
              hint={
                o.oldestPendingJobAgeSec != null && o.oldestPendingJobAgeSec > 60
                  ? `En eski bekleyen iş ${Math.round(o.oldestPendingJobAgeSec / 60)} dk`
                  : `${o.pendingJobs} bekleyen`
              }
            />
            <StatCard
              icon={MessageCircleWarning}
              label="WhatsApp sorunu"
              value={formatNumber(o.waErrorAccounts + o.waSilentAccounts)}
              tone={o.waErrorAccounts > 0 ? 'danger' : o.waSilentAccounts > 0 ? 'warning' : 'ok'}
              href="/admin/whatsapp"
              hint={`${o.waErrorAccounts} hata · ${o.waSilentAccounts} sessiz`}
            />
            <StatCard
              icon={Archive}
              label="Saklama işi"
              value={o.retention.error ? 'Hata' : o.retention.stale ? 'Gecikti' : 'Çalışıyor'}
              tone={o.retention.error ? 'danger' : o.retention.stale ? 'warning' : 'ok'}
              hint={
                o.retention.error
                  ? o.retention.error
                  : o.retention.lastRunAt
                    ? `Son koşu ${formatRelative(o.retention.lastRunAt)}${o.retention.stale ? ' · 48 saati aştı' : ''}`
                    : 'Henüz koşmadı'
              }
            />
            <StatCard icon={Building2} label="İşletme" value={formatNumber(o.tenantsTotal)} href="/admin/isletmeler" />
            <StatCard icon={UserPlus} label="Yeni kayıt (7 gün)" value={formatNumber(o.newTenants7d)} />
            <StatCard
              icon={Inbox}
              label="Lead"
              value={formatNumber(o.leadsTotal)}
              tone={o.leadsNew > 0 ? 'warning' : 'neutral'}
              href="/admin/leadler"
              hint={`${o.leadsNew} yeni`}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Yaşam döngüsü</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
                {LIFECYCLE_STAGES.map((s) => (
                  <li key={s}>
                    <Link
                      href={`/admin/isletmeler?stage=${s}`}
                      className="flex min-h-hit flex-col rounded-md border border-border px-3 py-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="text-sm text-fg-muted">{LIFECYCLE_STAGE_LABELS[s]}</span>
                      <span className="text-xl font-bold tabular-nums text-fg">{o.tenantsByStage[s]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <AlertList
              title="Kaçan siparişler"
              icon={AlertOctagon}
              empty="Son 24 saatte kaçan sipariş yok."
              items={o.alerts.missedOrders.map((m) => ({
                key: m.orderId,
                href: `/admin/isletmeler/${m.tenantId}`,
                title: `${m.tenantName} · #${m.number}`,
                meta: m.cancelledAt ? formatRelative(m.cancelledAt) : '',
              }))}
            />
            <AlertList
              title="WhatsApp hataları"
              icon={MessageCircleWarning}
              empty="Hata ya da sessizlik yok."
              moreHref="/admin/whatsapp"
              items={o.alerts.waProblems.map((w) => ({
                key: w.waAccountId,
                href: `/admin/isletmeler/${w.tenantId}`,
                title: w.tenantName,
                meta: w.status === 'error' ? (w.lastError ?? 'Bağlantı hatası') : `Sessiz · son webhook ${w.lastWebhookAt ? formatRelative(w.lastWebhookAt) : 'hiç'}`,
              }))}
            />
            <AlertList
              title="Başarısız işler"
              icon={Briefcase}
              empty="Başarısız iş yok."
              moreHref="/admin/isler"
              items={o.alerts.failedJobs.map((j) => ({
                key: j.id,
                href: '/admin/isler',
                title: `${j.type}${j.tenantName ? ` · ${j.tenantName}` : ''}`,
                meta: j.lastError ?? '',
              }))}
            />
            <AlertList
              title="Yeni lead’ler"
              icon={Inbox}
              empty="Yeni lead yok."
              moreHref="/admin/leadler"
              items={o.alerts.newLeads.map((l) => ({
                key: l.id,
                href: '/admin/leadler',
                title: `${l.businessName ?? l.name ?? 'Adsız'}${l.city ? ` · ${l.city}` : ''}`,
                meta: `${LEAD_SOURCE_LABELS[l.source] ?? l.source} · ${formatRelative(l.createdAt)}`,
              }))}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function AlertList({
  title,
  icon: Icon,
  items,
  empty,
  moreHref,
}: {
  title: string;
  icon: LucideIcon;
  items: { key: string; href: string; title: string; meta: ReactNode }[];
  empty: string;
  moreHref?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Icon aria-hidden className="size-5" />
          {title}
          {items.length ? <span className="text-base font-semibold text-fg-muted">({items.length})</span> : null}
        </CardTitle>
        {moreHref ? (
          <Link href={moreHref} className="inline-flex min-h-hit min-w-hit items-center justify-center px-2 text-sm font-semibold text-fg underline underline-offset-4">
            Tümü
          </Link>
        ) : null}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-base text-fg-muted">{empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((i) => (
              <li key={i.key}>
                <Link href={i.href} className="flex min-h-hit flex-col justify-center gap-0.5 py-2 hover:underline">
                  <span className="text-base font-semibold text-fg">{i.title}</span>
                  {i.meta ? <span className="line-clamp-2 text-sm text-fg-muted">{i.meta}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <Skeleton key={i} className="h-28 rounded-lg" />
      ))}
    </div>
  );
}
