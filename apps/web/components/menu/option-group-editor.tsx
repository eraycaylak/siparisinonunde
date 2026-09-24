'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { MENU_LIMITS, type PanelOptionGroup } from '@siparis/core/menu/contracts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { Sheet } from '@/components/ui/sheet';
import { errorMessage } from '@/lib/api';
import { MoneyInput, MoveButtons, inputToKurus, kurusToInput, moveItem } from './controls';
import { menuApi, useInvalidateMenu } from './menu-api';

/** Kural metni: "Zorunlu · 1 seçin", "İsteğe bağlı · en çok 5". */
export function groupRule(min: number, max: number | null): string {
  if (min > 0) return max !== null && max === min ? `Zorunlu · ${min} seçin` : max !== null ? `Zorunlu · ${min}–${max}` : `Zorunlu · en az ${min}`;
  return max !== null ? `İsteğe bağlı · en çok ${max}` : 'İsteğe bağlı';
}

/** Hazır şablonlar (04 §6.3; A05 §3.5). */
const TEMPLATES: { name: string; min: number; max: number | null; options: string[] }[] = [
  { name: 'Porsiyon', min: 1, max: 1, options: ['Tam', '1,5 porsiyon'] },
  { name: 'Ekmek', min: 1, max: 1, options: ['Lavaş', 'Tombik', 'Ekmek arası'] },
  { name: 'Ekstralar', min: 0, max: 5, options: ['Ekstra kaşar', 'Ekstra et'] },
  { name: 'Çıkarılacaklar', min: 0, max: 10, options: ['Soğansız', 'Domatessiz', 'Turşusuz'] },
  { name: 'Acı', min: 0, max: 1, options: ['Acısız', 'Az acılı', 'Acılı'] },
  { name: 'Menü içeceği', min: 1, max: 1, options: ['Ayran', 'Kola', 'Şalgam'] },
];

interface OptionDraft {
  key: string;
  id?: string;
  name: string;
  price: string;
  isActive: boolean;
}

let draftSeq = 0;
const newKey = () => `d${++draftSeq}`;

export interface OptionGroupEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null: yeni grup. */
  group: PanelOptionGroup | null;
}

/** P-11 seçenek grubu düzenleyici (04 §6.3): ad, tür, min/max, seçenekler + fiyat farkı. */
export function OptionGroupEditor({ open, onOpenChange, group }: OptionGroupEditorProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={group ? 'Seçenek grubunu düzenle' : 'Yeni seçenek grubu'} side="right" size="lg">
      {open ? <GroupForm key={group?.id ?? 'new'} group={group} onDone={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function GroupForm({ group, onDone }: { group: PanelOptionGroup | null; onDone: () => void }) {
  const invalidate = useInvalidateMenu();
  const [name, setName] = useState(group?.name ?? '');
  const [internalName, setInternalName] = useState(group?.internalName ?? '');
  const [kind, setKind] = useState<'single' | 'multi'>(group && group.maxSelect !== 1 ? 'multi' : 'single');
  const [required, setRequired] = useState<'yes' | 'no'>(group ? (group.minSelect > 0 ? 'yes' : 'no') : 'yes');
  const [minMulti, setMinMulti] = useState(String(group && group.maxSelect !== 1 ? group.minSelect : 1));
  const [maxMulti, setMaxMulti] = useState(group && group.maxSelect !== 1 && group.maxSelect !== null ? String(group.maxSelect) : '');
  const [opts, setOpts] = useState<OptionDraft[]>(
    group?.options.map((o) => ({ key: newKey(), id: o.id, name: o.name, price: kurusToInput(o.priceDeltaKurus ?? 0), isActive: o.isActive })) ?? [
      { key: newKey(), name: '', price: '0', isActive: true },
    ],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    setName(t.name);
    setKind(t.max === 1 ? 'single' : 'multi');
    setRequired(t.min > 0 ? 'yes' : 'no');
    setMinMulti(String(Math.max(1, t.min)));
    setMaxMulti(t.max && t.max !== 1 ? String(t.max) : '');
    setOpts(t.options.map((n) => ({ key: newKey(), name: n, price: '0', isActive: true })));
  };

  const limits = (): { minSelect: number; maxSelect: number | null } | string => {
    if (kind === 'single') return { minSelect: required === 'yes' ? 1 : 0, maxSelect: 1 };
    const max = maxMulti.trim() ? Number(maxMulti) : null;
    const min = required === 'yes' ? Number(minMulti || '1') : 0;
    if (!Number.isInteger(min) || min < 0 || min > 20) return 'En az seçim 0 ile 20 arasında olmalı.';
    if (max !== null && (!Number.isInteger(max) || max < 1 || max > MENU_LIMITS.maxOptionsPerGroup)) return 'En çok seçim 1 ile 50 arasında olmalı.';
    if (max !== null && min > max) return 'En az seçim, en çok seçimden büyük olamaz.';
    return { minSelect: min, maxSelect: max };
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError('Grup adını yazın.');
    const lim = limits();
    if (typeof lim === 'string') return setError(lim);
    const options = [];
    for (const o of opts) {
      if (!o.name.trim()) return setError('Her seçeneğin adını yazın ya da boş satırı silin.');
      const delta = o.price.trim() ? inputToKurus(o.price) : 0;
      if (delta === null) return setError(`"${o.name}" için fiyat farkını TL olarak yazın (ör. 25 ya da -10).`);
      options.push({ ...(o.id ? { id: o.id } : {}), name: o.name.trim(), priceDeltaKurus: delta, isActive: o.isActive });
    }
    const active = options.filter((o) => o.isActive).length;
    if (lim.minSelect > active) return setError(`Zorunlu grupta en az ${lim.minSelect} satışta seçenek olmalı.`);
    setSaving(true);
    try {
      const body = { name: name.trim(), internalName: internalName.trim() || null, ...lim, options };
      if (group) await menuApi.updateGroup(group.id, body);
      else await menuApi.createGroup(body);
      toast.success(group ? 'Seçenek grubu kaydedildi.' : 'Seçenek grubu eklendi.');
      await invalidate();
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'Grup kaydedilemedi.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!group) return;
    setDeleting(true);
    try {
      await menuApi.deleteGroup(group.id);
      toast.success('Seçenek grubu silindi.');
      await invalidate();
      setConfirmDelete(false);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Grup silinemedi.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {!group ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">Hazır şablon</span>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t) => (
              <Button key={t.name} variant="secondary" size="sm" onClick={() => applyTemplate(t)}>
                {t.name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {group && group.productCount > 0 ? (
        <Alert variant="info">Bu grup {group.productCount} üründe kullanılıyor; değişiklik hepsine yansır.</Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Grup adı (müşteri görür)" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={MENU_LIMITS.groupName} />
        </Field>
        <Field label="İç ad (isteğe bağlı)" hint="Panelde ayırt etmek için: “Porsiyon — kebap”">
          <Input value={internalName} onChange={(e) => setInternalName(e.target.value)} maxLength={80} />
        </Field>
      </div>
      <RadioGroup
        legend="Tür"
        variant="chips"
        value={kind}
        onValueChange={setKind}
        options={[
          { value: 'single', label: 'Tek seçim' },
          { value: 'multi', label: 'Çoklu seçim' },
        ]}
      />
      <RadioGroup
        legend="Zorunlu mu?"
        variant="chips"
        value={required}
        onValueChange={setRequired}
        options={[
          { value: 'yes', label: 'Zorunlu' },
          { value: 'no', label: 'İsteğe bağlı' },
        ]}
      />
      {kind === 'multi' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {required === 'yes' ? (
            <Field label="En az seçim">
              <Input inputMode="numeric" value={minMulti} onChange={(e) => setMinMulti(e.target.value.replace(/\D/g, ''))} />
            </Field>
          ) : null}
          <Field label="En çok seçim" hint="Boş bırakırsanız sınırsız.">
            <Input inputMode="numeric" value={maxMulti} onChange={(e) => setMaxMulti(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Seçenekler</legend>
        <ul className="flex flex-col gap-2">
          {opts.map((o, i) => (
            <li key={o.key} className="flex flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-center">
              <Input
                aria-label={`Seçenek ${i + 1} adı`}
                placeholder="Seçenek adı"
                value={o.name}
                maxLength={MENU_LIMITS.optionName}
                onChange={(e) => setOpts((l) => l.map((x) => (x.key === o.key ? { ...x, name: e.target.value } : x)))}
                className="sm:flex-1"
              />
              <div className="flex items-center gap-2">
                <div className="w-32">
                  <MoneyInput
                    aria-label={`${o.name || `Seçenek ${i + 1}`} fiyat farkı`}
                    value={o.price}
                    onChange={(e) => setOpts((l) => l.map((x) => (x.key === o.key ? { ...x, price: e.target.value } : x)))}
                  />
                </div>
                <label className="flex min-h-hit items-center gap-2 px-1 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--primary)]"
                    checked={o.isActive}
                    onChange={(e) => setOpts((l) => l.map((x) => (x.key === o.key ? { ...x, isActive: e.target.checked } : x)))}
                  />
                  Satışta
                </label>
                <MoveButtons
                  label={o.name || `Seçenek ${i + 1}`}
                  onUp={() => setOpts((l) => moveItem(l, i, -1))}
                  onDown={() => setOpts((l) => moveItem(l, i, 1))}
                  disabledUp={i === 0}
                  disabledDown={i === opts.length - 1}
                />
                <Button variant="ghost" size="icon" aria-label={`${o.name || `Seçenek ${i + 1}`} sil`} onClick={() => setOpts((l) => l.filter((x) => x.key !== o.key))}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <Button
          variant="secondary"
          className="self-start"
          disabled={opts.length >= MENU_LIMITS.maxOptionsPerGroup}
          onClick={() => setOpts((l) => [...l, { key: newKey(), name: '', price: '0', isActive: true }])}
        >
          <Plus aria-hidden />
          Seçenek ekle
        </Button>
        <p className="text-sm text-fg-muted">Fiyat farkı TL: ücretsiz seçenek için 0, indirim için eksi (ör. -40).</p>
      </fieldset>

      {error ? (
        <Alert variant="danger" title="Kaydedilemedi">
          {error}
        </Alert>
      ) : null}

      <div className="sticky -bottom-4 -mx-4 -mb-4 flex flex-wrap gap-3 border-t border-border bg-surface-raised p-4">
        <Button type="submit" size="lg" loading={saving} className="min-w-40 flex-1">
          Kaydet
        </Button>
        <Button variant="secondary" size="lg" onClick={onDone}>
          Vazgeç
        </Button>
        {group ? (
          <Button variant="ghost" size="lg" className="text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden />
            Sil
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Seçenek grubu silinsin mi?"
        description={
          group && group.productCount > 0
            ? `"${group.name}" ${group.productCount} üründen kaldırılacak.`
            : `"${group?.name ?? ''}" silinecek.`
        }
        confirmLabel="Sil"
        onConfirm={() => void remove()}
        loading={deleting}
      />
    </form>
  );
}
