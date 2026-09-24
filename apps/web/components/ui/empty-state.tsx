import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  /** En çok 2 cümle (UI-07). */
  description?: ReactNode;
  /** Tek aksiyon. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? (
        <span className="flex size-14 items-center justify-center rounded-full bg-surface text-fg-muted">
          <Icon aria-hidden className="size-7" />
        </span>
      ) : null}
      <h2 className="text-lg font-bold text-fg">{title}</h2>
      {description ? <p className="max-w-md text-base text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
