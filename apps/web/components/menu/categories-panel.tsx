'use client';

import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { MENU_LIMITS, type PanelCategory, type PanelMenuResponse } from '@siparis/core/menu/contracts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { ActiveToggle, MoveButtons, moveItem } from './controls';
import { menuApi, useInvalidateMenu } from './menu-api';

/** Kategoriler: ekle, yeniden adlandır, aç/kapa, sırala, sil (04 §6.1). */
export function CategoriesPanel({ menu }: { menu: PanelMenuResponse }) {
  const invalidate = useInvalidateMenu();
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [toDelete, setToDelete] = useState<PanelCategory | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await invalidate();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    if (await run(() => menuApi.createCategory({ name }), 'Kategori eklendi.')) setNewName('');
    setAdding(false);
  };

  const move = (index: number, delta: -1 | 1) =>
    void run(() => menuApi.reorder({ categories: moveItem(menu.categories, index, delta).map((c) => c.id) }));

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input
          aria-label="Yeni kategori adı"
          placeholder="Yeni kategori adı (ör. Tatlılar)"
          value={newName}
          maxLength={MENU_LIMITS.categoryName}
          onChange={(e) => setNewName(e.target.value)}
          className="min-w-0 flex-1 basis-60"
        />
        <Button type="submit" size="lg" loading={adding} disabled={!newName.trim()}>
          <Plus aria-hidden />
          Kategori ekle
        </Button>
      </form>

      {menu.categories.length === 0 ? (
        <EmptyState title="Henüz kategori yok" description="Önce bir kategori ekleyin (ör. Pideler, İçecekler)." />
      ) : (
        <ul className="flex flex-col gap-2">
          {menu.categories.map((c, i) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised p-3">
              {editing?.id === c.id ? (
                <form
                  className="flex min-w-0 flex-1 basis-64 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = editing.name.trim();
                    if (!name) return;
                    void run(() => menuApi.updateCategory(c.id, { name }), 'Kategori adı güncellendi.').then((ok) => ok && setEditing(null));
                  }}
                >
                  <Input
                    aria-label="Kategori adı"
                    value={editing.name}
                    maxLength={MENU_LIMITS.categoryName}
                    autoFocus
                    onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                  <Button type="submit" size="icon" aria-label="Kaydet" loading={busy}>
                    <Check aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Vazgeç" onClick={() => setEditing(null)}>
                    <X aria-hidden />
                  </Button>
                </form>
              ) : (
                <div className="min-w-0 flex-1 basis-40">
                  <p className="break-words text-base font-semibold">{c.name}</p>
                  <p className="text-sm text-fg-muted">{c.productCount} ürün</p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <ActiveToggle
                  active={c.isActive}
                  label={`${c.name} kategorisi aktif`}
                  disabled={busy}
                  onToggle={() => void run(() => menuApi.updateCategory(c.id, { isActive: !c.isActive }))}
                />
                <MoveButtons
                  label={c.name}
                  onUp={() => move(i, -1)}
                  onDown={() => move(i, 1)}
                  disabledUp={i === 0 || busy}
                  disabledDown={i === menu.categories.length - 1 || busy}
                />
                <Button variant="ghost" size="icon" aria-label={`${c.name} adını değiştir`} onClick={() => setEditing({ id: c.id, name: c.name })}>
                  <Pencil aria-hidden />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`${c.name} kategorisini sil`} onClick={() => setToDelete(c)} className="text-destructive">
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => {
          if (!o) setToDelete(null);
        }}
        title="Kategori silinsin mi?"
        description={
          toDelete && toDelete.productCount > 0
            ? `"${toDelete.name}" kategorisinde ${toDelete.productCount} ürün var. Önce ürünleri başka kategoriye taşıyın ya da silin.`
            : `"${toDelete?.name ?? ''}" silinecek.`
        }
        confirmLabel="Sil"
        loading={busy}
        onConfirm={() => {
          if (!toDelete) return;
          void run(() => menuApi.deleteCategory(toDelete.id), 'Kategori silindi.').then(() => setToDelete(null));
        }}
      />
    </div>
  );
}
