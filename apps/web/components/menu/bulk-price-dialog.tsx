'use client';

import { useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { BulkPriceResponse, BulkPriceRounding, PanelMenuResponse } from '@siparis/core/menu/contracts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney, searchKey } from '@/lib/format';
import { inputToKurus } from './controls';
import { menuApi, useInvalidateMenu } from './menu-api';

const ROUNDING_OPTIONS: { value: BulkPriceRounding; label: string }[] = [
  { value: 'none', label: 'Yuvarlama yok' },
  { value: '0.5', label: '0,50 TL' },
  { value: '1', label: '1 TL' },
  { value: '5', label: '5 TL' },
  { value: '10', label: '10 TL' },
];

type Scope = 'all' | 'categories' | 'products';

/** P-13 toplu fiyat güncelleme (04 §6.5): kapsam, % veya TL, artış/azalış, yuvarlama, önizleme tablosu, onay. */
export function BulkPriceDialog({
  open,
  onOpenChange,
  menu,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menu: PanelMenuResponse;
  onApplied: (batchId: string, count: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Toplu fiyat güncelle" size="lg">
      {open ? <BulkPriceForm menu={menu} onClose={() => onOpenChange(false)} onApplied={onApplied} /> : null}
    </Dialog>
  );
}

function BulkPriceForm({ menu, onClose, onApplied }: { menu: PanelMenuResponse; onClose: () => void; onApplied: (batchId: string, count: number) => void }) {
  const invalidate = useInvalidateMenu();
  const [scope, setScope] = useState<Scope>('all');
  const [catIds, setCatIds] = useState<string[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent');
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [amount, setAmount] = useState('');
  const [rounding, setRounding] = useState<BulkPriceRounding>('none');
  const [preview, setPreview] = useState<BulkPriceResponse | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [ackLarge, setAckLarge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedIds = useMemo(() => {
    if (scope === 'all') return menu.products.map((p) => p.id);
    if (scope === 'categories') return menu.products.filter((p) => catIds.includes(p.categoryId)).map((p) => p.id);
    return productIds;
  }, [scope, catIds, productIds, menu.products]);

  const reset = () => {
    setPreview(null);
    setAckLarge(false);
  };

  const input = (): { kind: 'percent' | 'fixed'; value: number } | null => {
    const raw = amount.trim().replace(',', '.');
    if (kind === 'percent') {
      const v = Number(raw);
      if (!raw || !Number.isFinite(v) || v <= 0) return null;
      return { kind, value: direction === 'up' ? v : -v };
    }
    const k = inputToKurus(amount);
    if (k === null || k <= 0) return null;
    return { kind, value: direction === 'up' ? k : -k };
  };

  const run = async (apply: boolean) => {
    setError(null);
    const v = input();
    if (!selectedIds.length) return setError('En az bir ürün seçin.');
    if (!v) return setError(kind === 'percent' ? 'Yüzdeyi yazın (ör. 10).' : 'Tutarı TL olarak yazın (ör. 15).');
    setBusy(true);
    try {
      const res = await menuApi.bulkPrice({ productIds: selectedIds, kind: v.kind, value: v.value, rounding, preview: !apply });
      if (apply) {
        await invalidate();
        if (res.batchId) onApplied(res.batchId, res.changedCount);
        else toast.info('Değişen fiyat yok.');
        onClose();
      } else {
        setPreview(res);
        setAckLarge(false);
      }
    } catch (err) {
      setError(errorMessage(err, 'Fiyatlar güncellenemedi.'));
    } finally {
      setBusy(false);
    }
  };

  const products = menu.products.filter((p) => !search || searchKey(p.name).includes(searchKey(search)));
  const items = preview ? preview.items.filter((i) => !onlyChanged || i.diffKurus !== 0 || i.invalid) : [];
  const large = preview?.warnings.includes('large_change') ?? false;
  const canApply = preview && preview.invalidCount === 0 && preview.changedCount > 0 && (!large || ackLarge);

  return (
    <div className="flex flex-col gap-5">
      <RadioGroup
        legend="Hangi ürünler?"
        variant="chips"
        value={scope}
        onValueChange={(v) => {
          setScope(v);
          reset();
        }}
        options={[
          { value: 'all', label: `Tüm menü (${menu.products.length})` },
          { value: 'categories', label: 'Kategoriler' },
          { value: 'products', label: 'Seçili ürünler' },
        ]}
      />
      {scope === 'categories' ? (
        <div className="grid gap-1 sm:grid-cols-2">
          {menu.categories.map((c) => (
            <Checkbox
              key={c.id}
              label={`${c.name} (${c.productCount})`}
              checked={catIds.includes(c.id)}
              onChange={(e) => {
                reset();
                setCatIds((l) => (e.target.checked ? [...l, c.id] : l.filter((x) => x !== c.id)));
              }}
            />
          ))}
        </div>
      ) : null}
      {scope === 'products' ? (
        <div className="flex flex-col gap-2">
          <Input placeholder="Ürün ara…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Ürün ara" />
          <div className="max-h-56 overflow-y-auto rounded-md border border-border px-2">
            {products.map((p) => (
              <Checkbox
                key={p.id}
                label={p.name}
                checked={productIds.includes(p.id)}
                onChange={(e) => {
                  reset();
                  setProductIds((l) => (e.target.checked ? [...l, p.id] : l.filter((x) => x !== p.id)));
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <RadioGroup
          legend="Değişim türü"
          variant="chips"
          value={kind}
          onValueChange={(v) => {
            setKind(v);
            reset();
          }}
          options={[
            { value: 'percent', label: 'Yüzde (%)' },
            { value: 'fixed', label: 'Tutar (TL)' },
          ]}
        />
        <RadioGroup
          legend="Yön"
          variant="chips"
          value={direction}
          onValueChange={(v) => {
            setDirection(v);
            reset();
          }}
          options={[
            { value: 'up', label: 'Artır' },
            { value: 'down', label: 'Azalt' },
          ]}
        />
        <Field label={kind === 'percent' ? 'Yüzde' : 'Tutar (TL)'} hint={kind === 'percent' ? 'Örnek: 12' : 'Örnek: 15'}>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              reset();
            }}
          />
        </Field>
        <Field label="Yuvarlama (en yakına)">
          <Select
            value={rounding}
            onChange={(e) => {
              setRounding(e.target.value as BulkPriceRounding);
              reset();
            }}
            options={ROUNDING_OPTIONS}
          />
        </Field>
      </div>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      {preview ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base font-semibold">
              {preview.changedCount} ürünün fiyatı değişecek
              {preview.invalidCount ? ` · ${preview.invalidCount} ürün 0 TL'nin altına düşüyor` : ''}
            </p>
            <Checkbox label="Yalnız değişenler" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
          </div>
          {preview.invalidCount ? (
            <Alert variant="danger" title="Negatif ya da sıfır fiyat olamaz">
              Kırmızı satırlardaki ürünleri seçimden çıkarın ya da değişimi küçültün.
            </Alert>
          ) : null}
          {large ? (
            <Alert variant="warning" title="%50'yi aşan değişim var">
              <Checkbox label="Büyük değişimi kontrol ettim, uygulamak istiyorum" checked={ackLarge} onChange={(e) => setAckLarge(e.target.checked)} />
            </Alert>
          ) : null}
          <Table>
            <THead>
              <TR>
                <TH>Ürün</TH>
                <TH className="text-end">Eski</TH>
                <TH className="text-end">Yeni</TH>
                <TH className="text-end">Fark</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((i) => (
                <TR key={i.productId} className={cn(i.invalid && 'bg-status-new-bg')}>
                  <TD>
                    <span className="font-semibold">{i.name}</span>
                    {i.categoryName ? <span className="block text-xs text-fg-muted">{i.categoryName}</span> : null}
                  </TD>
                  <TD className="text-end tabular-nums">{formatMoney(i.oldPriceKurus)}</TD>
                  <TD className={cn('text-end font-semibold tabular-nums', i.invalid && 'text-destructive')}>
                    {i.invalid ? <TriangleAlert aria-label="Geçersiz fiyat" className="me-1 inline size-4" /> : null}
                    {formatMoney(i.newPriceKurus)}
                  </TD>
                  <TD className="text-end tabular-nums text-fg-muted">
                    {i.diffKurus > 0 ? '+' : i.diffKurus < 0 ? '−' : ''}
                    {formatMoney(Math.abs(i.diffKurus))}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-4">
        <Button variant="secondary" size="lg" onClick={onClose}>
          Vazgeç
        </Button>
        <Button variant={preview ? 'secondary' : 'primary'} size="lg" loading={busy && !preview} onClick={() => void run(false)}>
          Önizle
        </Button>
        {preview ? (
          <Button size="lg" loading={busy} disabled={!canApply} onClick={() => void run(true)}>
            Uygula · {preview.changedCount} ürün
          </Button>
        ) : null}
      </div>
    </div>
  );
}
