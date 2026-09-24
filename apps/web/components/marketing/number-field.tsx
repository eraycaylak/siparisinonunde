'use client';

import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/cn';
import { controlClass } from '@/components/ui/control-class';

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Sağdaki birim ("TL", "%", "sipariş"). */
  suffix?: string;
  hint?: string;
  /** Kaydırıcı da göster (klavyeyle kullanılabilir sayı kutusu her zaman vardır, 05 C.4.6). */
  slider?: boolean;
  /** Görüntülenen değer = value × scale (ör. oran 0,25 → 25). */
  scale?: number;
  className?: string;
}

function clamp(n: number, min?: number, max?: number) {
  let v = n;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

/** "1.500" → 1500, "2,5" → 2.5, "2.5" → 2.5, "1.234,5" → 1234.5 */
export function parseLocaleNumber(raw: string): number {
  const s = raw.trim().replace(/\s/g, '');
  if (s === '') return Number.NaN;
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  return Number(s);
}

function toText(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000).replace('.', ',') : '';
}

/** Türkçe ondalık (virgül) kabul eden sayı alanı + isteğe bağlı kaydırıcı. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  hint,
  slider = false,
  scale = 1,
  className,
}: NumberFieldProps) {
  const id = useId();
  const shown = value * scale;
  const [text, setText] = useState(() => toText(shown));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(toText(shown));
  }, [shown, focused]);

  const commit = (raw: string) => {
    const n = parseLocaleNumber(raw);
    if (!Number.isFinite(n)) return;
    onChange(clamp(n, min, max) / scale);
  };

  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-fg">
        {label}
      </label>
      <div className="flex items-center gap-3">
        {slider ? (
          <input
            type="range"
            aria-label={`${label} (kaydırıcı)`}
            min={min}
            max={max}
            step={step}
            value={clamp(shown, min, max)}
            onChange={(e) => onChange(Number(e.target.value) / scale)}
            className="h-hit min-w-0 flex-1 cursor-pointer accent-[var(--primary)]"
          />
        ) : null}
        <div className={cn('relative', slider ? 'w-32 shrink-0' : 'w-full')}>
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            aria-describedby={hintId}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              setText(toText(shown));
            }}
            onChange={(e) => {
              setText(e.target.value);
              commit(e.target.value);
            }}
            className={cn(controlClass, 'min-h-hit py-2 tabular-nums', suffix && 'pe-12')}
          />
          {suffix ? (
            <span aria-hidden className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">
              {suffix}
            </span>
          ) : null}
        </div>
      </div>
      {hint ? (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
