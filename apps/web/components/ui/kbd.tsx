import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Klavye kısayolu gösterimi (ör. Enter = birincil aksiyon). */
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-6 items-center justify-center rounded-sm border border-border-strong bg-surface px-1.5 font-mono text-xs font-semibold text-fg',
        className,
      )}
      {...props}
    />
  );
}
