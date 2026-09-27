import { cn } from '@/lib/cn';
import { SITE_NAME } from '@/lib/site';

/**
 * Yemek Gelsin işareti (00 §12a madde 9): mürekkep yuvarlatılmış kare içinde safran servis kapağı (cloche), beyaz
 * tabak ve hız çizgileri: "yemek yolda". Renkler marka token'larıdır (--ink-900, --saffron-500; 12 §3.2).
 * app/icon.svg ve public/icon.svg (panel PWA simgesi) aynı çizimdir.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" fill="#14233A" />
      <path d="M5 13.9h3.6M4 17.4h4.2" fill="none" stroke="#FFFFFF" strokeOpacity=".72" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M11 19.6a7.5 7.5 0 0 1 15 0z" fill="#F5A524" />
      <circle cx="18.5" cy="10.6" r="1.6" fill="#F5A524" />
      <rect x="9.2" y="20.7" width="18.6" height="2.5" rx="1.25" fill="#FFFFFF" />
    </svg>
  );
}

/** İşaret + "Yemek Gelsin" yazısı (başlık, altbilgi, giriş ekranları). */
export function Logo({ className, showText = true, textClassName }: { className?: string; showText?: boolean; textClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      {showText ? (
        <span className={cn('whitespace-nowrap text-lg font-extrabold tracking-tight text-fg', textClassName)}>{SITE_NAME}</span>
      ) : null}
      {!showText ? <span className="sr-only">{SITE_NAME}</span> : null}
    </span>
  );
}
