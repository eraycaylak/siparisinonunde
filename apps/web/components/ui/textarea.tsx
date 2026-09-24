'use client';

import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';
import { controlClass } from './control-class';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, id, required, rows = 3, 'aria-describedby': describedBy, ...props },
  ref,
) {
  const field = useFieldControl();
  const isInvalid = invalid ?? field?.invalid ?? false;
  return (
    <textarea
      ref={ref}
      id={id ?? field?.id}
      rows={rows}
      required={required ?? field?.required}
      aria-invalid={isInvalid || undefined}
      aria-describedby={[describedBy, field?.describedBy].filter(Boolean).join(' ') || undefined}
      className={cn(controlClass, 'min-h-24 py-2.5 leading-6', className)}
      {...props}
    />
  );
});
