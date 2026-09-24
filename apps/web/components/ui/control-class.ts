/** Ortak form alanı stili: ≥ 48 px yükseklik, ≥ 16 px yazı, ≥ 3:1 kenar (border-strong). */
export const controlClass = [
  'w-full rounded-md border border-border-strong bg-surface-raised px-3 text-base text-fg',
  'placeholder:text-fg-muted/80',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'aria-invalid:border-destructive aria-invalid:border-2',
].join(' ');
