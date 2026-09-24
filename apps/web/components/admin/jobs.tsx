'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Briefcase, FileJson, RotateCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AdminJob, AdminJobsResponse } from '@siparis/core/admin/contracts';
import type { JobStatus, Queue } from '@siparis/core/enums';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { apiFetch, errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { JOB_STATUS_LABELS, QUEUES, QUEUE_LABELS } from './admin-labels';
import { JsonBlock, LoadMore, QueryError, useAdminAccess, useCursorList } from './common';

const TABS: JobStatus[] = ['failed', 'pending', 'running'];

/** A-11 kuyruklar ve DLQ: başarısız/bekleyen işler, maskeli yük, "Yeniden dene". */
export function JobsScreen() {
  const qc = useQueryClient();
  const { can } = useAdminAccess();
  const [status, setStatus] = useState<JobStatus>('failed');
  const [queue, setQueue] = useState<Queue | ''>('');
  const [viewing, setViewing] = useState<AdminJob | null>(null);
  const [retrying, setRetrying] = useState<AdminJob | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useCursorList<AdminJob, AdminJobsResponse>(
    ['admin', 'jobs'],
    '/admin/jobs',
    { status, queue: queue || undefined },
    { refetchInterval: 30_000 },
  );
  const counts = list.first?.counts;

  const retry = async () => {
    if (!retrying) return;
    setBusy(true);
    try {
      await apiFetch<AdminJob>(`/admin/jobs/${retrying.id}/retry`, { method: 'POST', body: {} });
      toast.success('İş yeniden kuyruğa alındı.');
      setRetrying(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'jobs'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
    } catch (err) {
      toast.error(errorMessage(err, 'İş yeniden denenemedi.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="İşler" description="Arka plan işleri. Başarısız işler 5 denemeden sonra burada bekler; yükteki telefon ve adres maskelidir." />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div role="group" aria-label="İş durumu" className="flex flex-wrap gap-2">
          {TABS.map((s) => (
            <Button key={s} variant={status === s ? 'primary' : 'secondary'} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {JOB_STATUS_LABELS[s]}
              {counts ? (
                <Badge variant={s === 'failed' && counts.failed > 0 ? 'danger' : 'neutral'} size="sm">
                  {counts[s as 'failed' | 'pending' | 'running']}
                </Badge>
              ) : null}
            </Button>
          ))}
        </div>
        <Field label="Kuyruk" className="w-full sm:w-60">
          <Select
            value={queue}
            onChange={(e) => setQueue(e.target.value as Queue | '')}
            options={[{ value: '', label: 'Tüm kuyruklar' }, ...QUEUES.map((qq) => ({ value: qq, label: QUEUE_LABELS[qq] }))]}
          />
        </Field>
      </div>

      {list.isError ? <QueryError error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.isPending ? <Spinner label="İşler yükleniyor" /> : null}
      {list.isSuccess && !list.items.length ? (
        <EmptyState icon={Briefcase} title={status === 'failed' ? 'Başarısız iş yok' : 'Bu durumda iş yok'} />
      ) : null}
      {list.items.length ? (
        <Table>
          <THead>
            <TR>
              <TH>İş</TH>
              <TH>İşletme</TH>
              <TH>Deneme</TH>
              <TH>Son hata</TH>
              <TH>{status === 'pending' ? 'Çalışma zamanı' : 'Güncellendi'}</TH>
              <TH className="text-end">Aksiyon</TH>
            </TR>
          </THead>
          <TBody>
            {list.items.map((j) => (
              <TR key={j.id}>
                <TD>
                  <div className="font-mono text-sm font-semibold">{j.type}</div>
                  <div className="text-xs text-fg-muted">{QUEUE_LABELS[j.queue as Queue] ?? j.queue}</div>
                </TD>
                <TD>
                  {j.tenantId ? (
                    <Link href={`/admin/isletmeler/${j.tenantId}`} className="underline-offset-4 hover:underline">
                      {j.tenantName ?? 'İşletme'}
                    </Link>
                  ) : (
                    <span className="text-fg-muted">Platform</span>
                  )}
                </TD>
                <TD className="tabular-nums">
                  {j.attempts}/{j.maxAttempts}
                </TD>
                <TD className="max-w-sm">
                  {j.lastError ? <span className="line-clamp-2 font-mono text-xs">{j.lastError}</span> : <span className="text-fg-muted">—</span>}
                </TD>
                <TD className="whitespace-nowrap" title={formatDateTime(status === 'pending' ? j.runAt : j.updatedAt)}>
                  {formatRelative(status === 'pending' ? j.runAt : j.updatedAt)}
                </TD>
                <TD>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setViewing(j)}>
                      <FileJson aria-hidden />
                      Yük
                    </Button>
                    {j.status === 'failed' && can('jobs:retry') ? (
                      <Button variant="secondary" onClick={() => setRetrying(j)}>
                        <RotateCcw aria-hidden />
                        Yeniden dene
                      </Button>
                    ) : null}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : null}
      <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />

      <Dialog open={viewing !== null} onOpenChange={(v) => !v && setViewing(null)} title={viewing?.type ?? 'İş'} size="lg" description="Maskeli yük">
        {viewing ? (
          <div className="flex flex-col gap-3">
            <JsonBlock value={viewing.payload} />
            {viewing.lastError ? (
              <>
                <h3 className="text-sm font-semibold text-fg-muted">Son hata</h3>
                <pre className="whitespace-pre-wrap break-all rounded-md bg-surface p-3 font-mono text-xs">{viewing.lastError}</pre>
              </>
            ) : null}
            <p className="text-sm text-fg-muted">
              Kimlik {viewing.id}
              {viewing.dedupeKey ? ` · tekillik ${viewing.dedupeKey}` : ''} · oluşturuldu {formatDateTime(viewing.createdAt)}
            </p>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={retrying !== null}
        onOpenChange={(v) => !v && setRetrying(null)}
        title="İş yeniden denensin mi?"
        description="İş bekleyen kuyruğa döner ve deneme sayısı sıfırlanır. İşleyiciler idempotenttir; işlem denetim kaydına yazılır."
        confirmLabel="Yeniden dene"
        variant="primary"
        loading={busy}
        onConfirm={retry}
      />
    </>
  );
}
