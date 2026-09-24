import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Sağdaki aksiyonlar. */
  actions?: ReactNode;
  className?: string;
}

/** Panel/admin sayfa başlığı (h1). */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-bold leading-8 text-fg sm:text-3xl sm:leading-9">{title}</h1>
        {description ? <p className="max-w-2xl text-base text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
