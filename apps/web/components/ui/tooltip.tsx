'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}

/**
 * Basit ipucu: fareyle üzerine gelince ve klavye odağında görünür.
 * Panelde hover olmadığından temel anlam ipucuyla taşınmaz (04 §1.1 #10); yalnız ek açıklama içindir.
 */
export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const id = useId();
  return (
    <span className={cn('group/tt relative inline-flex', className)} aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none invisible absolute start-1/2 z-50 w-max max-w-64 -translate-x-1/2 rounded-sm bg-ink px-2 py-1 text-xs font-medium text-white opacity-0 shadow-md transition-opacity',
          'group-hover/tt:visible group-hover/tt:opacity-100 group-focus-within/tt:visible group-focus-within/tt:opacity-100',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        )}
      >
        {content}
      </span>
    </span>
  );
}
