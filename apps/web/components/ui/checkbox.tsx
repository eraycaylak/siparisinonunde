'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
}

/** Yerel onay kutusu + etiket; tüm satır ≥ 48 px dokunma hedefi. Önceden işaretli gelmez (08 §7.5). */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, error, className, id, disabled, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `cb${autoId.replace(/:/g, '')}`;
  const descId = description ? `${inputId}-desc` : undefined;
  const errId = error ? `${inputId}-err` : undefined;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={inputId}
        className={cn(
          'flex min-h-hit cursor-pointer items-start gap-3 py-2',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          disabled={disabled}
          aria-describedby={[descId, errId].filter(Boolean).join(' ') || undefined}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 size-6 shrink-0 cursor-pointer rounded-sm border-border-strong accent-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          {...props}
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-base text-fg">{label}</span>
          {description ? (
            <span id={descId} className="text-sm text-fg-muted">
              {description}
            </span>
          ) : null}
        </span>
      </label>
      {error ? (
        <p id={errId} className="ps-9 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
});
