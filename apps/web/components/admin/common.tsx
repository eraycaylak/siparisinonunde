'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { AlertTriangle, CircleCheck, CircleDot, CircleX, LockKeyhole, RotateCcw, type LucideIcon } from 'lucide-react';
import type { LifecycleStage, WaAccountStatus } from '@siparis/core/enums';
import { adminCan, type AdminPermission } from '@siparis/core/admin/permissions';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { apiFetch, errorMessage, type ApiError, type QueryParams } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { LIFECYCLE_STAGE_LABELS } from '@/lib/labels';
import { HEALTH_LABELS, WA_ACCOUNT_STATUS_LABELS } from './admin-labels';

/** Oturumdaki platform rolü ve 05 §A.3 izin kontrolü (arayüz yalnız gizler; karar API'dedir). */
export function useAdminAccess() {
  const me = useMe();
  const role = me.data?.user.platformRole ?? null;
  return { role, can: (p: AdminPermission) => adminCan(role, p) };
}

/** İmleçli liste ({items, nextCursor?}) için sonsuz sorgu. */
export function useCursorList<T, R extends { items: T[]; nextCursor?: string } = { items: T[]; nextCursor?: string }>(
  key: QueryKey,
  path: string,
  query: QueryParams = {},
  options: { refetchInterval?: number; enabled?: boolean } = {},
) {
  const q = useInfiniteQuery<R, ApiError>({
    queryKey: [...key, query],
    queryFn: ({ pageParam, signal }) => apiFetch<R>(path, { signal, query: { ...query, cursor: (pageParam as string | undefined) ?? undefined } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: options.refetchInterval,
    enabled: options.enabled ?? true,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const first = q.data?.pages[0];
  return { ...q, items, first };
}

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="mt-4 flex justify-center">
      <Button variant="secondary" onClick={onClick} loading={loading}>
        Daha fazla göster
      </Button>
    </div>
  );
}

export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = (error as ApiError | undefined)?.status;
  if (status === 403) {
    return (
      <EmptyState
        icon={LockKeyhole}
        title="Bu bölüm için yetkiniz yok"
        description="Rolünüz bu ekranı görmeye izin vermiyor. Erişim gerekiyorsa platform sahibine yazın."
      />
    );
  }
  return (
    <Alert
      variant="danger"
      title="Veriler yüklenemedi"
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            <RotateCcw aria-hidden />
            Tekrar dene
          </Button>
        ) : undefined
      }
    >
      {errorMessage(error)}
    </Alert>
  );
}

const STAGE_VARIANT: Record<LifecycleStage, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand' | 'outline'> = {
  lead: 'outline',
  onboarding: 'info',
  pilot: 'brand',
  trial: 'info',
  active: 'success',
  past_due: 'warning',
  read_only: 'warning',
  suspended: 'danger',
  churned: 'neutral',
};

export function StageBadge({ stage, size = 'sm' }: { stage: LifecycleStage; size?: 'sm' | 'md' }) {
  return (
    <Badge variant={STAGE_VARIANT[stage]} size={size}>
      {LIFECYCLE_STAGE_LABELS[stage]}
    </Badge>
  );
}

const WA_ICON: Record<WaAccountStatus, LucideIcon> = { connected: CircleCheck, disconnected: CircleDot, error: CircleX };

export function WaStatusBadge({ status }: { status: WaAccountStatus | null }) {
  if (!status) return <span className="text-sm text-fg-muted">Yok</span>;
  const Icon = WA_ICON[status];
  return (
    <Badge variant={status === 'error' ? 'danger' : status === 'connected' ? 'success' : 'neutral'} size="sm">
      <Icon aria-hidden />
      {WA_ACCOUNT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function HealthBadge({ health }: { health: 'red' | 'yellow' | 'green' }) {
  const Icon = health === 'red' ? CircleX : health === 'yellow' ? AlertTriangle : CircleCheck;
  return (
    <Badge variant={health === 'red' ? 'danger' : health === 'yellow' ? 'warning' : 'success'} size="sm">
      <Icon aria-hidden />
      {HEALTH_LABELS[health]}
    </Badge>
  );
}

/** Özet kartı (A-02): büyük sayı + açıklama; tone ile durum rengi (ikon + kelime ile birlikte). */
export function StatCard({
  label,
  value,
  hint,
  href,
  tone = 'neutral',
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: 'neutral' | 'danger' | 'warning' | 'ok';
  icon?: LucideIcon;
}) {
  const body = (
    <div
      className={cn(
        'flex h-full flex-col gap-1 rounded-lg border bg-surface-raised p-4',
        tone === 'danger' ? 'border-status-new-fg/40' : tone === 'warning' ? 'border-warning/40' : 'border-border',
        href ? 'transition-colors hover:bg-accent' : '',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-fg-muted">
        {Icon ? (
          <Icon
            aria-hidden
            className={cn('size-4', tone === 'danger' ? 'text-status-new-fg' : tone === 'warning' ? 'text-warning' : tone === 'ok' ? 'text-status-ready-fg' : '')}
          />
        ) : null}
        {label}
      </span>
      <span className="text-3xl font-bold tabular-nums text-fg">{value}</span>
      {hint ? <span className="text-sm text-fg-muted">{hint}</span> : null}
    </div>
  );
  if (!href) return body;
  return (
    <Link href={href} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      {body}
    </Link>
  );
}

/** Tanım listesi satırı. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-44 shrink-0 text-sm font-semibold text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-base text-fg">{children ?? <span className="text-fg-muted">—</span>}</dd>
    </div>
  );
}

/** JSON görünümü (maskeli yük, audit verisi). */
export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface p-3 font-mono text-xs text-fg">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
