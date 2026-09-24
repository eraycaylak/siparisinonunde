import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Yükleniyor iskeleti; ekran okuyucudan gizli. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-surface', className)} {...props} />;
}
