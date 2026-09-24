'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, Plus, RotateCcw, Search, SearchX, Store, X } from 'lucide-react';
import { toast } from 'sonner';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, errorMessage, isApiError, type ApiError } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { cn } from '@/lib/cn';
import { formatMoney, searchKey } from '@/lib/format';
import { CartBar, CartSheet, useCartView } from './cart';
import { CustomerGreeting, LastOrderCard } from './customer-context';
import { orderingStatus } from './format';
import type { ReorderPlan, StoreProduct } from './menu-logic';
import { ProductSheet } from './product-sheet';
import { StoreHeader } from './store-header';
import { useStoreSession } from './use-store-session';

export interface StorefrontMenuProps {
  slug: string;
  /** SSR'da alınan vitrin; alınamadıysa null (istemci yeniden dener). */
  initialStore: StorefrontView | null;
}

/** S-01 menü (03 §4.1): başlık, "Son siparişin", arama, yapışkan kategori sekmeleri, ürün kartları, sepet. */
export function StorefrontMenu({ slug, initialStore }: StorefrontMenuProps) {
  const query = useQuery<StorefrontView, ApiError>({
    queryKey: ['store', slug],
    queryFn: ({ signal }) => apiFetch<StorefrontView>(`/store/${encodeURIComponent(slug)}`, { signal }),
    initialData: initialStore ?? undefined,
    staleTime: 15_000,
    // Tükendi/açık-kapalı değişimleri açık sayfaya da yansısın
    refetchInterval: 60_000,
  });
  const store = query.data;

  if (!store) {
    if (query.isError) {
      if (isApiError(query.error) && query.error.status === 404) {
        return <EmptyState icon={Store} title="İşletme bulunamadı" description="Adresi kontrol edin ya da işletmeden yeni bağlantı isteyin." className="mt-8" />;
      }
      return (
        <div className="mt-8 flex flex-col items-center gap-4 text-center" role="alert">
          <p className="text-lg font-bold">Menü yüklenemedi</p>
          <p className="text-base text-fg-muted">{errorMessage(query.error)}</p>
          <Button onClick={() => void query.refetch()} size="lg">
            <RotateCcw aria-hidden />
            Tekrar dene
          </Button>
        </div>
      );
    }
    return <MenuSkeleton />;
  }
  return <MenuView slug={slug} store={store} />;
}

function MenuSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Menü yükleniyor">
      <Skeleton className="-mx-4 -mt-4 h-40" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-12" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  );
}

function MenuView({ slug, store }: { slug: string; store: StorefrontView }) {
  const cart = useCart(slug);
  const cartView = useCartView(store, cart);
  const session = useStoreSession(slug);
  const [forgetting, setForgetting] = useState(false);
  const [openProduct, setOpenProduct] = useState<StoreProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [q, setQ] = useState('');
  const status = orderingStatus(store);
  const closedText = status.acceptsOrders ? null : status.band;

  // Ürün çekmecesi açıkken menü tazelenirse güncel ürünü göster (ör. tükendi oldu)
  useEffect(() => {
    if (!openProduct) return;
    const fresh = store.categories.flatMap((c) => c.products).find((p) => p.id === openProduct.id);
    if (fresh && fresh !== openProduct) setOpenProduct(fresh);
  }, [store, openProduct]);

  const key = searchKey(q);
  const categories = useMemo(() => {
    if (!key) return store.categories;
    return store.categories
      .map((c) => ({ ...c, products: c.products.filter((p) => searchKey(`${p.name} ${p.description ?? ''} ${c.name}`).includes(key)) }))
      .filter((c) => c.products.length > 0);
  }, [store.categories, key]);

  const forget = async () => {
    setForgetting(true);
    try {
      await session.forget();
      toast.success('Bu cihazdaki bağlantı kaldırıldı.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setForgetting(false);
    }
  };

  const quickAdd = useCallback(
    (p: StoreProduct) => {
      cart.add({ productId: p.id, quantity: 1, optionIds: [], name: p.name, unitPriceKurus: p.priceKurus, optionLabels: [], imageUrl: p.imageUrl });
      toast.success('Sepete eklendi', { description: p.name, duration: 2500 });
    },
    [cart],
  );

  const reorder = (plan: ReorderPlan) => {
    for (const line of plan.lines) cart.add(line);
    toast.success('Son siparişindeki ürünler sepete eklendi.');
    setCartOpen(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <StoreHeader store={store} status={status} />

      {session.status === 'ready' ? (
        <>
          <CustomerGreeting session={session.data} onForget={forget} forgetting={forgetting} />
          {session.data.lastOrder ? (
            <LastOrderCard
              lastOrder={session.data.lastOrder}
              source={session.data.lastOrderSource ?? null}
              store={store}
              acceptsOrders={status.acceptsOrders}
              onReorder={reorder}
              onForgetDevice={forget}
            />
          ) : null}
        </>
      ) : null}

      {store.categories.length === 0 ? (
        <EmptyState icon={Store} title="Menü hazırlanıyor" description="Bu işletmenin online menüsü çok yakında burada olacak." />
      ) : (
        <>
          <div className="relative">
            <label htmlFor="menu-ara" className="sr-only">
              Menüde ara
            </label>
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
            <input
              id="menu-ara"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Menüde ara…"
              autoComplete="off"
              className="min-h-hit w-full rounded-md border border-border-strong bg-surface-raised ps-10 pe-12 text-base text-fg placeholder:text-fg-muted/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label="Aramayı temizle"
                className="absolute end-0 top-0 inline-flex size-hit items-center justify-center text-fg-muted"
              >
                <X aria-hidden className="size-5" />
              </button>
            ) : null}
          </div>

          {categories.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center" role="status">
              <SearchX aria-hidden className="size-8 text-fg-muted" />
              <p className="text-base">Aradığınızı bulamadık.</p>
              <Button variant="secondary" onClick={() => setQ('')}>
                Tüm menü
              </Button>
            </div>
          ) : (
            <CategorySections
              categories={categories}
              canOrder={status.acceptsOrders}
              onOpen={setOpenProduct}
              onQuickAdd={quickAdd}
            />
          )}
        </>
      )}

      {cart.count > 0 ? <div aria-hidden className="h-20" /> : null}

      <ProductSheet
        product={openProduct}
        onClose={() => setOpenProduct(null)}
        canOrder={status.acceptsOrders}
        closedText={closedText}
        onAdd={({ product, optionIds, quantity, note, optionLabels, unitPriceKurus }) => {
          cart.add({ productId: product.id, quantity, optionIds, note: note || undefined, name: product.name, unitPriceKurus, optionLabels, imageUrl: product.imageUrl });
          setOpenProduct(null);
          toast.success('Sepete eklendi', { description: `${quantity}× ${product.name}`, duration: 2500 });
        }}
      />
      <CartBar count={cart.count} subtotalKurus={cartView.subtotalKurus} onOpen={() => setCartOpen(true)} />
      <CartSheet
        open={cartOpen}
        onOpenChange={setCartOpen}
        slug={slug}
        store={store}
        cart={cart}
        acceptsOrders={status.acceptsOrders}
        closedText={closedText}
      />
    </div>
  );
}

interface CategorySectionsProps {
  categories: StorefrontView['categories'];
  canOrder: boolean;
  onOpen: (p: StoreProduct) => void;
  onQuickAdd: (p: StoreProduct) => void;
}

/** Yapışkan kategori sekmeleri (kaydırınca etkin sekme) + kategori bölümleri. */
function CategorySections({ categories, canOrder, onOpen, onQuickAdd }: CategorySectionsProps) {
  const [active, setActive] = useState(categories[0]?.id ?? '');
  const tabsRef = useRef<HTMLDivElement>(null);
  const lockUntil = useRef(0);
  const ids = useMemo(() => categories.map((c) => c.id), [categories]);

  useEffect(() => {
    if (!ids.includes(active)) setActive(ids[0] ?? '');
  }, [ids, active]);

  // Scrollspy: görünür bölümlerden en üstteki etkin sekme olur
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.catSection ?? '';
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        if (Date.now() < lockUntil.current) return;
        const first = ids.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: '-80px 0px -55% 0px', threshold: 0 },
    );
    for (const id of ids) {
      const el = document.getElementById(`k-${id}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [ids]);

  // Etkin sekmeyi şeritte görünür tut
  useEffect(() => {
    const list = tabsRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-cat="${active}"]`);
    if (!list || !el) return;
    const left = el.offsetLeft - list.clientWidth / 2 + el.clientWidth / 2;
    list.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [active]);

  const select = (id: string) => {
    setActive(id);
    lockUntil.current = Date.now() + 900;
    document.getElementById(`k-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <nav aria-label="Kategoriler" className="sticky top-0 z-10 -mx-4 border-b border-border bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/85">
        <div ref={tabsRef} className="flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {categories.map((c) => {
            const isActive = c.id === active;
            return (
              <a
                key={c.id}
                href={`#k-${c.id}`}
                data-cat={c.id}
                aria-current={isActive ? 'true' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  select(c.id);
                }}
                className={cn(
                  'inline-flex min-h-hit-sf shrink-0 items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  isActive
                    ? 'border-transparent bg-[var(--brand)] text-[var(--brand-contrast)]'
                    : 'border-border-strong bg-surface-raised text-fg hover:bg-accent',
                )}
              >
                {c.name}
              </a>
            );
          })}
        </div>
      </nav>
      {categories.map((c) => (
        <section key={c.id} id={`k-${c.id}`} data-cat-section={c.id} aria-labelledby={`kh-${c.id}`} className="scroll-mt-16">
          <h2 id={`kh-${c.id}`} className="mb-2 text-xl font-bold text-fg">
            {c.name}
          </h2>
          <ul className="flex flex-col gap-3">
            {c.products.map((p) => (
              <ProductCard key={p.id} product={p} canOrder={canOrder} onOpen={() => onOpen(p)} onQuickAdd={() => onQuickAdd(p)} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function ProductCard({ product: p, canOrder, onOpen, onQuickAdd }: { product: StoreProduct; canOrder: boolean; onOpen: () => void; onQuickAdd: () => void }) {
  const hasOptions = p.optionGroups.length > 0;
  const canAdd = canOrder && !p.soldOut;
  return (
    <li className={cn('flex items-stretch gap-2 rounded-lg border border-border bg-surface-raised p-3 shadow-sm', p.soldOut && 'bg-surface')}>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-haspopup="dialog"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn('break-words text-base font-semibold', p.soldOut ? 'text-fg-muted' : 'text-fg')}>{p.name}</span>
          {p.description ? <span className="line-clamp-2 break-words text-sm text-fg-muted">{p.description}</span> : null}
          <span className="mt-auto flex flex-wrap items-center gap-2">
            <span className={cn('text-base font-bold tabular-nums', p.soldOut ? 'text-fg-muted' : 'text-[var(--brand-strong)]')}>{formatMoney(p.priceKurus)}</span>
            {p.soldOut ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-status-cancelled-bg px-2 py-0.5 text-xs font-semibold text-status-cancelled-fg">
                <Ban aria-hidden className="size-3.5" />
                Tükendi (bugün)
              </span>
            ) : null}
          </span>
        </span>
        {p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.imageUrl}
            alt=""
            loading="lazy"
            width={80}
            height={80}
            className={cn('size-20 shrink-0 rounded-md bg-surface object-cover', p.soldOut && 'opacity-50 grayscale')}
          />
        ) : null}
      </button>
      {canAdd ? (
        <button
          type="button"
          onClick={hasOptions ? onOpen : onQuickAdd}
          aria-label={hasOptions ? `${p.name}: seçenekleri gör` : `${p.name} sepete ekle`}
          className="inline-flex size-hit shrink-0 items-center justify-center self-end rounded-full bg-[var(--brand)] text-[var(--brand-contrast)] shadow-sm hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus aria-hidden className="size-6" />
        </button>
      ) : null}
    </li>
  );
}
