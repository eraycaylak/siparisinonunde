'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { controlClass } from './control-class';
import { useFieldControl } from './field';

export { controlClass };

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, id, required, 'aria-describedby': describedBy, type = 'text', ...props },
  ref,
) {
  const field = useFieldControl();
  const isInvalid = invalid ?? field?.invalid ?? false;
  return (
    <input
      ref={ref}
      id={id ?? field?.id}
      type={type}
      required={required ?? field?.required}
      aria-invalid={isInvalid || undefined}
      aria-describedby={[describedBy, field?.describedBy].filter(Boolean).join(' ') || undefined}
      className={cn(controlClass, 'min-h-hit py-2', className)}
      {...props}
    />
  );
});
