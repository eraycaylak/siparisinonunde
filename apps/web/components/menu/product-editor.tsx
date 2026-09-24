'use client';

import { useMemo, useRef, useState } from 'react';
import { ImagePlus, Trash2, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { MENU_LIMITS, suggestRestricted, type PanelMenuResponse, type PanelProduct } from '@siparis/core/menu/contracts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage, fieldErrorsOf } from '@/lib/api';
import { cn } from '@/lib/cn';
import { MoneyInput, MoveButtons, inputToKurus, kurusToInput, moveItem } from './controls';
import { checkImageFile, menuApi, useInvalidateMenu } from './menu-api';
import { groupRule } from './option-group-editor';

export interface ProductEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menu: PanelMenuResponse;
  /** null: yeni ürün. */
  product: PanelProduct | null;
  /** Yeni ürün için varsayılan kategori. */
  defaultCategoryId?: string | null;
}

/** P-10 ürün formu (04 §6.2). */
export function ProductEditor(props: ProductEditorProps) {
  const { open, onOpenChange, product } = props;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={product ? 'Ürünü düzenle' : 'Yeni ürün'} side="right" size="lg">
      {open ? <ProductForm key={product?.id ?? 'new'} {...props} /> : null}
    </Sheet>
  );
}

function ProductForm({ onOpenChange, menu, product, defaultCategoryId }: ProductEditorProps) {
  const invalidate = useInvalidateMenu();
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [price, setPrice] = useState(kurusToInput(product?.priceKurus ?? null));
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? defaultCategoryId ?? menu.categories[0]?.id ?? '');
  const [imageUrl, setImageUrl] = useState<string | null>(product?.imageUrl ?? null);
  const [groupIds, setGroupIds] = useState<string[]>(product?.optionGroupIds ?? []);
  const [waRestricted, setWaRestricted] = useState(product?.waRestricted ?? false);
  const [restrictionReason, setRestrictionReason] = useState('');
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const groupsById = useMemo(() => new Map(menu.optionGroups.map((g) => [g.id, g])), [menu.optionGroups]);
  const suggest = !waRestricted && suggestRestricted(name, description);
  const removingRestriction = Boolean(product?.waRestricted) && !waRestricted;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = checkImageFile(file);
    if (problem) {
      setErrors((e) => ({ ...e, imageUrl: problem }));
      return;
    }
    setUploading(true);
    setErrors(({ imageUrl: _drop, ...rest }) => rest);
    try {
      const res = await menuApi.upload(file);
      setImageUrl(res.url);
    } catch (err) {
      setErrors((e) => ({ ...e, imageUrl: errorMessage(err, 'Görsel yüklenemedi. Tekrar deneyin.') }));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Ürün adını yazın.';
    else if (name.trim().length > MENU_LIMITS.productName) e.name = `En çok ${MENU_LIMITS.productName} karakter.`;
    if (description.length > MENU_LIMITS.description) e.description = `En çok ${MENU_LIMITS.description} karakter.`;
    const k = inputToKurus(price);
    if (k === null) e.priceKurus = 'Fiyatı TL olarak yazın. Örnek: 125,50';
    else if (k < 0) e.priceKurus = 'Fiyat negatif olamaz.';
    else if (k > MENU_LIMITS.maxPriceKurus) e.priceKurus = 'Fiyat çok yüksek.';
    if (!categoryId) e.categoryId = 'Bir kategori seçin.';
    return e;
  };

  const save = async () => {
    const local = validate();
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    const body = {
      categoryId,
      name: name.trim(),
      description: description.trim() || null,
      priceKurus: inputToKurus(price)!,
      imageUrl,
      isActive,
      waRestricted,
      optionGroupIds: groupIds,
    };
    try {
      if (product) {
        await menuApi.updateProduct(product.id, {
          ...body,
          ...(removingRestriction && restrictionReason.trim() ? { waRestrictedReason: restrictionReason.trim() } : {}),
        });
        toast.success('Ürün kaydedildi.');
      } else {
        await menuApi.createProduct(body);
        toast.success('Ürün eklendi.');
      }
      await invalidate();
      onOpenChange(false);
    } catch (err) {
      const fe = fieldErrorsOf(err);
      setErrors(fe);
      toast.error(errorMessage(err, 'Ürün kaydedilemedi.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!product) return;
    setDeleting(true);
    try {
      await menuApi.deleteProduct(product.id);
      toast.success('Ürün silindi.');
      await invalidate();
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, 'Ürün silinemedi.'));
    } finally {
      setDeleting(false);
    }
  };

  const available = menu.optionGroups.filter((g) => !groupIds.includes(g.id));

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      <Field label="Ürün adı" required error={errors.name} hint={`${name.length}/${MENU_LIMITS.productName}`}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={MENU_LIMITS.productName} autoComplete="off" />
      </Field>
      <Field label="Açıklama" error={errors.description} hint={`${description.length}/${MENU_LIMITS.description}`}>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={MENU_LIMITS.description} rows={3} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fiyat (KDV dahil)" required error={errors.priceKurus} hint="Örnek: 125,50">
          <MoneyInput value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Kategori" required error={errors.categoryId}>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} options={menu.categories.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-fg">Görsel</span>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex size-24 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="Ürün görseli önizlemesi" className="size-full object-cover" />
            ) : (
              <ImagePlus aria-hidden className="size-8 text-fg-muted" />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              id="urun-gorsel"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
              <ImagePlus aria-hidden />
              {imageUrl ? 'Görseli değiştir' : 'Görsel yükle'}
            </Button>
            {imageUrl ? (
              <Button variant="ghost" onClick={() => setImageUrl(null)}>
                <X aria-hidden />
                Görseli kaldır
              </Button>
            ) : null}
          </div>
        </div>
        <p className="text-sm text-fg-muted">JPEG, PNG ya da WebP · en fazla 5 MB · kare (1:1) önerilir.</p>
        {errors.imageUrl ? <p className="text-sm font-semibold text-destructive">{errors.imageUrl}</p> : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-fg">Seçenek grupları</legend>
        {groupIds.length ? (
          <ol className="flex flex-col gap-2">
            {groupIds.map((id, i) => {
              const g = groupsById.get(id);
              if (!g) return null;
              return (
                <li key={id} className="flex items-center gap-2 rounded-md border border-border bg-surface-raised p-2">
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold">{g.name}</span>
                    <span className="block text-sm text-fg-muted">{groupRule(g.minSelect, g.maxSelect)}</span>
                  </span>
                  <MoveButtons
                    label={g.name}
                    onUp={() => setGroupIds((l) => moveItem(l, i, -1))}
                    onDown={() => setGroupIds((l) => moveItem(l, i, 1))}
                    disabledUp={i === 0}
                    disabledDown={i === groupIds.length - 1}
                  />
                  <Button variant="ghost" size="icon" aria-label={`${g.name} grubunu kaldır`} onClick={() => setGroupIds((l) => l.filter((x) => x !== id))}>
                    <X aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-fg-muted">Bu ürüne bağlı seçenek grubu yok.</p>
        )}
        {available.length ? (
          <Select
            aria-label="Seçenek grubu ekle"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v) setGroupIds((l) => [...l, v]);
            }}
            placeholder="Grup ekle…"
            options={available.map((g) => ({ value: g.id, label: `${g.name} · ${groupRule(g.minSelect, g.maxSelect)}` }))}
          />
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <Checkbox
          checked={waRestricted}
          onChange={(e) => setWaRestricted(e.target.checked)}
          label="WhatsApp ve web'de satılamaz (alkol/tütün)"
          description="İşaretli ürün storefront'ta ve WhatsApp'ta gösterilmez, sepete eklenemez."
        />
        {suggest ? (
          <Alert variant="warning" title="Bu ürün WhatsApp'ta satılamaz olabilir">
            Adında ya da açıklamasında alkol, tütün, tüp veya ilaç geçiyor. Meta kuralları gereği bu ürünleri işaretleyin.
          </Alert>
        ) : null}
        {removingRestriction ? (
          <Field label="Kaldırma sebebi" hint="Denetim kaydına yazılır.">
            <Input value={restrictionReason} onChange={(e) => setRestrictionReason(e.target.value)} maxLength={200} />
          </Field>
        ) : null}
      </div>

      {product?.waRestricted && !removingRestriction ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <TriangleAlert aria-hidden className="size-4" /> Bu ürün şu an storefront&apos;ta gösterilmiyor.
        </p>
      ) : null}

      <Switch checked={isActive} onCheckedChange={setIsActive} label="Satışta (aktif)" description="Kapalı ürün menüde görünmez." />

      <div className={cn('sticky -bottom-4 -mx-4 -mb-4 flex flex-wrap gap-3 border-t border-border bg-surface-raised p-4')}>
        <Button type="submit" size="lg" loading={saving} className="min-w-40 flex-1">
          Kaydet
        </Button>
        <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
          Vazgeç
        </Button>
        {product ? (
          <Button variant="ghost" size="lg" onClick={() => setConfirmDelete(true)} className="text-destructive">
            <Trash2 aria-hidden />
            Sil
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Ürün silinsin mi?"
        description={`"${product?.name ?? ''}" menüden kaldırılacak. Geçmiş siparişler etkilenmez.`}
        confirmLabel="Sil"
        onConfirm={() => void remove()}
        loading={deleting}
      />
    </form>
  );
}
