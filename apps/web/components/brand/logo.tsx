import { cn } from '@/lib/cn';
import { SITE_NAME } from '@/lib/site';
import { MARK_PATH, MARK_PATH_SIMPLE, MARK_VIEWBOX } from './mark';

/**
 * Yalnız işaret. Renk `currentColor` (varsayılan marka kırmızısı); boyut yükseklikle verilir, genişlik en/boy oranından gelir.
 * Kırmızı zemin üstünde `text-white` ile kullanılır.
 */
export function LogoMark({ className, simple = false }: { className?: string; simple?: boolean }) {
  return (
    <svg viewBox={MARK_VIEWBOX} aria-hidden focusable="false" className={cn('aspect-[451/302] h-7 w-auto shrink-0 text-brand-red', className)}>
      <path fill="currentColor" fillRule="evenodd" d={simple ? MARK_PATH_SIMPLE : MARK_PATH} />
    </svg>
  );
}

/** İşaret + "Yemek Gelsin" yazısı (başlık, altbilgi, giriş ekranları). Yazı rengi `wordmark` token'ı (12 §3.2). */
export function Logo({
  className,
  showText = true,
  textClassName,
  markClassName,
}: {
  className?: string;
  showText?: boolean;
  textClassName?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className={cn('h-8', markClassName)} />
      {showText ? (
        <span className={cn('whitespace-nowrap text-xl font-extrabold leading-none tracking-tight text-wordmark', textClassName)}>{SITE_NAME}</span>
      ) : null}
      {!showText ? <span className="sr-only">{SITE_NAME}</span> : null}
    </span>
  );
}
