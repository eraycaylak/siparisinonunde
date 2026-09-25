'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useTheme, type ThemePreference } from '@/lib/theme';

const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Açık', Icon: Sun },
  { value: 'dark', label: 'Koyu', Icon: Moon },
  { value: 'system', label: 'Sistem', Icon: Monitor },
];

/** Tema seçici: Açık / Koyu / Sistem (radyo grubu). */
export function ThemeToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <div role="radiogroup" aria-label="Tema" className={cn('inline-flex rounded-md border border-border p-1', className)}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={compact ? label : undefined}
            onClick={() => setTheme(value)}
            className={cn(
              'inline-flex min-h-hit min-w-hit items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-semibold transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              selected ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:bg-accent hover:text-fg',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {compact ? null : <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
