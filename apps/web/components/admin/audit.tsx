'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ScrollText, ShieldAlert } from 'lucide-react';
import type { AdminAuditEntry, AdminAuditResponse } from '@siparis/core/admin/contracts';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { formatDateTime } from '@/lib/format';
import { auditActionLabel } from './admin-labels';
import { JsonBlock, LoadMore, QueryError, useAdminAccess, useCursorList } from './common';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTION_PREFIXES = [
  { value: '', label: 'Tüm aksiyonlar' },
  { value: 'admin.', label: 'Platform ekibi (admin.)' },
  { value: 'admin.impersonation', label: 'Destek erişimi' },
  { value: 'admin.tenant_update', label: 'İşletme güncelleme' },
  { value: 'admin.subscription', label: 'Abonelik' },
  { value: 'admin.flag', label: 'Bayraklar' },
  { value: 'admin.job', label: 'İşler' },
  { value: 'admin.lead', label: 'Lead’ler' },
  { value: 'admin.note', label: 'Notlar' },
  { value: 'tenant.', label: 'İşletme (tenant.)' },
  { value: 'order.', label: 'Sipariş (order.)' },
  { value: 'menu.', label: 'Menü (menu.)' },
];

/** A-18 denetim kaydı: aktör, işletme, aksiyon, destek erişimi filtreleri. */
export function AuditScreen() {
  const sp = useSearchParams();
  const { role } = useAdminAccess();
  const [tenantId, setTenantId] = useState(sp.get('tenantId') ?? '');
  const [actor, setActor] = useState(sp.get('actor') ?? '');
  const [debActor, setDebActor] = useState(actor);
  const [action, setAction] = useState(sp.get('action') ?? '');
  const [impOnly, setImpOnly] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebActor(actor.trim()), 400);
    return () => clearTimeout(t);
  }, [actor]);

  const tenantValid = !tenantId || UUID_RE.test(tenantId.trim());
  const list = useCursorList<AdminAuditEntry, AdminAuditResponse>(
    ['admin', 'audit'],
    '/admin/audit',
    {
      tenantId: tenantValid && tenantId.trim() ? tenantId.trim() : undefined,
      actor: debActor || undefined,
      action: action || undefined,
      impersonation: impOnly ? '1' : undefined,
    },
    { enabled: tenantValid },
  );

  return (
    <>
      <PageHeader
        title="Denetim kaydı"
        description={
          role === 'support_agent'
            ? 'Yalnız kendi kayıtlarınız görünür.'
            : role === 'finance'
              ? 'Yalnız abonelik ve finans kayıtları görünür.'
              : 'Tüm yazma işlemleri ve hassas okumalar. Kayıtlar değiştirilemez.'
        }
      />
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="İşletme kimliği" error={tenantValid ? undefined : 'Geçerli bir kimlik (UUID) girin.'}>
          <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="İşletme detayından gelir" autoComplete="off" />
        </Field>
        <Field label="Aktör" hint="E-posta, ad ya da kullanıcı kimliği">
          <Input value={actor} onChange={(e) => setActor(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Aksiyon">
          <Select value={action} onChange={(e) => setAction(e.target.value)} options={ACTION_PREFIXES} />
        </Field>
        <Switch checked={impOnly} onCheckedChange={setImpOnly} label="Yalnız destek erişimi kayıtları" showStateText={false} className="self-end" />
      </div>

      {list.isError ? <QueryError error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.isPending && tenantValid ? <Spinner label="Kayıtlar yükleniyor" /> : null}
      {list.isSuccess && !list.items.length ? <EmptyState icon={ScrollText} title="Kayıt yok" description="Filtreleri değiştirin." /> : null}
      {list.items.length ? (
        <ol className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface-raised">
          {list.items.map((e) => (
            <AuditRow key={e.id} e={e} />
          ))}
        </ol>
      ) : null}
      <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
    </>
  );
}

function AuditRow({ e }: { e: AdminAuditEntry }) {
  const reason = typeof e.data?.reason === 'string' ? e.data.reason : null;
  return (
    <li className="flex flex-col gap-1.5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-fg">{auditActionLabel(e.action)}</span>
        <code className="text-xs text-fg-muted">{e.action}</code>
        {e.impersonatorUserId ? (
          <Badge variant="danger" size="sm">
            <ShieldAlert aria-hidden />
            Destek erişimi
          </Badge>
        ) : null}
        <span className="ms-auto whitespace-nowrap text-sm text-fg-muted">{formatDateTime(e.createdAt)}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
        <span>
          Aktör: <span className="text-fg">{e.actorName ?? 'Sistem'}</span>
          {e.actorEmail ? ` (${e.actorEmail})` : ''}
        </span>
        {e.impersonatorName && e.impersonatorUserId !== e.actorUserId ? <span>Destek: {e.impersonatorName}</span> : null}
        {e.tenantId ? (
          <span>
            İşletme:{' '}
            <Link href={`/admin/isletmeler/${e.tenantId}`} className="text-fg underline-offset-4 hover:underline">
              {e.tenantName ?? e.tenantId}
            </Link>
          </span>
        ) : null}
        {e.entityType ? (
          <span>
            Kayıt: {e.entityType}
            {e.entityId ? ` · ${e.entityId.slice(0, 8)}` : ''}
          </span>
        ) : null}
        {e.ip ? <span>IP: {e.ip}</span> : null}
      </div>
      {reason ? <p className="text-base text-fg">Gerekçe: {reason}</p> : null}
      {e.data && Object.keys(e.data).length ? (
        <details>
          <summary className="inline-flex min-h-hit cursor-pointer items-center text-sm font-semibold text-fg">Ayrıntı</summary>
          <JsonBlock value={e.data} />
        </details>
      ) : null}
    </li>
  );
}
