import { cn } from '@/lib/cn';

/** İşletme ana rengiyle birincil buton (metin rengi otomatik kontrast: --brand-contrast; 12 §5.1). */
export const brandButtonClass = cn(
  'inline-flex items-center justify-center gap-2 rounded-md px-4 font-bold',
  'bg-[var(--brand)] text-[var(--brand-contrast)] hover:opacity-95 active:opacity-90',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
);
