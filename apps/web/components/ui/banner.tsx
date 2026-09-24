import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface BannerProps {
  /** alarm: kırmızı (yeni sipariş, bağlantı yok, ses kapalı, salt-okunur); warn: amber; ok: yeşil; info: mürekkep. */
  tone: 'alarm' | 'warn' | 'ok' | 'info';
  icon?: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Ekran okuyucuya duyuru: alarm → assertive, diğerleri polite. */
  live?: 'polite' | 'assertive' | 'off';
}

const TONES = {
  alarm: 'bg-band-alarm text-band-alarm-fg',
  warn: 'bg-band-warn text-band-warn-fg',
  ok: 'bg-band-ok text-band-ok-fg',
  info: 'bg-ink text-white',
} as const;

/**
 * Tam genişlik bant (UI-09). Akış içinde durur, içeriği iter; odaklı öğeyi örtmez (WCAG 2.4.11).
 */
export function Banner({ tone, icon: Icon, children, action, className, live }: BannerProps) {
  const ariaLive = live ?? (tone === 'alarm' ? 'assertive' : 'polite');
  return (
    <div
      role={tone === 'alarm' ? 'alert' : 'status'}
      aria-live={ariaLive === 'off' ? undefined : ariaLive}
      className={cn('w-full', TONES[tone], className)}
      data-print-hide
    >
      <div className="mx-auto flex min-h-hit max-w-screen-2xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        {Icon ? <Icon aria-hidden className="size-5 shrink-0" /> : null}
        <div className="min-w-0 flex-1 text-sm font-semibold sm:text-base">{children}</div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
