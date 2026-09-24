import { cn } from '@/lib/cn';
import { SITE_NAME } from '@/lib/site';

/** Geçici işaret: mürekkep kare + safran ileri ok ("önünde olmak", 12 §3.1). Nihai logo tasarımcıdan gelecek. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" fill="#14233A" />
      <path d="M9 9.5 15.5 16 9 22.5" fill="none" stroke="#F5A524" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.5 9.5 23 16l-6.5 6.5" fill="none" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, showText = true, textClassName }: { className?: string; showText?: boolean; textClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      {showText ? <span className={cn('whitespace-nowrap text-lg font-bold tracking-tight text-fg', textClassName)}>{SITE_NAME}</span> : null}
      {!showText ? <span className="sr-only">{SITE_NAME}</span> : null}
    </span>
  );
}
