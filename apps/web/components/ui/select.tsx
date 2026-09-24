'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';
import { controlClass } from './control-class';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  /** Seçenekler; verilmezse children kullanılır. */
  options?: readonly SelectOption[];
  /** Boş ilk seçenek metni (ör. "Seçin"). */
  placeholder?: string;
}

/** Yerel <select> (mobilde sistem seçicisi açılır). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, id, required, options, placeholder, children, 'aria-describedby': describedBy, ...props },
  ref,
) {
  const field = useFieldControl();
  const isInvalid = invalid ?? field?.invalid ?? false;
  return (
    <div className="relative">
      <select
        ref={ref}
        id={id ?? field?.id}
        required={required ?? field?.required}
        aria-invalid={isInvalid || undefined}
        aria-describedby={[describedBy, field?.describedBy].filter(Boolean).join(' ') || undefined}
        className={cn(controlClass, 'min-h-hit appearance-none py-2 pe-10', className)}
        {...props}
      >
        {placeholder !== undefined ? (
          <option value="" disabled={required ?? field?.required}>
            {placeholder}
          </option>
        ) : null}
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))
          : children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute end-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
    </div>
  );
});
