'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { ArrowDown, ArrowUp, CircleCheck, CircleSlash, PackageX } from 'lucide-react';
import { formatKurus, parseTRY } from '@siparis/core/money';
import { controlClass } from '@/components/ui/control-class';
import { useFieldControl } from '@/components/ui/field';
import { cn } from '@/lib/cn';

/** Kuruş → giriş kutusu metni: 125050 → "1250,50". */
export function kurusToInput(kurus: number | null | undefined): string {
  if (kurus === null || kurus === undefined) return '';
  return formatKurus(kurus).replace(/\./g, '');
}

/** Giriş metni → kuruş (Türkçe ondalık virgül; "125", "125,5", "1.250,50"). Geçersizse null. */
export function inputToKurus(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  return parseTRY(v);
}

export interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  invalid?: boolean;
  /** Birim eki; varsayılan "TL". */
  unit?: string;
}

/** TL tutar girişi (sayısal klavye, ≥ 48 px, sağda "TL"). */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { className, invalid, unit = 'TL', id, 'aria-describedby': describedBy, ...props },
  ref,
) {
  const field = useFieldControl();
  const isInvalid = invalid ?? field?.invalid ?? false;
  return (
    <div className="relative">
      <input
        ref={ref}
        id={id ?? field?.id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={isInvalid || undefined}
        aria-describedby={[describedBy, field?.describedBy].filter(Boolean).join(' ') || undefined}
        className={cn(controlClass, 'min-h-hit py-2 pe-12 text-end tabular-nums', className)}
        {...props}
      />
      <span aria-hidden className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-base text-fg-muted">
        {unit}
      </span>
    </div>
  );
});

/**
 * "Bugün tükendi" anahtarı: büyük ve tek dokunuş (04 §6.4). Renk + ikon + kelime:
 * Satışta (yeşil, onay) / Bugün tükendi (turuncu, paket-x).
 */
export function SoldOutToggle({
  soldOut,
  onToggle,
  pending,
  productName,
  className,
}: {
  soldOut: boolean;
  onToggle: () => void;
  pending?: boolean;
  productName: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={soldOut}
      aria-label={`${productName}: bugün tükendi`}
      onClick={onToggle}
      disabled={pending}
      className={cn(
        'inline-flex min-h-hit-primary min-w-40 shrink-0 items-center justify-center gap-2 rounded-lg border-2 px-4 text-base font-bold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60',
        soldOut
          ? 'border-warning bg-warning-bg text-warning'
          : 'border-status-ready-fg/50 bg-status-ready-bg text-status-ready-fg hover:border-status-ready-fg',
        className,
      )}
    >
      {soldOut ? <PackageX aria-hidden className="size-5" /> : <CircleCheck aria-hidden className="size-5" />}
      {soldOut ? 'Bugün tükendi' : 'Satışta'}
    </button>
  );
}

/** Küçük aç/kapa (aktif/pasif) — metinli. */
export function ActiveToggle({
  active,
  onToggle,
  label,
  disabled,
}: {
  active: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'inline-flex min-h-hit shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60',
        active ? 'border-border-strong bg-surface-raised text-fg hover:bg-accent' : 'border-border bg-surface text-fg-muted hover:bg-accent',
      )}
    >
      {active ? <CircleCheck aria-hidden className="size-4 text-status-ready-fg" /> : <CircleSlash aria-hidden className="size-4" />}
      {active ? 'Aktif' : 'Kapalı'}
    </button>
  );
}

/** Yukarı/aşağı taşı (sürükle-bırak yerine; 04 §1.1 #10 hover/sürükleme zorunlu değil). */
export function MoveButtons({
  onUp,
  onDown,
  disabledUp,
  disabledDown,
  label,
}: {
  onUp: () => void;
  onDown: () => void;
  disabledUp?: boolean;
  disabledDown?: boolean;
  label: string;
}) {
  const btn =
    'inline-flex size-hit items-center justify-center rounded-md border border-border text-fg hover:bg-accent disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  return (
    <div className="flex shrink-0 gap-1" role="group" aria-label={`${label} sırası`}>
      <button type="button" className={btn} onClick={onUp} disabled={disabledUp} aria-label={`${label}: yukarı taşı`}>
        <ArrowUp aria-hidden className="size-5" />
      </button>
      <button type="button" className={btn} onClick={onDown} disabled={disabledDown} aria-label={`${label}: aşağı taşı`}>
        <ArrowDown aria-hidden className="size-5" />
      </button>
    </div>
  );
}

/** Dizide bir öğeyi komşusuyla yer değiştirir (yeni dizi). */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
