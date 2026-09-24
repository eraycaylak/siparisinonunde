import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SectionProps {
  id?: string;
  eyebrow?: string;
  title?: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: 'default' | 'muted' | 'ink';
  /** Başlık düzeyi (sayfada tek h1 olsun diye bölümler h2). */
  as?: 'h1' | 'h2';
}

const TONES = {
  default: 'bg-bg text-fg',
  muted: 'bg-surface text-fg',
  ink: 'bg-ink text-white',
} as const;

/** Pazarlama bölümü: ortalanmış kap + başlık. */
export function Section({ id, eyebrow, title, lead, children, className, tone = 'default', as = 'h2' }: SectionProps) {
  const Heading = as;
  const titleId = id ? `${id}-baslik` : undefined;
  return (
    <section id={id} aria-labelledby={title ? titleId : undefined} className={cn(TONES[tone], className)}>
      <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
        {eyebrow || title || lead ? (
          <div className="mb-10 flex max-w-3xl flex-col gap-3">
            {eyebrow ? (
              <p className={cn('text-sm font-bold uppercase tracking-wider', tone === 'ink' ? 'text-saffron' : 'text-fg-muted')}>
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <Heading id={titleId} className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
                {title}
              </Heading>
            ) : null}
            {lead ? <p className={cn('text-lg leading-8', tone === 'ink' ? 'text-white/85' : 'text-fg-muted')}>{lead}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}
