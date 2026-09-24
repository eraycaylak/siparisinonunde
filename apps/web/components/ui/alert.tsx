import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface AlertProps {
  variant?: 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
  /** Aksiyon (ör. [Tekrar dene]). */
  action?: ReactNode;
  className?: string;
  /** Engelleyici hata için role="alert" (varsayılan danger'da açık). */
  assertive?: boolean;
}

const STYLES = {
  info: { box: 'border-info/40 bg-info-bg text-fg', icon: 'text-info', Icon: Info },
  success: { box: 'border-status-ready-fg/40 bg-status-ready-bg text-fg', icon: 'text-status-ready-fg', Icon: CircleCheck },
  warning: { box: 'border-warning/40 bg-warning-bg text-fg', icon: 'text-warning', Icon: TriangleAlert },
  danger: { box: 'border-status-new-fg/40 bg-status-new-bg text-fg', icon: 'text-status-new-fg', Icon: CircleAlert },
} as const;

/** Satır içi uyarı/hata kutusu (UI-08): ne oldu + ne yapmalı + aksiyon. */
export function Alert({ variant = 'info', title, children, action, className, assertive }: AlertProps) {
  const s = STYLES[variant];
  const Icon = s.Icon;
  const role = (assertive ?? variant === 'danger') ? 'alert' : 'status';
  return (
    <div role={role} className={cn('flex gap-3 rounded-md border p-4', s.box, className)}>
      <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', s.icon)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-sm leading-6">{children}</div> : null}
        {action ? <div className="mt-2 flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
