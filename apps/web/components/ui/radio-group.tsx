'use client';

import { useId, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface RadioOption<V extends string = string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<V extends string = string> {
  legend: ReactNode;
  options: readonly RadioOption<V>[];
  value: V | null | undefined;
  onValueChange: (value: V) => void;
  /** 'list': alt alta satırlar; 'chips': sebep/süre çipleri (UI-03, her çip ≥ 48 px). */
  variant?: 'list' | 'chips';
  name?: string;
  hideLegend?: boolean;
  error?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Yerel radyo düğmeleriyle erişilebilir seçim grubu (ok tuşlarıyla gezilir).
 * Seçim renk dışında kenarlık kalınlığı ve onay ikonuyla da gösterilir.
 */
export function RadioGroup<V extends string = string>({
  legend,
  options,
  value,
  onValueChange,
  variant = 'list',
  name,
  hideLegend = false,
  error,
  disabled = false,
  className,
}: RadioGroupProps<V>) {
  const autoId = useId();
  const groupName = name ?? `rg${autoId.replace(/:/g, '')}`;
  const errId = error ? `${groupName}-err` : undefined;
  return (
    <fieldset className={cn('min-w-0', className)} aria-describedby={errId} disabled={disabled}>
      <legend className={cn('mb-2 text-sm font-semibold text-fg', hideLegend && 'sr-only')}>{legend}</legend>
      <div className={cn(variant === 'chips' ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2')}>
        {options.map((o) => {
          const id = `${groupName}-${o.value}`;
          const selected = value === o.value;
          return (
            <label
              key={o.value}
              htmlFor={id}
              className={cn(
                'relative flex cursor-pointer items-center gap-3 rounded-md border bg-surface-raised text-fg transition-colors',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                variant === 'chips' ? 'min-h-hit px-4 py-2 font-semibold' : 'min-h-hit px-4 py-3',
                selected ? 'border-2 border-primary bg-accent' : 'border-border-strong hover:bg-accent',
                (o.disabled || disabled) && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                id={id}
                type="radio"
                name={groupName}
                value={o.value}
                checked={selected}
                disabled={o.disabled}
                onChange={() => onValueChange(o.value)}
                className={variant === 'chips' ? 'sr-only' : 'size-5 shrink-0 accent-[var(--primary)]'}
              />
              {variant === 'chips' && selected ? <Check aria-hidden className="size-4 shrink-0" /> : null}
              <span className="flex flex-col gap-0.5">
                <span>{o.label}</span>
                {o.description ? <span className="text-sm font-normal text-fg-muted">{o.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={errId} className="mt-1.5 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
