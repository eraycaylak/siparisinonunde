'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Undo2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';

export interface ConfirmUndoBarProps {
  /** "Reddediliyor", "Hazır olarak işaretlendi" … */
  message: ReactNode;
  /**
   * Bitiş anı. Sunucudaki rejection_scheduled_at + 30 sn ile eşzamanlı olmalı (UI-04);
   * sayfa yenilense de kalan süre doğru görünür. Verilmezse bileşen açıldığı andan itibaren `seconds` sayar.
   */
  deadline?: number | string | Date;
  /** Varsayılan 30 sn (ret). Durum geçişlerinde 5 sn. */
  seconds?: number;
  onUndo: () => void;
  /** Süre dolunca bir kez çağrılır. */
  onExpire?: () => void;
  undoLabel?: string;
  /** Geri alma isteği sürerken. */
  undoing?: boolean;
  /** Çevrimdışıyken geri al butonu pasif. */
  disabled?: boolean;
  tone?: 'alarm' | 'neutral';
  className?: string;
}

function toMs(value: number | string | Date): number {
  return value instanceof Date ? value.getTime() : typeof value === 'number' ? value : new Date(value).getTime();
}

/**
 * "Geri al" şeridi (UI-04). Geri sayım metin olarak görünür; ekran okuyucuya başta ve son 10/5 sn'de duyurulur.
 * Sabit konum için <UndoBarRegion> içinde kullanın.
 */
export function ConfirmUndoBar({
  message,
  deadline,
  seconds = 30,
  onUndo,
  onExpire,
  undoLabel = 'Geri al',
  undoing = false,
  disabled = false,
  tone = 'alarm',
  className,
}: ConfirmUndoBarProps) {
  const [end] = useState(() => (deadline !== undefined ? toMs(deadline) : Date.now() + seconds * 1000));
  const endMs = deadline !== undefined ? toMs(deadline) : end;
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((endMs - Date.now()) / 1000)));
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpireRef.current?.();
      }
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [endMs]);

  const announce = remaining === 10 || remaining === 5 ? `${remaining} saniye kaldı` : '';

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full items-center gap-3 rounded-lg px-4 py-2 shadow-lg',
        tone === 'alarm'
          ? 'border-2 border-dashed border-status-new-fg bg-status-new-bg text-status-new-fg'
          : 'bg-ink text-white',
        className,
      )}
      data-print-hide
    >
      <div className="min-w-0 flex-1 text-base font-semibold">
        <span>{message}</span>
        <span aria-hidden className="tabular-nums"> · {remaining} sn</span>
        <span className="sr-only" aria-live="polite">
          {announce}
        </span>
      </div>
      <Button
        variant={tone === 'alarm' ? 'primary' : 'brand'}
        size="md"
        onClick={onUndo}
        loading={undoing}
        disabled={disabled || remaining <= 0}
      >
        <Undo2 aria-hidden />
        {undoLabel}
      </Button>
    </div>
  );
}

/** Ekranın altında sabit, üst üste şeritler için kap. Alt sekme çubuğunun üstünde durur (--bottom-offset). */
export function UndoBarRegion({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="region"
      aria-label="Geri alınabilir işlemler"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed inset-x-0 z-[70] mx-auto flex w-full max-w-xl flex-col gap-2 px-3',
        'bottom-[calc(var(--bottom-offset,0px)+0.75rem+env(safe-area-inset-bottom))]',
        className,
      )}
    >
      {children}
    </div>
  );
}
