import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-semibold [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-surface text-fg',
        info: 'border-transparent bg-info-bg text-info',
        success: 'border-transparent bg-status-ready-bg text-status-ready-fg',
        warning: 'border-transparent bg-warning-bg text-warning',
        danger: 'border-transparent bg-status-new-bg text-status-new-fg',
        brand: 'border-transparent bg-saffron text-ink',
        ink: 'border-transparent bg-primary text-primary-fg',
        outline: 'border-border-strong bg-transparent text-fg',
      },
      size: {
        sm: 'px-2 py-0.5 text-xs [&_svg]:size-3.5',
        md: 'px-2.5 py-1 text-sm [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

/** Genel rozet. Durum anlamı taşıyorsa ikon + kelime ekleyin (renk tek başına yetmez). */
export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
