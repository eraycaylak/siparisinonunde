'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Check, Info } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { formatDelta } from './format';
import {
  NOTE_MAX,
  QUANTITY_MAX,
  groupRuleText,
  isSingleChoice,
  optionLabels,
  orderedOptionIds,
  selectionErrors,
  unitPriceKurus,
  type StoreOptionGroup,
  type StoreProduct,
} from './menu-logic';
import { QuantityStepper } from './quantity-stepper';

export interface ProductSheetProps {
  product: StoreProduct | null;
  onClose: () => void;
  /** Sipariş alınıyor mu; değilse sepete ekleme yerine bilgi gösterilir. */
  canOrder: boolean;
  /** Kapalıyken gösterilecek metin ("Şu an kapalıyız · Yarın 10.00'da açılıyor"). */
  closedText: string | null;
  onAdd: (input: { product: StoreProduct; optionIds: string[]; quantity: number; note: string; optionLabels: string[]; unitPriceKurus: number }) => void;
}

/** S-02 ürün detayı ve seçenekler (03 §4.2): tek seçim radyo, çoklu onay kutusu, min/max, adet, not, canlı tutar. */
export function ProductSheet({ product, onClose, canOrder, closedText, onAdd }: ProductSheetProps) {
  return (
    <Sheet
      open={product !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={product?.name ?? ''}
      size="md"
    >
      {product ? <ProductSheetBody key={product.id} product={product} canOrder={canOrder} closedText={closedText} onAdd={onAdd} /> : null}
    </Sheet>
  );
}

function ProductSheetBody({ product, canOrder, closedText, onAdd }: Omit<ProductSheetProps, 'product' | 'onClose'> & { product: StoreProduct }) {
  const [selected, setSelected] = useState<Map<string, string[]>>(() => new Map());
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const groupRefs = useRef(new Map<string, HTMLFieldSetElement>());

  const optionIds = useMemo(() => orderedOptionIds(product, [...selected.values()].flat()), [product, selected]);
  const unit = unitPriceKurus(product, optionIds);
  const errors = useMemo(() => selectionErrors(product, selected), [product, selected]);
  const total = unit * quantity;

  useEffect(() => {
    if (showErrors && errors.size === 0) setShowErrors(false);
  }, [errors, showErrors]);

  const toggle = (g: StoreOptionGroup, optionId: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const cur = next.get(g.id) ?? [];
      if (isSingleChoice(g)) {
        // Zorunlu tek seçimde değiştir; isteğe bağlıda aynı seçeneğe tekrar dokununca kaldır
        next.set(g.id, cur[0] === optionId && g.minSelect === 0 ? [] : [optionId]);
      } else if (cur.includes(optionId)) {
        next.set(g.id, cur.filter((id) => id !== optionId));
      } else if (g.maxSelect === null || cur.length < g.maxSelect) {
        next.set(g.id, [...cur, optionId]);
      }
      return next;
    });
  };

  const submit = () => {
    if (errors.size) {
      setShowErrors(true);
      const first = product.optionGroups.find((g) => errors.has(g.id));
      const el = first ? groupRefs.current.get(first.id) : null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
      return;
    }
    onAdd({ product, optionIds, quantity, note: note.trim(), optionLabels: optionLabels(product, optionIds), unitPriceKurus: unit });
  };

  return (
    <div className="flex flex-col gap-5">
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.imageUrl} alt="" className="aspect-[4/3] w-full rounded-lg bg-surface object-cover" />
      ) : null}
      <div className="flex flex-col gap-1">
        {product.description ? <p className="text-base text-fg-muted">{product.description}</p> : null}
        <p className="text-lg font-bold text-[var(--brand-strong)] tabular-nums">{formatMoney(product.priceKurus)}</p>
      </div>

      {product.soldOut ? (
        <Alert variant="warning" title="Bu ürün bugün tükendi">
          Yarın yeniden satışta olacak. Menüdeki diğer ürünlere göz atabilirsiniz.
        </Alert>
      ) : null}

      {product.optionGroups.map((g) => {
        const cur = selected.get(g.id) ?? [];
        const single = isSingleChoice(g);
        const atMax = !single && g.maxSelect !== null && cur.length >= g.maxSelect;
        const error = showErrors ? errors.get(g.id) : undefined;
        const errId = `grp-${g.id}-err`;
        return (
          <fieldset
            key={g.id}
            ref={(el) => {
              if (el) groupRefs.current.set(g.id, el);
              else groupRefs.current.delete(g.id);
            }}
            aria-describedby={error ? errId : undefined}
            className={cn('flex min-w-0 flex-col gap-2 rounded-lg border p-3', error ? 'border-2 border-destructive' : 'border-border')}
          >
            <legend className="px-1">
              <span className="text-base font-bold text-fg">{g.name}</span>
              <span className={cn('ms-2 text-sm', g.minSelect > 0 ? 'font-semibold text-fg' : 'text-fg-muted')}>{groupRuleText(g)}</span>
            </legend>
            {atMax ? <p className="text-sm text-fg-muted">En çok {g.maxSelect} seçebilirsiniz.</p> : null}
            <div className="flex flex-col gap-1">
              {g.options.map((o) => {
                const checked = cur.includes(o.id);
                const disabled = !checked && atMax;
                return (
                  <label
                    key={o.id}
                    className={cn(
                      'flex min-h-hit cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors',
                      checked ? 'border-2 border-[var(--brand-ui)] bg-[var(--brand-subtle)]' : 'border-border hover:bg-accent',
                      disabled && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <input
                      type={single ? 'radio' : 'checkbox'}
                      name={`grp-${g.id}`}
                      value={o.id}
                      checked={checked}
                      disabled={disabled}
                      onChange={() => {
                        if (!single || !checked) toggle(g, o.id);
                      }}
                      onClick={() => {
                        if (single && checked && g.minSelect === 0) toggle(g, o.id);
                      }}
                      className="size-5 shrink-0 accent-[var(--brand-ui)]"
                    />
                    <span className="min-w-0 flex-1 break-words text-base text-fg">{o.name}</span>
                    {o.priceDeltaKurus ? <span className="shrink-0 text-sm font-semibold tabular-nums text-fg-muted">{formatDelta(o.priceDeltaKurus)}</span> : null}
                  </label>
                );
              })}
            </div>
            {error ? (
              <p id={errId} className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <Info aria-hidden className="size-4 shrink-0" />
                {error}
              </p>
            ) : null}
          </fieldset>
        );
      })}

      {canOrder && !product.soldOut ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`note-${product.id}`} className="text-sm font-semibold text-fg">
              Ürün notu <span className="font-normal text-fg-muted">(isteğe bağlı)</span>
            </label>
            <textarea
              id={`note-${product.id}`}
              value={note}
              maxLength={NOTE_MAX}
              rows={2}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
              placeholder="Örn: Az soslu olsun"
              aria-describedby={`note-${product.id}-count`}
              className="min-h-hit w-full rounded-md border border-border-strong bg-surface-raised px-3 py-2.5 text-base leading-6 text-fg placeholder:text-fg-muted/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <p id={`note-${product.id}-count`} className="text-end text-xs text-fg-muted tabular-nums">
              {note.length}/{NOTE_MAX}
            </p>
          </div>
          <div className="sticky -bottom-4 -mx-4 -mb-4 flex flex-col gap-3 border-t border-border bg-surface-raised px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-fg sm:sr-only">Adet</span>
              <QuantityStepper value={quantity} onChange={setQuantity} max={QUANTITY_MAX} label={`${product.name} adedi`} size="lg" />
            </div>
            <button
              type="button"
              onClick={submit}
              className={cn(
                'inline-flex min-h-hit-primary min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-4 text-base font-bold',
                'bg-[var(--brand)] text-[var(--brand-contrast)] hover:opacity-95 active:opacity-90',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              )}
            >
              <Check aria-hidden className="size-5 shrink-0" />
              <span>Sepete ekle · {formatMoney(total)}</span>
            </button>
          </div>
        </>
      ) : !product.soldOut ? (
        <Alert variant="info" title="Şu an sipariş almıyoruz">
          {closedText ?? 'Menüye göz atabilirsiniz; sipariş verme açıldığında sepete ekleyebilirsiniz.'}
        </Alert>
      ) : (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Ban aria-hidden className="size-4" /> Sepete eklenemez.
        </p>
      )}
    </div>
  );
}
