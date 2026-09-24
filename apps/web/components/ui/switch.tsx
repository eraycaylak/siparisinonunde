'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** Durumu metinle de göster ("Açık"/"Kapalı"); renk tek başına anlam taşımaz. */
  showStateText?: boolean;
  className?: string;
  id?: string;
}

/** Aç/kapa anahtarı (role="switch"); satırın tamamı tıklanabilir, ≥ 48 px. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  showStateText = true,
  className,
  id,
}: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? `sw${autoId.replace(/:/g, '')}`;
  const labelId = `${switchId}-label`;
  const descId = description ? `${switchId}-desc` : undefined;
  return (
    <div className={cn('flex min-h-hit items-center justify-between gap-4 py-2', className)}>
      <div className="flex flex-col gap-0.5">
        <span id={labelId} className="text-base text-fg">
          {label}
        </span>
        {description ? (
          <span id={descId} className="text-sm text-fg-muted">
            {description}
          </span>
        ) : null}
      </div>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descId}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'group inline-flex min-h-hit shrink-0 items-center gap-2 rounded-full px-1 disabled:cursor-not-allowed disabled:opacity-60',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        )}
      >
        {showStateText ? (
          <span className="w-12 text-end text-sm font-semibold text-fg-muted" aria-hidden>
            {checked ? 'Açık' : 'Kapalı'}
          </span>
        ) : null}
        <span
          aria-hidden
          className={cn(
            'relative inline-flex h-8 w-14 items-center rounded-full border-2 transition-colors',
            checked ? 'border-primary bg-primary' : 'border-border-strong bg-surface',
          )}
        >
          <span
            className={cn(
              'absolute size-6 rounded-full shadow-sm transition-transform',
              checked ? 'translate-x-6 bg-primary-fg' : 'translate-x-0.5 bg-border-strong',
            )}
          />
        </span>
      </button>
    </div>
  );
}
