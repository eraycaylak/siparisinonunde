import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SpinnerProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Ekran okuyucu metni; boşsa süs sayılır. */
  label?: string;
}

const SIZES = { sm: 'size-4', md: 'size-5', lg: 'size-8' } as const;

/** Yükleniyor göstergesi. */
export function Spinner({ className, size = 'md', label }: SpinnerProps) {
  return (
    <span role={label ? 'status' : undefined} className={cn('inline-flex items-center gap-2', className)}>
      <LoaderCircle aria-hidden className={cn('animate-spin', SIZES[size])} />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
