'use client';

import { useState } from 'react';
import { OctagonAlert, Power, PowerOff, ToggleRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AdminFlag, AdminFlagPatch } from '@siparis/core/admin/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, errorMessage, useApiQuery } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { KILL_SWITCH_IMPACT } from './admin-labels';
import { QueryError, useAdminAccess } from './common';

/** Kart başlığı: açıklama (ör. "Yeni işletme kaydı"); yoksa etiket. */
const flagTitle = (f: AdminFlag) => f.description ?? f.label;

/** A-13 feature flag ve kill-switch'ler: büyük anahtarlar, kapatmada etki özeti + gerekçe. */
export function FlagsScreen() {
  const qc = useQueryClient();
  const { can } = useAdminAccess();
  const q = useApiQuery<{ items: AdminFlag[] }>(['admin', 'flags'], '/admin/flags', { enabled: can('flags:read') });
  const [target, setTarget] = useState<{ flag: AdminFlag; enabled: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  if (!can('flags:read')) {
    return (
      <>
        <PageHeader title="Bayraklar" />
        <QueryError error={{ status: 403 }} />
      </>
    );
  }

  const killSwitches = q.data?.items.filter((f) => f.kind === 'kill_switch') ?? [];
  const others = q.data?.items.filter((f) => f.kind !== 'kill_switch') ?? [];
  const needsReason = target ? target.flag.kind === 'kill_switch' && !target.enabled : false;

  const open = (flag: AdminFlag, enabled: boolean) => {
    setReason('');
    setReasonError(undefined);
    setTarget({ flag, enabled });
  };

  const confirm = async () => {
    if (!target) return;
    if (needsReason && reason.trim().length < 10) {
      setReasonError('Gerekçe en az 10 karakter olmalı.');
      return;
    }
    setBusy(true);
    try {
      const body: AdminFlagPatch = { key: target.flag.key, enabled: target.enabled, ...(reason.trim() ? { reason: reason.trim() } : {}) };
      await apiFetch<AdminFlag>('/admin/flags', { method: 'PATCH', body });
      toast.success(`${flagTitle(target.flag)}: ${target.enabled ? 'açıldı' : 'kapatıldı'}.`);
      setTarget(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'flags'] });
    } catch (err) {
      toast.error(errorMessage(err, 'Bayrak değiştirilemedi.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Bayraklar"
        description="Acil durdurma anahtarları varsayılan açıktır; kapatmak ilgili yeteneği tüm platformda durdurur. Değişiklik 1 dakika içinde her yerde geçerli olur."
      />
      {q.isError ? <QueryError error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isPending ? <Spinner label="Bayraklar yükleniyor" /> : null}
      {q.data ? (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="ks-title" className="flex flex-col gap-3">
            <h2 id="ks-title" className="flex items-center gap-2 text-xl font-bold text-fg">
              <OctagonAlert aria-hidden className="size-5" />
              Acil durdurma anahtarları
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {killSwitches.map((f) => (
                <FlagCard key={f.key} flag={f} canWrite={can('flags:write')} onToggle={(v) => open(f, v)} />
              ))}
            </div>
          </section>
          {others.length ? (
            <section aria-labelledby="ops-title" className="flex flex-col gap-3">
              <h2 id="ops-title" className="flex items-center gap-2 text-xl font-bold text-fg">
                <ToggleRight aria-hidden className="size-5" />
                Operasyon ve sürüm bayrakları
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {others.map((f) => (
                  <FlagCard key={f.key} flag={f} canWrite={can('flags:write')} onToggle={(v) => open(f, v)} />
                ))}
              </div>
            </section>
          ) : null}
          {!q.data.items.length ? <EmptyState title="Bayrak yok" /> : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(v) => !v && !busy && setTarget(null)}
        title={target ? `${flagTitle(target.flag)}: ${target.enabled ? 'açılsın mı?' : 'kapatılsın mı?'}` : ''}
        description={
          target && !target.enabled && target.flag.kind === 'kill_switch'
            ? (KILL_SWITCH_IMPACT[target.flag.key] ?? 'Bu yetenek tüm platformda durur.')
            : 'Değişiklik denetim kaydına yazılır.'
        }
        confirmLabel={target?.enabled ? 'Anahtarı aç' : 'Anahtarı kapat'}
        variant={target?.enabled ? 'primary' : 'danger'}
        loading={busy}
        onConfirm={confirm}
      >
        <Field
          label="Gerekçe"
          required={needsReason}
          error={reasonError}
          hint={needsReason ? 'Zorunlu, en az 10 karakter. Kapattıktan 1 saat sonra ikinci kişi gözden geçirir.' : 'İsteğe bağlı'}
        >
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
        </Field>
      </ConfirmDialog>
    </>
  );
}

function FlagCard({ flag, canWrite, onToggle }: { flag: AdminFlag; canWrite: boolean; onToggle: (enabled: boolean) => void }) {
  const on = flag.enabled;
  return (
    <Card className={on ? '' : 'border-status-new-fg/50'}>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-lg font-bold text-fg">{flagTitle(flag)}</span>
            <code className="text-sm text-fg-muted">{flag.key}</code>
          </div>
          <Badge variant={on ? 'success' : 'danger'}>
            {on ? <Power aria-hidden /> : <PowerOff aria-hidden />}
            {on ? 'Açık' : 'Kapalı'}
          </Badge>
        </div>
        {flag.kind === 'kill_switch' ? (
          <p className="text-sm text-fg-muted">Kapatınca: {KILL_SWITCH_IMPACT[flag.key] ?? 'ilgili yetenek durur.'}</p>
        ) : null}
        {!on ? (
          <Alert variant="danger" assertive={false}>
            Şu an kapalı. Sorun geçtiyse yeniden açın.
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-fg-muted">
            {flag.updatedAt ? `Son değişiklik ${formatDateTime(flag.updatedAt)}${flag.updatedByName ? ` · ${flag.updatedByName}` : ''}` : 'Varsayılan (hiç değiştirilmedi)'}
          </span>
          {canWrite ? (
            <Button variant={on ? 'danger' : 'success'} size="lg" onClick={() => onToggle(!on)}>
              {on ? <PowerOff aria-hidden /> : <Power aria-hidden />}
              {on ? 'Kapat' : 'Aç'}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
