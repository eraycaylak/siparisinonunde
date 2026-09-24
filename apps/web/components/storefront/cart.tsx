'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ShoppingBag, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import type { UseCart } from '@/lib/cart';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { storefrontHref } from '@/lib/storefront-url';
import { brandButtonClass } from './brand';
import { deliveryFeeRange, deliveryMinOrderKurus } from './format';
import { QUANTITY_MAX, lineStatus, productIndex } from './menu-logic';
import { QuantityStepper } from './quantity-stepper';

/** Gösterim ara toplamı: güncel menü fiyatıyla (satışta olmayan satırlar hariç). */
export function useCartView(store: StorefrontView, cart: UseCart) {
  return useMemo(() => {
    const byId = productIndex(store);
    const lines = cart.lines.map((l) => ({ line: l, ...lineStatus(l, byId) }));
    const subtotalKurus = lines.filter((l) => l.available).reduce((s, l) => s + l.unitPriceKurus * l.line.quantity, 0);
    return { lines, subtotalKurus, unavailableCount: lines.filter((l) => !l.available).length };
  }, [store, cart.lines]);
}

/** Alt sabit sepet çubuğu (S-01): "Sepeti gör · 3 ürün · 485,00 TL". */
export function CartBar({ count, subtotalKurus, onOpen }: { count: number; subtotalKurus: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20" data-print-hide>
      <div className="pointer-events-auto mx-auto w-full max-w-2xl px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={onOpen} className={cn(brandButtonClass, 'min-h-hit-primary w-full justify-between text-base shadow-lg')}>
          <span className="flex items-center gap-2">
            <ShoppingBag aria-hidden className="size-5" />
            Sepeti gör
          </span>
          <span className="tabular-nums">
            {count} ürün · {formatMoney(subtotalKurus)}
          </span>
        </button>
      </div>
    </div>
  );
}

export interface CartSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  store: StorefrontView;
  cart: UseCart;
  acceptsOrders: boolean;
  closedText: string | null;
}

/** S-03 sepet çekmecesi: satırlar, adet, sil (5 sn geri al), ara toplam, min. sepet ipucu, "Siparişi tamamla". */
export function CartSheet({ open, onOpenChange, slug, store, cart, acceptsOrders, closedText }: CartSheetProps) {
  const view = useCartView(store, cart);
  const minOrder = deliveryMinOrderKurus(store);
  const feeRange = deliveryFeeRange(store);
  const missing = minOrder > 0 ? minOrder - view.subtotalKurus : 0;

  const removeLine = (key: string) => {
    const line = cart.lines.find((l) => l.key === key);
    if (!line) return;
    cart.remove(key);
    const { key: _key, ...rest } = line;
    toast('Ürün sepetten çıkarıldı', {
      description: line.name,
      duration: 5000,
      action: { label: 'Geri al', onClick: () => cart.add(rest) },
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Sepetiniz"
      description={cart.count ? `${cart.count} ürün` : undefined}
      footer={
        cart.count ? (
          <div className="flex w-full flex-col gap-3">
            <div className="flex items-baseline justify-between text-base">
              <span className="font-semibold">Ara toplam</span>
              <span className="text-lg font-bold tabular-nums">{formatMoney(view.subtotalKurus)}</span>
            </div>
            {feeRange ? <p className="text-sm text-fg-muted">Teslimat ücreti adrese göre {feeRange}. Kesin tutar bir sonraki adımda hesaplanır.</p> : null}
            {missing > 0 ? (
              <p className="text-sm font-semibold text-fg" role="status">
                Paket serviste minimum sepete {formatMoney(missing)} kaldı.
              </p>
            ) : null}
            {acceptsOrders ? (
              <Link href={storefrontHref(slug, '/siparis')} className={cn(brandButtonClass, 'min-h-hit-primary w-full text-lg')} onClick={() => onOpenChange(false)}>
                Siparişi tamamla
              </Link>
            ) : (
              <Alert variant="info" title="Şu an sipariş almıyoruz">
                {closedText ?? 'Sepetiniz korunur; sipariş verme açıldığında devam edebilirsiniz.'}
              </Alert>
            )}
          </div>
        ) : undefined
      }
    >
      {cart.count === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <ShoppingBag aria-hidden className="size-10 text-fg-muted" />
          <p className="text-base text-fg">Sepetiniz boş.</p>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Menüye dön
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {view.lines.map(({ line, available, unitPriceKurus }) => (
            <li key={line.key} className="flex flex-col gap-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className={cn('break-words text-base font-semibold', !available && 'text-fg-muted line-through')}>{line.name}</p>
                  {line.optionLabels.length ? <p className="break-words text-sm text-fg-muted">{line.optionLabels.join(', ')}</p> : null}
                  {line.note ? <p className="break-words text-sm italic text-fg-muted">Not: {line.note}</p> : null}
                  {!available ? (
                    <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-warning">
                      <TriangleAlert aria-hidden className="size-4 shrink-0" />
                      Şu an satışta değil; siparişe eklenmez.
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 text-base font-bold tabular-nums">{formatMoney(unitPriceKurus * line.quantity)}</p>
              </div>
              <div className="flex items-center justify-between gap-2">
                <QuantityStepper
                  value={line.quantity}
                  max={QUANTITY_MAX}
                  label={`${line.name} adedi`}
                  removeAtMin
                  onChange={(q) => (q <= 0 ? removeLine(line.key) : cart.setQuantity(line.key, q))}
                />
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  className="min-h-hit-sf rounded-md px-3 text-sm font-semibold text-fg-muted underline-offset-4 hover:underline"
                >
                  Sil
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
