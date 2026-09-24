'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Inbox, Pencil, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AdminLead, AdminLeadPatch, AdminLeadsResponse } from '@siparis/core/admin/contracts';
import type { LeadStatus } from '@siparis/core/enums';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, errorMessage, fieldErrorsOf } from '@/lib/api';
import { formatDateTime, formatPhone, formatRelative } from '@/lib/format';
import { LEAD_SOURCE_LABELS, LEAD_STATUSES, LEAD_STATUS_LABELS } from './admin-labels';
import { JsonBlock, LoadMore, QueryError, useAdminAccess, useCursorList } from './common';

const STATUS_VARIANT: Record<LeadStatus, 'info' | 'warning' | 'success' | 'neutral' | 'brand' | 'danger'> = {
  new: 'danger',
  contacted: 'info',
  demo_scheduled: 'brand',
  demo_done: 'brand',
  proposal: 'warning',
  won: 'success',
  lost: 'neutral',
};

/** A-20 lead listesi: durum, not, işletmeye bağlama. */
export function LeadsScreen() {
  const { can } = useAdminAccess();
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [editing, setEditing] = useState<AdminLead | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = useCursorList<AdminLead, AdminLeadsResponse>(
    ['admin', 'leads'],
    '/admin/leads',
    { status: status || undefined, q: debounced || undefined },
    { refetchInterval: 60_000 },
  );
  const counts = list.first?.counts;

  return (
    <>
      <PageHeader title="Lead’ler" description="Demo formu ve hesaplayıcıdan gelen talepler. Yeni lead’e mesai içinde 2 iş saatinde dönün." />
      <div className="mb-4 flex flex-col gap-3">
        <div role="group" aria-label="Durum filtresi" className="flex flex-wrap gap-2">
          <Button variant={status === '' ? 'primary' : 'secondary'} aria-pressed={status === ''} onClick={() => setStatus('')}>
            Tümü
          </Button>
          {LEAD_STATUSES.map((s) => (
            <Button key={s} variant={status === s ? 'primary' : 'secondary'} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {LEAD_STATUS_LABELS[s]}
              {counts ? (
                <Badge size="sm" variant={s === 'new' && counts.new > 0 ? 'danger' : 'neutral'}>
                  {counts[s]}
                </Badge>
              ) : null}
            </Button>
          ))}
        </div>
        <Field label="Ara" hideLabel className="max-w-xl">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, işletme, şehir ya da telefon" className="ps-10" />
          </div>
        </Field>
      </div>

      {list.isError ? <QueryError error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.isPending ? <Spinner label="Lead’ler yükleniyor" /> : null}
      {list.isSuccess && !list.items.length ? <EmptyState icon={Inbox} title="Lead yok" description="Filtreyi değiştirin." /> : null}
      {list.items.length ? (
        <Table>
          <THead>
            <TR>
              <TH>İşletme / kişi</TH>
              <TH>Telefon</TH>
              <TH>Şehir</TH>
              <TH>Kaynak</TH>
              <TH>Durum</TH>
              <TH>Geldi</TH>
              <TH className="text-end">Aksiyon</TH>
            </TR>
          </THead>
          <TBody>
            {list.items.map((l) => (
              <TR key={l.id}>
                <TD>
                  <div className="font-semibold">{l.businessName ?? '—'}</div>
                  <div className="text-sm text-fg-muted">{l.name ?? ''}</div>
                  {l.notes ? <div className="mt-1 line-clamp-2 max-w-md text-xs text-fg-muted">{l.notes}</div> : null}
                </TD>
                <TD className="whitespace-nowrap">
                  {l.phone ? (
                    <a href={`tel:${l.phone}`} className="underline-offset-4 hover:underline">
                      {formatPhone(l.phone)}
                    </a>
                  ) : (
                    '—'
                  )}
                </TD>
                <TD>{l.city ?? '—'}</TD>
                <TD>{LEAD_SOURCE_LABELS[l.source] ?? l.source}</TD>
                <TD>
                  <Badge variant={STATUS_VARIANT[l.status]} size="sm">
                    {LEAD_STATUS_LABELS[l.status]}
                  </Badge>
                  {l.tenantName ? <div className="mt-1 text-xs text-fg-muted">{l.tenantName}</div> : null}
                </TD>
                <TD className="whitespace-nowrap" title={formatDateTime(l.createdAt)}>
                  {formatRelative(l.createdAt)}
                </TD>
                <TD className="text-end">
                  <Button variant="ghost" onClick={() => setEditing(l)}>
                    <Pencil aria-hidden />
                    {can('leads:write') ? 'Düzenle' : 'Ayrıntı'}
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : null}
      <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />

      {/* Diyalog hep bağlı kalır (yerel <dialog> açık bağlanırsa StrictMode çift efektinde hemen kapanır). */}
      <LeadDialog lead={editing} canWrite={can('leads:write')} onClose={() => setEditing(null)} />
    </>
  );
}

function LeadDialog({ lead, canWrite, onClose }: { lead: AdminLead | null; canWrite: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LeadStatus>('new');
  const [notes, setNotes] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!lead) return;
    setStatus(lead.status);
    setNotes(lead.notes ?? '');
    setTenantSlug('');
    setErrors({});
  }, [lead]);

  if (!lead) return <Dialog open={false} onOpenChange={() => undefined} title="" />;

  const needsTenant = status === 'won' && !lead.tenantId;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (needsTenant && !tenantSlug.trim()) {
      setErrors({ tenantSlug: '“Kazanıldı” için işletmenin adresini (slug) yazın.' });
      return;
    }
    const body: AdminLeadPatch = {};
    if (status !== lead.status) body.status = status;
    if ((notes.trim() || null) !== (lead.notes ?? null)) body.notes = notes.trim() || null;
    if (tenantSlug.trim()) body.tenantSlug = tenantSlug.trim();
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await apiFetch<AdminLead>(`/admin/leads/${lead.id}`, { method: 'PATCH', body });
      toast.success('Lead güncellendi.');
      await qc.invalidateQueries({ queryKey: ['admin', 'leads'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      onClose();
    } catch (err) {
      setErrors(fieldErrorsOf(err));
      toast.error(errorMessage(err, 'Lead güncellenemedi.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && !saving && onClose()}
      title={lead.businessName ?? lead.name ?? 'Lead'}
      description={[lead.name, lead.phone ? formatPhone(lead.phone) : null, lead.city].filter(Boolean).join(' · ')}
      size="lg"
      footer={
        canWrite ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Vazgeç
            </Button>
            <Button type="submit" form="lead-form" loading={saving}>
              Kaydet
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
        )
      }
    >
      <form id="lead-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Durum">
          <Select
            value={status}
            disabled={!canWrite}
            onChange={(e) => setStatus(e.target.value as LeadStatus)}
            options={LEAD_STATUSES.map((s) => ({ value: s, label: LEAD_STATUS_LABELS[s] }))}
          />
        </Field>
        {needsTenant ? (
          <Field label="İşletme adresi (slug)" required error={errors.tenantSlug} hint="Kazanılan lead bir işletmeye bağlanır. Ör. bozok-pide">
            <Input value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} autoComplete="off" />
          </Field>
        ) : null}
        {lead.tenantName ? <p className="text-sm text-fg-muted">Bağlı işletme: {lead.tenantName}</p> : null}
        <Field label="Notlar" error={errors.notes}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} maxLength={4000} readOnly={!canWrite} />
        </Field>
        {lead.calculatorInput ? (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold text-fg-muted">Hesaplayıcı girdileri</h3>
            <JsonBlock value={lead.calculatorInput} />
          </div>
        ) : null}
        <p className="text-sm text-fg-muted">
          Kaynak: {LEAD_SOURCE_LABELS[lead.source] ?? lead.source} · geldi {formatDateTime(lead.createdAt)}
        </p>
      </form>
    </Dialog>
  );
}
