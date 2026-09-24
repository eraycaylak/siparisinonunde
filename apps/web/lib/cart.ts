'use client';

/**
 * Storefront sepeti — vitrin (dilim 1) ve sipariş/checkout (dilim 2) bu modülü ORTAK kullanır.
 * Sepet tarayıcıda, işletme slug'ına göre localStorage'da tutulur. Fiyatlar yalnız gösterim içindir;
 * gerçek tutarı her zaman sunucu hesaplar (POST /api/v1/store/:slug/quote).
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { CartItem } from '@siparis/core/contracts/store';

export interface CartLine extends CartItem {
  /** Aynı ürün + aynı seçenekler + aynı not → aynı satır. */
  key: string;
  name: string;
  /** Ürün birim fiyatı + seçenek farkları (kuruş) — gösterim amaçlı. */
  unitPriceKurus: number;
  /** Seçilen seçeneklerin okunur etiketleri (ör. "Acılı", "Ekstra kaşar"). */
  optionLabels: string[];
  imageUrl?: string | null;
}

type CartState = { lines: CartLine[]; updatedAt: number };

const STORAGE_PREFIX = 'siparisinonunde:cart:';
const EMPTY: CartState = { lines: [], updatedAt: 0 };
const listeners = new Set<() => void>();
const cache = new Map<string, CartState>();

function storageKey(slug: string) {
  return STORAGE_PREFIX + slug;
}

function read(slug: string): CartState {
  const cached = cache.get(slug);
  if (cached) return cached;
  let state = EMPTY;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey(slug)) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as CartState;
      if (Array.isArray(parsed?.lines)) state = { lines: parsed.lines, updatedAt: parsed.updatedAt ?? 0 };
    }
  } catch {
    state = EMPTY;
  }
  cache.set(slug, state);
  return state;
}

function write(slug: string, lines: CartLine[]) {
  const state: CartState = { lines, updatedAt: Date.now() };
  cache.set(slug, state);
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify(state));
  } catch {
    /* gizli sekme vb. — bellekte devam */
  }
  listeners.forEach((l) => l());
}

export function lineKey(item: Pick<CartItem, 'productId' | 'optionIds' | 'note'>): string {
  const opts = [...(item.optionIds ?? [])].sort().join(',');
  return `${item.productId}|${opts}|${(item.note ?? '').trim()}`;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(STORAGE_PREFIX)) {
      cache.clear();
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export interface UseCart {
  lines: CartLine[];
  /** Toplam adet. */
  count: number;
  /** Gösterim amaçlı ara toplam (kuruş). */
  subtotalKurus: number;
  add(line: Omit<CartLine, 'key'>): void;
  setQuantity(key: string, quantity: number): void;
  remove(key: string): void;
  clear(): void;
  /** Sunucuya gidecek biçim (quote / sipariş oluşturma). */
  toItems(): CartItem[];
}

export function useCart(slug: string): UseCart {
  const state = useSyncExternalStore(
    subscribe,
    () => read(slug),
    () => EMPTY,
  );

  // Başka sekmede güncellenen sepeti ilk yüklemede oku.
  useEffect(() => {
    cache.delete(slug);
    listeners.forEach((l) => l());
  }, [slug]);

  const add = useCallback<UseCart['add']>(
    (line) => {
      const key = lineKey(line);
      const lines = [...read(slug).lines];
      const existing = lines.find((l) => l.key === key);
      if (existing) existing.quantity = Math.min(99, existing.quantity + line.quantity);
      else lines.push({ ...line, key });
      write(slug, lines.map((l) => ({ ...l })));
    },
    [slug],
  );

  const setQuantity = useCallback<UseCart['setQuantity']>(
    (key, quantity) => {
      const lines = read(slug)
        .lines.map((l) => (l.key === key ? { ...l, quantity: Math.max(0, Math.min(99, quantity)) } : l))
        .filter((l) => l.quantity > 0);
      write(slug, lines);
    },
    [slug],
  );

  const remove = useCallback<UseCart['remove']>(
    (key) => write(slug, read(slug).lines.filter((l) => l.key !== key)),
    [slug],
  );

  const clear = useCallback(() => write(slug, []), [slug]);

  return useMemo<UseCart>(
    () => ({
      lines: state.lines,
      count: state.lines.reduce((n, l) => n + l.quantity, 0),
      subtotalKurus: state.lines.reduce((n, l) => n + l.unitPriceKurus * l.quantity, 0),
      add,
      setQuantity,
      remove,
      clear,
      toItems: () =>
        state.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          optionIds: l.optionIds ?? [],
          ...(l.note ? { note: l.note } : {}),
        })),
    }),
    [state, add, setQuantity, remove, clear],
  );
}
