'use client';

import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useNativeDialog } from './dialog';
import { IconButton } from './icon-button';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** 'auto': telefonda alttan, tablet/masaüstünde sağdan (UI-13). */
  side?: 'auto' | 'bottom' | 'right' | 'left';
  /** Yan çekmece genişliği. */
  size?: 'sm' | 'md' | 'lg';
  dismissible?: boolean;
  className?: string;
}

const SIDE = {
  bottom: 'mt-auto mb-0 mx-0 w-full max-w-none max-h-[90dvh] rounded-t-xl border-t',
  right: 'ms-auto me-0 my-0 h-dvh max-h-dvh w-full rounded-s-xl border-s',
  left: 'me-auto ms-0 my-0 h-dvh max-h-dvh w-full rounded-e-xl border-e',
  auto: [
    'max-md:mt-auto max-md:mb-0 max-md:mx-0 max-md:w-full max-md:max-w-none max-md:max-h-[90dvh] max-md:rounded-t-xl max-md:border-t',
    'md:ms-auto md:me-0 md:my-0 md:h-dvh md:max-h-dvh md:w-full md:rounded-s-xl md:border-s',
  ].join(' '),
} as const;

const WIDTH_AUTO = { sm: 'md:max-w-sm', md: 'md:max-w-md', lg: 'md:max-w-2xl' } as const;
const WIDTH_FIXED = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' } as const;

/** Çekmece: odak tuzağı, ESC ve arka plan tıklamasıyla kapanır. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = 'auto',
  size = 'md',
  dismissible = true,
  className,
}: SheetProps) {
  const { ref, handlers } = useNativeDialog(open, onOpenChange, dismissible);
  const titleId = useId();
  const descId = useId();
  const sideWidth = side === 'bottom' ? '' : side === 'auto' ? WIDTH_AUTO[size] : WIDTH_FIXED[size];
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className={cn('border-border bg-surface-raised p-0 text-fg shadow-lg', SIDE[side], sideWidth, className)}
      {...handlers}
    >
      {open ? (
        <div className="flex h-full max-h-[inherit] flex-col">
          {side === 'bottom' || side === 'auto' ? (
            <div aria-hidden className={cn('mx-auto mt-2 h-1.5 w-12 rounded-full bg-border', side === 'auto' && 'md:hidden')} />
          ) : null}
          <div className="flex items-start gap-3 border-b border-border p-4">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h2 id={titleId} className="text-lg font-bold leading-7">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="text-sm text-fg-muted">
                  {description}
                </p>
              ) : null}
            </div>
            {dismissible ? <IconButton label="Kapat" icon={<X />} onClick={() => onOpenChange(false)} className="-me-2" /> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
          {footer ? (
            <div className="flex flex-wrap gap-3 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
