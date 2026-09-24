import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

/**
 * Buton stilleri. Boyutlar: sm 40 px (yoğun masaüstü tablo), md 48 px (varsayılan dokunma hedefi),
 * lg 56 px, xl 56→64 px (panel ana aksiyonları, 12 §4.2).
 * Link olarak kullanmak için: <Link className={buttonVariants({ variant: 'primary' })}>.
 */
export const buttonVariants = cva(
  [
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold',
    'transition-colors duration-150 ease-standard',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg hover:bg-primary/90 active:bg-primary/80',
        secondary:
          'border border-border-strong bg-surface-raised text-fg hover:bg-accent active:bg-accent/80',
        ghost: 'bg-transparent text-fg hover:bg-accent active:bg-accent/80',
        danger: 'bg-destructive text-destructive-fg hover:bg-destructive/90 active:bg-destructive/80',
        success: 'bg-success text-success-fg hover:bg-success/90 active:bg-success/80',
        brand: 'bg-saffron text-ink hover:bg-saffron/90 active:bg-saffron/80',
        link: 'h-auto min-h-0 px-0 text-fg underline underline-offset-4 hover:no-underline',
      },
      size: {
        sm: 'min-h-10 px-3 text-sm [&_svg]:size-4',
        md: 'min-h-hit px-4 text-base [&_svg]:size-5',
        lg: 'min-h-hit-primary px-5 text-lg [&_svg]:size-5',
        xl: 'min-h-hit-primary px-6 text-xl font-bold md:min-h-hit-primary-lg [&_svg]:size-6',
        icon: 'size-hit p-0 [&_svg]:size-5',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Yüklenirken etiket korunur, buton pasifleşir (UI-06). */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, loading = false, disabled, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </button>
  );
});
