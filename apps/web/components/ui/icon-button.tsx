import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { buttonVariants, type ButtonVariant } from './button';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Zorunlu erişilebilir ad (yalnız ikonlu butonlar için, 12 §3.5). */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE = { sm: 'size-10 [&_svg]:size-4', md: 'size-hit [&_svg]:size-5', lg: 'size-hit-primary [&_svg]:size-6' } as const;

/** Yalnız ikonlu kare buton; varsayılan 48×48 px. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', className, type = 'button', title, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cn(buttonVariants({ variant }), 'p-0', SIZE[size], className)}
      {...props}
    >
      <span aria-hidden className="inline-flex">
        {icon}
      </span>
    </button>
  );
});
