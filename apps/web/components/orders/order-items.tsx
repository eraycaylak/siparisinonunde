import { StickyNote } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatMoney, trUpper } from '@/lib/format';
import { isRemoval } from './labels';

export interface OrderItemView {
  name: string;
  quantity: number;
  options: string[];
  note?: string | null;
  lineTotalKurus?: number;
}

/**
 * Kalem listesi: "2× Tavuk Dürüm" + seçenekler; çıkarılacaklar BÜYÜK HARF ve kalın (04 §4.4).
 * `max` verilirse ilk N kalem + "ve N ürün daha".
 */
export function OrderItems({
  items,
  max,
  showPrices = false,
  large = false,
  className,
}: {
  items: OrderItemView[];
  max?: number;
  showPrices?: boolean;
  large?: boolean;
  className?: string;
}) {
  const shown = max ? items.slice(0, max) : items;
  const rest = max ? items.length - shown.length : 0;
  return (
    <ul className={cn('flex flex-col gap-1', large ? 'text-xl' : 'text-base', className)}>
      {shown.map((item, i) => (
        <li key={`${item.name}-${i}`} className="flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 font-semibold">
              <span className="tabular-nums">{item.quantity}×</span> {item.name}
            </span>
            {showPrices && item.lineTotalKurus != null ? (
              <span className="shrink-0 tabular-nums text-fg-muted">{formatMoney(item.lineTotalKurus)}</span>
            ) : null}
          </div>
          {item.options.length ? (
            <span className="ps-6 text-sm leading-6">
              {item.options.map((o, j) => (
                <span key={`${o}-${j}`}>
                  {j > 0 ? ', ' : ''}
                  {isRemoval(o) ? <strong className="font-extrabold">{trUpper(o)}</strong> : <span className="text-fg-muted">{o}</span>}
                </span>
              ))}
            </span>
          ) : null}
          {item.note ? (
            <span className="ms-6 mt-0.5 inline-flex items-start gap-1 rounded-sm bg-note px-2 py-0.5 text-sm text-note-fg">
              <StickyNote aria-hidden className="mt-0.5 size-4 shrink-0" />
              {item.note}
            </span>
          ) : null}
        </li>
      ))}
      {rest > 0 ? <li className="text-sm text-fg-muted">ve {rest} ürün daha</li> : null}
    </ul>
  );
}
