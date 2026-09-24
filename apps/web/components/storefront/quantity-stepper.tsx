'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
  /** Ekran okuyucu için ürün adı ("Kıymalı Pide adedi"). */
  label: string;
  /** 1'deyken "−" yerine silme ikonu (sepet satırı). */
  removeAtMin?: boolean;
  size?: 'md' | 'lg';
  className?: string;
}

/** Adet seçici: − n + (her buton ≥ 44 px, klavyesiz akış; 04 §1.1 #6). */
export function QuantityStepper({ value, onChange, min = 1, max, label, removeAtMin = false, size = 'md', className }: QuantityStepperProps) {
  const btn = cn(
    'inline-flex shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-fg transition-colors',
    'hover:bg-accent disabled:pointer-events-none disabled:opacity-40',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    size === 'lg' ? 'size-hit' : 'size-hit-sf',
  );
  const atMin = value <= min;
  return (
    <div role="group" aria-label={label} className={cn('inline-flex items-center gap-2', className)}>
      <button
        type="button"
        className={btn}
        onClick={() => onChange(value - 1)}
        disabled={atMin && !removeAtMin}
        aria-label={atMin && removeAtMin ? 'Sepetten çıkar' : 'Bir azalt'}
      >
        {atMin && removeAtMin ? <Trash2 aria-hidden className="size-5" /> : <Minus aria-hidden className="size-5" />}
      </button>
      <output aria-live="polite" className="min-w-8 text-center text-lg font-bold tabular-nums">
        {value}
      </output>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Bir artır">
        <Plus aria-hidden className="size-5" />
      </button>
    </div>
  );
}
