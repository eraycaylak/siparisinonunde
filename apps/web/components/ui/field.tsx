'use client';

import { createContext, useContext, useId, type LabelHTMLAttributes, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Field içindeki kontrol için id / aria-describedby / aria-invalid. Field dışında null döner. */
export function useFieldControl(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Etiketi yalnız ekran okuyucuya göster. */
  hideLabel?: boolean;
  /** Kontrolün id'si (verilmezse üretilir). */
  id?: string;
  className?: string;
}

/**
 * Etiket + ipucu + hata sarmalayıcısı (UI-08). İçindeki Input/Textarea/Select id ve aria bağlantılarını
 * bağlamdan otomatik alır. Hata metni role="alert" değil; alan altında aria-describedby ile okunur.
 */
export function Field({ label, children, hint, error, required = false, hideLabel = false, id, className }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `f${autoId.replace(/:/g, '')}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error), required }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label htmlFor={controlId} className={cn('text-sm font-semibold text-fg', hideLabel && 'sr-only')}>
          {label}
          {required ? (
            <span className="ms-0.5 text-destructive" aria-hidden>
              *
            </span>
          ) : null}
        </label>
        {children}
        {hint ? (
          <p id={hintId} className="text-sm text-fg-muted">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-destructive">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  children: ReactNode;
}

export function Label({ className, children, ...props }: LabelProps) {
  return (
    <label className={cn('text-sm font-semibold text-fg', className)} {...props}>
      {children}
    </label>
  );
}
