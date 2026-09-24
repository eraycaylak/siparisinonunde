'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { BranchPatch, BranchSettings } from '@siparis/core/settings/contracts';
import { errorMessage } from '@/lib/api';
import { useBranchId, useBranchSettings, useUpdateBranch } from './api';
import { issuesOf } from './settings-shell';

/**
 * Şube ayar formları için ortak durum: sunucudan seç → yerel düzenle → fark varsa PATCH /panel/branches/:id.
 */
export function useBranchForm<T>(select: (b: BranchSettings) => T, toPatch: (value: T, b: BranchSettings) => BranchPatch, successText: string) {
  const branchId = useBranchId();
  const q = useBranchSettings(branchId);
  const update = useUpdateBranch(branchId);
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    if (q.data && value === null) setValue(select(q.data));
    // select kararlı kabul edilir (bileşen düzeyinde tanımlı saf fonksiyon)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, value]);

  const patch = useMemo<BranchPatch>(() => (value !== null && q.data ? toPatch(value, q.data) : {}), [value, q.data, toPatch]);
  const dirty = Object.keys(patch).length > 0;

  async function save(onSaved?: () => void) {
    if (!dirty) return;
    try {
      const saved = await update.mutateAsync(patch);
      setValue(select(saved));
      toast.success(successText);
      onSaved?.();
    } catch (err) {
      toast.error(errorMessage(err, 'Kaydedilemedi.'));
    }
  }

  return {
    branchId,
    query: q,
    value,
    setValue: (fn: (v: T) => T) => setValue((v) => (v === null ? v : fn(v))),
    reset: () => q.data && setValue(select(q.data)),
    dirty,
    saving: update.isPending,
    errors: issuesOf(update.error),
    save,
  };
}
