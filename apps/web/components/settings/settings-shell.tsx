'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert } from '@/components/ui/alert';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

/** Ayar alt sayfası iskeleti: "Ayarlar" geri bağlantısı + başlık. */
export function SettingsShell({
  title,
  description,
  actions,
  children,
  backHref = '/panel/ayarlar',
  backLabel = 'Ayarlar',
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  backHref?: string | null;
  backLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-4xl', className)}>
      {backHref ? (
        <Link
          href={backHref}
          className="-ms-2 mb-2 inline-flex min-h-hit items-center gap-1 rounded-md px-2 text-sm font-semibold text-fg-muted hover:text-fg"
        >
          <ChevronLeft aria-hidden className="size-4" />
          {backLabel}
        </Link>
      ) : null}
      <PageHeader title={title} description={description} actions={actions} />
      {children}
    </div>
  );
}

/** Yükleme iskeleti. */
export function SettingsLoading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Yükleniyor">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

export function SettingsError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert
      variant="danger"
      title={isApiError(error) && error.status === 403 ? 'Bu bölüm için yetkiniz yok' : 'Bilgiler yüklenemedi'}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Tekrar dene
          </Button>
        ) : undefined
      }
    >
      {errorMessage(error)}
    </Alert>
  );
}

/** Kaydet çubuğu: formun altında; telefonda alt menünün üstüne yapışık. */
export function SaveBar({
  dirty,
  saving,
  onReset,
  label = 'Kaydet',
  form,
}: {
  dirty: boolean;
  saving: boolean;
  onReset?: () => void;
  label?: string;
  /** Harici form kimliği (buton form dışındaysa). */
  form?: string;
}) {
  return (
    <div className="sticky bottom-[calc(var(--bottom-offset,0px)+0.5rem)] z-10 mt-6 flex flex-wrap items-center justify-end gap-3 rounded-lg border border-border bg-surface-raised/95 p-3 shadow-md backdrop-blur">
      <span className="me-auto text-sm text-fg-muted" aria-live="polite">
        {dirty ? 'Kaydedilmemiş değişiklik var' : 'Tüm değişiklikler kayıtlı'}
      </span>
      {onReset && dirty ? (
        <Button variant="ghost" onClick={onReset} disabled={saving}>
          Vazgeç
        </Button>
      ) : null}
      <Button type="submit" form={form} size="lg" loading={saving} disabled={!dirty && !saving}>
        {label}
      </Button>
    </div>
  );
}

/** API hata ayrıntısından alan yolu → mesaj ("/alarmPolicy/auto_cancel_minutes" → "alarmPolicy.auto_cancel_minutes"). */
export function issuesOf(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isApiError(error)) return out;
  const details = error.details as { issues?: { path?: unknown; message?: unknown }[] } | undefined;
  for (const issue of details?.issues ?? []) {
    const raw = Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path ?? '');
    const key = raw.replace(/^\//, '').replace(/\//g, '.');
    const msg = typeof issue.message === 'string' && !/^(too small|too big|invalid|expected)/i.test(issue.message) ? issue.message : 'Bu alanı kontrol edin.';
    if (key && !(key in out)) out[key] = msg;
  }
  return out;
}

/** Bölüm kartı (başlık + açıklama + içerik). */
export function Section({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-border bg-surface-raised p-4 sm:p-5', className)}>
      <h2 className="text-lg font-bold text-fg">{title}</h2>
      {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}
