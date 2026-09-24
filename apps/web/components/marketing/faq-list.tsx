import { ChevronDown } from 'lucide-react';
import type { FaqItem } from '@/lib/faq';

/** SSS listesi: yerel <details> (JS gerekmez, klavye ile açılır). */
export function FaqList({ items, headingLevel = 'h3' }: { items: readonly FaqItem[]; headingLevel?: 'h2' | 'h3' }) {
  const Heading = headingLevel;
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-surface-raised">
      {items.map((item) => (
        <details key={item.id} id={item.id} className="group">
          <summary className="flex min-h-hit cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <Heading className="text-base font-semibold text-fg sm:text-lg">{item.q}</Heading>
            <ChevronDown aria-hidden className="size-5 shrink-0 text-fg-muted transition-transform group-open:rotate-180" />
          </summary>
          <p className="px-5 pb-5 text-base leading-7 text-fg-muted">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
