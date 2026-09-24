'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Download, ImageOff, Layers, Pencil, Percent, Plus, RotateCcw, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { formatNextOpenTR } from '@siparis/core/hours';
import type { PanelMenuResponse, PanelProduct } from '@siparis/core/menu/contracts';
import { ScreenError, ScreenLoading } from '@/components/common/screen-state';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney, formatTime, searchKey } from '@/lib/format';
import { BulkPriceDialog } from './bulk-price-dialog';
import { CategoriesPanel } from './categories-panel';
import { ActiveToggle, MoneyInput, MoveButtons, SoldOutToggle, inputToKurus, kurusToInput, moveItem } from './controls';
import { CsvImportDialog } from './csv-import-dialog';
import { EXPORT_CSV_URL, MENU_QUERY_KEY, menuApi, useInvalidateMenu, useMenuQuery } from './menu-api';
import { OptionGroupEditor, groupRule } from './option-group-editor';
import { ProductEditor } from './product-editor';

/** /panel/menu (04 §6): owner/manager tam düzenleme; cashier/kitchen yalnız "Bugün tükendi" (04 §2.3 P-12). */
export function MenuPage() {
  const query = useMenuQuery();
  if (query.isPending) return <ScreenLoading label="Menü yükleniyor…" />;
  if (query.isError) return <ScreenError error={query.error} onRetry={() => void query.refetch()} />;
  return <MenuScreen menu={query.data} />;
}

function MenuScreen({ menu }: { menu: PanelMenuResponse }) {
  const invalidate = useInvalidateMenu();
  const [tab, setTab] = useState('urunler');
  const [editor, setEditor] = useState<{ product: PanelProduct | null; categoryId?: string | null } | null>(null);
  const [groupEditor, setGroupEditor] = useState<{ id: string | null } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [lastBatch, setLastBatch] = useState<{ id: string; count: number; at: Date } | null>(null);
  const [reverting, setReverting] = useState(false);

  const revert = async () => {
    if (!lastBatch) return;
    setReverting(true);
    try {
      const res = await menuApi.revertBulkPrice(lastBatch.id);
      toast.success(`${res.restoredCount} ürünün fiyatı eski haline döndü.`);
      setLastBatch(null);
      await invalidate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReverting(false);
    }
  };

  const editingGroup = groupEditor?.id ? (menu.optionGroups.find((g) => g.id === groupEditor.id) ?? null) : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <PageHeader
        title="Menü"
        description={
          menu.canEdit
            ? 'Değişiklikler anında online menüye yansır. Fiyatlar KDV dahildir.'
            : 'Buradan yalnız “Bugün tükendi” durumunu değiştirebilirsiniz.'
        }
        actions={
          menu.canEdit ? (
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
              <Button size="lg" onClick={() => setEditor({ product: null })} disabled={menu.categories.length === 0}>
                <Plus aria-hidden />
                Ürün ekle
              </Button>
              <Button variant="secondary" size="lg" onClick={() => setBulkOpen(true)} disabled={menu.products.length === 0}>
                <Percent aria-hidden />
                Toplu fiyat
              </Button>
              <a href={EXPORT_CSV_URL} download className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
                <Download aria-hidden />
                Dışa aktar
              </a>
              <Button variant="secondary" size="lg" onClick={() => setImportOpen(true)}>
                <Upload aria-hidden />
                İçe aktar
              </Button>
            </div>
          ) : null
        }
      />

      {lastBatch ? (
        <Alert
          variant="success"
          title={`Toplu fiyat uygulandı · ${lastBatch.count} ürün · ${formatTime(lastBatch.at)}`}
          action={
            <Button variant="secondary" onClick={() => void revert()} loading={reverting}>
              <RotateCcw aria-hidden />
              Son toplu değişikliği geri al
            </Button>
          }
          className="mb-4"
        >
          24 saat içinde tek dokunuşla geri alabilirsiniz.
        </Alert>
      ) : null}

      {menu.canEdit ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList label="Menü bölümleri">
            <TabsTrigger value="urunler">Ürünler ({menu.products.length})</TabsTrigger>
            <TabsTrigger value="kategoriler">Kategoriler ({menu.categories.length})</TabsTrigger>
            <TabsTrigger value="gruplar">Seçenek grupları ({menu.optionGroups.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="urunler">
            <ProductsPanel menu={menu} onEdit={(p) => setEditor({ product: p })} onAdd={(categoryId) => setEditor({ product: null, categoryId })} />
          </TabsContent>
          <TabsContent value="kategoriler">
            <CategoriesPanel menu={menu} />
          </TabsContent>
          <TabsContent value="gruplar">
            <GroupsPanel menu={menu} onEdit={(id) => setGroupEditor({ id })} />
          </TabsContent>
        </Tabs>
      ) : (
        <ProductsPanel menu={menu} />
      )}

      {menu.canEdit ? (
        <>
          <ProductEditor
            open={editor !== null}
            onOpenChange={(o) => {
              if (!o) setEditor(null);
            }}
            menu={menu}
            product={editor?.product ?? null}
            defaultCategoryId={editor?.categoryId ?? null}
          />
          <OptionGroupEditor
            open={groupEditor !== null}
            onOpenChange={(o) => {
              if (!o) setGroupEditor(null);
            }}
            group={editingGroup}
          />
          <BulkPriceDialog
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            menu={menu}
            onApplied={(id, count) => {
              setLastBatch({ id, count, at: new Date() });
              toast.success(`${count} ürünün fiyatı güncellendi.`);
            }}
          />
          <CsvImportDialog open={importOpen} onOpenChange={setImportOpen} />
        </>
      ) : null}
    </div>
  );
}

// --- Ürünler ---------------------------------------------------------------------------------------

function ProductsPanel({ menu, onEdit, onAdd }: { menu: PanelMenuResponse; onEdit?: (p: PanelProduct) => void; onAdd?: (categoryId: string) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [onlySoldOut, setOnlySoldOut] = useState(false);
  const invalidate = useInvalidateMenu();
  const soldOut = menu.products.filter((p) => p.soldOut);
  const key = searchKey(q);

  const sections = useMemo(() => {
    return menu.categories
      .filter((c) => cat === 'all' || c.id === cat)
      .map((c) => ({
        category: c,
        products: menu.products.filter(
          (p) => p.categoryId === c.id && (!key || searchKey(`${p.name} ${p.description ?? ''}`).includes(key)) && (!onlySoldOut || p.soldOut),
        ),
      }))
      .filter((s) => s.products.length > 0 || (cat !== 'all' && !key && !onlySoldOut));
  }, [menu, cat, key, onlySoldOut]);

  const canReorder = Boolean(menu.canEdit && cat !== 'all' && !key && !onlySoldOut);

  const reorder = async (categoryId: string, ids: string[]) => {
    try {
      await menuApi.reorder({ products: { categoryId, ids } });
      await invalidate();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {soldOut.length ? (
        <section aria-labelledby="tukenenler" className="rounded-lg border-2 border-warning/60 bg-warning-bg p-3">
          <h2 id="tukenenler" className="mb-2 flex items-center gap-2 text-base font-bold text-fg">
            <Ban aria-hidden className="size-5 text-warning" />
            Şu an tükenenler ({soldOut.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {soldOut.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words font-semibold">
                  {p.name}
                  <span className="ms-2 text-sm font-normal text-fg-muted">
                    {p.soldOutUntil ? `yeniden satışta: ${formatNextOpenTR(new Date(p.soldOutUntil))}` : 'bir sonraki açılışa kadar'}
                  </span>
                </span>
                <SoldOutSwitch product={p} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
          <input
            type="search"
            aria-label="Ürün ara"
            placeholder="Ürün ara…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="min-h-hit w-full rounded-md border border-border-strong bg-surface-raised ps-10 pe-3 text-base text-fg placeholder:text-fg-muted/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>
        <div className="min-w-0 basis-56">
          <Select
            aria-label="Kategori filtresi"
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            options={[{ value: 'all', label: 'Tüm kategoriler' }, ...menu.categories.map((c) => ({ value: c.id, label: `${c.name} (${c.productCount})` }))]}
          />
        </div>
        <Checkbox label="Yalnız tükenenler" checked={onlySoldOut} onChange={(e) => setOnlySoldOut(e.target.checked)} />
      </div>
      {menu.canEdit && cat === 'all' && !key ? (
        <p className="text-sm text-fg-muted">Sıralamak için bir kategori seçin; satırlarda yukarı/aşağı düğmeleri çıkar.</p>
      ) : null}

      {menu.categories.length === 0 ? (
        <EmptyState icon={Layers} title="Menü boş" description={menu.canEdit ? 'Önce “Kategoriler” sekmesinden bir kategori ekleyin.' : 'İşletme henüz menü eklemedi.'} />
      ) : sections.length === 0 ? (
        <EmptyState icon={Search} title="Sonuç yok" description="Aramayı ya da filtreyi değiştirin." />
      ) : (
        sections.map(({ category, products }) => (
          <section key={category.id} aria-labelledby={`pc-${category.id}`} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`pc-${category.id}`} className="text-lg font-bold">
                {category.name}
                {!category.isActive ? (
                  <Badge variant="neutral" size="sm" className="ms-2 align-middle">
                    Kategori kapalı
                  </Badge>
                ) : null}
              </h2>
              {menu.canEdit && onAdd ? (
                <Button variant="ghost" size="sm" onClick={() => onAdd(category.id)}>
                  <Plus aria-hidden />
                  Bu kategoriye ürün
                </Button>
              ) : null}
            </div>
            {products.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">Bu kategoride ürün yok.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {products.map((p, i) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    menu={menu}
                    onEdit={onEdit}
                    reorder={
                      canReorder
                        ? {
                            up: () => void reorder(category.id, moveItem(products, i, -1).map((x) => x.id)),
                            down: () => void reorder(category.id, moveItem(products, i, 1).map((x) => x.id)),
                            first: i === 0,
                            last: i === products.length - 1,
                          }
                        : null
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}

/** Tükendi anahtarı — iyimser güncelleme, hata olursa geri alınır. */
function SoldOutSwitch({ product }: { product: PanelProduct }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateMenu();
  const [pending, setPending] = useState(false);
  const toggle = async () => {
    const next = !product.soldOut;
    setPending(true);
    qc.setQueryData<PanelMenuResponse>(MENU_QUERY_KEY, (d) =>
      d ? { ...d, products: d.products.map((x) => (x.id === product.id ? { ...x, soldOut: next } : x)) } : d,
    );
    try {
      await menuApi.setSoldOut(product.id, next);
      toast.success(next ? `${product.name}: bugün tükendi` : `${product.name} yeniden satışta`, { duration: 2500 });
    } catch (err) {
      toast.error(errorMessage(err, 'Değiştirilemedi. Tekrar deneyin.'));
    } finally {
      setPending(false);
      void invalidate();
    }
  };
  return <SoldOutToggle soldOut={product.soldOut} onToggle={() => void toggle()} pending={pending} productName={product.name} />;
}

function ProductRow({
  product: p,
  menu,
  onEdit,
  reorder,
}: {
  product: PanelProduct;
  menu: PanelMenuResponse;
  onEdit?: (p: PanelProduct) => void;
  reorder: { up: () => void; down: () => void; first: boolean; last: boolean } | null;
}) {
  const invalidate = useInvalidateMenu();
  const [busy, setBusy] = useState(false);
  const patch = async (body: Parameters<typeof menuApi.updateProduct>[1], ok: string) => {
    setBusy(true);
    try {
      await menuApi.updateProduct(p.id, body);
      toast.success(ok, { duration: 2500 });
      await invalidate();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={cn('flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-raised p-3', !p.isActive && 'bg-surface')}>
      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface">
        {p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <ImageOff aria-hidden className="size-5 text-fg-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1 basis-40">
        <p className={cn('break-words text-base font-semibold', !p.isActive && 'text-fg-muted')}>{p.name}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {!p.isActive ? (
            <Badge variant="neutral" size="sm">
              Kapalı
            </Badge>
          ) : null}
          {p.waRestricted ? (
            <Badge variant="danger" size="sm">
              <Ban aria-hidden />
              WhatsApp&apos;ta satılamaz
            </Badge>
          ) : null}
          {p.optionGroupIds.length ? (
            <Badge variant="outline" size="sm">
              {p.optionGroupIds.length} seçenek grubu
            </Badge>
          ) : null}
        </div>
      </div>
      {menu.showPrices && p.priceKurus !== undefined ? (
        <InlinePrice product={p} editable={menu.canEdit} disabled={busy} onSave={(k) => patch({ priceKurus: k }, 'Fiyat güncellendi.')} />
      ) : null}
      <SoldOutSwitch product={p} />
      {menu.canEdit ? (
        <>
          <ActiveToggle
            active={p.isActive}
            label={`${p.name} aktif`}
            disabled={busy}
            onToggle={() => void patch({ isActive: !p.isActive }, p.isActive ? 'Ürün menüden kaldırıldı (kapalı).' : 'Ürün yeniden menüde.')}
          />
          <Button variant="secondary" size="icon" aria-label={`${p.name} düzenle`} onClick={() => onEdit?.(p)}>
            <Pencil aria-hidden />
          </Button>
        </>
      ) : null}
      {reorder ? <MoveButtons label={p.name} onUp={reorder.up} onDown={reorder.down} disabledUp={reorder.first} disabledDown={reorder.last} /> : null}
    </li>
  );
}

/** Satır içi fiyat: dokun → sayısal klavye → Enter/odak kaybı kaydeder, Esc vazgeçer (04 §6.1). */
function InlinePrice({ product, editable, disabled, onSave }: { product: PanelProduct; editable: boolean; disabled?: boolean; onSave: (kurus: number) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const price = product.priceKurus ?? 0;
  if (!editable) return <span className="min-w-24 text-end text-base font-bold tabular-nums">{formatMoney(price)}</span>;
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(kurusToInput(price));
          setEditing(true);
        }}
        disabled={disabled}
        aria-label={`${product.name} fiyatı ${formatMoney(price)}, değiştir`}
        className="inline-flex min-h-hit min-w-28 items-center justify-end rounded-md border border-dashed border-border-strong px-3 text-base font-bold tabular-nums hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {formatMoney(price)}
      </button>
    );
  }
  const commit = async () => {
    const k = inputToKurus(value);
    if (k === null || k < 0) {
      toast.error('Fiyatı TL olarak yazın (ör. 125,50).');
      return;
    }
    if (k === price) return setEditing(false);
    if (await onSave(k)) setEditing(false);
  };
  return (
    <form
      className="w-36"
      onSubmit={(e) => {
        e.preventDefault();
        void commit();
      }}
    >
      <MoneyInput
        aria-label={`${product.name} yeni fiyat`}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
        }}
        enterKeyHint="done"
      />
    </form>
  );
}

// --- Seçenek grupları ------------------------------------------------------------------------------

function GroupsPanel({ menu, onEdit }: { menu: PanelMenuResponse; onEdit: (id: string | null) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button size="lg" onClick={() => onEdit(null)}>
          <Plus aria-hidden />
          Yeni seçenek grubu
        </Button>
      </div>
      {menu.optionGroups.length === 0 ? (
        <EmptyState icon={Layers} title="Henüz seçenek grubu yok" description="Porsiyon, Ekstralar, Acı gibi grupları bir kez tanımlayıp ürünlere bağlayın." />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {menu.optionGroups.map((g) => (
            <li key={g.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-base font-bold">{g.name}</p>
                  {g.internalName ? <p className="text-sm text-fg-muted">{g.internalName}</p> : null}
                  <p className="text-sm font-semibold text-fg">{groupRule(g.minSelect, g.maxSelect)}</p>
                </div>
                <Button variant="secondary" size="icon" aria-label={`${g.name} grubunu düzenle`} onClick={() => onEdit(g.id)}>
                  <Pencil aria-hidden />
                </Button>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {g.options.map((o) => (
                  <li key={o.id}>
                    <Badge variant={o.isActive ? 'outline' : 'neutral'} size="sm" className={cn(!o.isActive && 'line-through')}>
                      {o.name}
                      {o.priceDeltaKurus ? ` ${o.priceDeltaKurus > 0 ? '+' : '−'}${formatMoney(Math.abs(o.priceDeltaKurus))}` : ''}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-fg-muted">{g.productCount ? `${g.productCount} üründe kullanılıyor` : 'Henüz bir ürüne bağlı değil'}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
