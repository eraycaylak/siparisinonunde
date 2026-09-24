'use client';

import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { IconButton } from './icon-button';

/** Açık modal sayısı: arka plan kaydırmasını kilitlemek için. */
let openCount = 0;
function lockScroll(lock: boolean) {
  if (typeof document === 'undefined') return;
  openCount = Math.max(0, openCount + (lock ? 1 : -1));
  document.documentElement.style.overflow = openCount > 0 ? 'hidden' : '';
}

/** Yerel <dialog> yönetimi: showModal/close, ESC, arka plana tıklama, kaydırma kilidi. */
export function useNativeDialog(open: boolean, onOpenChange: (open: boolean) => void, dismissible: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      lockScroll(true);
      return () => {
        if (el.open) el.close();
        lockScroll(false);
      };
    }
    return undefined;
  }, [open]);

  const handlers = {
    onCancel: (e: SyntheticEvent<HTMLDialogElement>) => {
      e.preventDefault();
      if (dismissible) onOpenChange(false);
    },
    onClose: () => {
      if (open) onOpenChange(false);
    },
    onMouseDown: (e: MouseEvent<HTMLDialogElement>) => {
      if (dismissible && e.target === e.currentTarget) onOpenChange(false);
    },
  };
  return { ref, handlers };
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** false: ESC ve arka plan tıklaması kapatmaz (işlem sürerken). */
  dismissible?: boolean;
  className?: string;
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

/** Ortalanmış modal pencere (UI-14). Odak tuzağı ve ESC tarayıcının <dialog> davranışıdır. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  className,
}: DialogProps) {
  const { ref, handlers } = useNativeDialog(open, onOpenChange, dismissible);
  const titleId = useId();
  const descId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-lg border border-border bg-surface-raised p-0 text-fg shadow-lg',
        SIZES[size],
        className,
      )}
      {...handlers}
    >
      {open ? (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start gap-3 p-5 pb-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id={titleId} className="text-xl font-bold leading-7">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="text-base text-fg-muted">
                  {description}
                </p>
              ) : null}
            </div>
            {dismissible ? (
              <IconButton label="Kapat" icon={<X />} onClick={() => onOpenChange(false)} className="-me-2 -mt-1" />
            ) : null}
          </div>
          {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div> : null}
          {footer ? <div className="flex flex-wrap justify-end gap-3 border-t border-border p-4">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Sonucu söyleyen metin ("Müşteriye iptal mesajı gidecek. Bu işlem geri alınamaz."). */
  description?: ReactNode;
  /** Fiille etiket: "İptal et", "Sil". */
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  loading?: boolean;
  variant?: 'danger' | 'primary';
  children?: ReactNode;
}

/**
 * Yalnız geri alınamaz işlemler için onay (04 §1.1 #5). Varsayılan odak "Vazgeç"tedir;
 * iki buton aynı boyutta ve ≥ 8 px ayrıktır.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Vazgeç',
  onConfirm,
  loading = false,
  variant = 'danger',
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button variant="secondary" size="lg" autoFocus onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={variant} size="lg" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
