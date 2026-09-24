import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// globals.css'teki özel token'lar: dokunma hedefleri (h-hit …) ve hareket eğrisi.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ['hit', 'hit-sf', 'hit-primary', 'hit-primary-lg'],
      ease: ['standard'],
    },
  },
});

/** Sınıf adlarını birleştirir; çakışan Tailwind sınıflarında sonuncusu kazanır. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
