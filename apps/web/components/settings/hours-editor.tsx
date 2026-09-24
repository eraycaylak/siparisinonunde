'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Moon, Plus, Trash2 } from 'lucide-react';
import { weekdayNameTR } from '@siparis/core';
import type { BranchState, OpeningHourDto } from '@siparis/core/settings/contracts';
import { MAX_INTERVALS_PER_DAY, crossesMidnight, validateWeeklyHours, type HoursDay } from '@siparis/core/settings/validation';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Switch } from '@/components/ui/switch';
import { apiFetch, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SETTINGS_KEYS, useBranchId, useBranchSettings } from './api';
import { SaveBar, Section, SettingsError, SettingsLoading, issuesOf } from './settings-shell';

/** Pazartesi'den başlayan gösterim sırası. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];

type Week = Record<number, { opensAt: string; closesAt: string }[]>;

function toWeek(hours: OpeningHourDto[]): Week {
  const w: Week = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const h of hours) w[h.weekday]!.push({ opensAt: h.opensAt, closesAt: h.closesAt });
  for (const k of Object.keys(w)) w[Number(k)]!.sort((a, b) => a.opensAt.localeCompare(b.opensAt));
  return w;
}

function toDays(w: Week): HoursDay[] {
  return ORDER.map((weekday) => ({ weekday, intervals: w[weekday] ?? [] }));
}

const TEMPLATES: { label: string; build: () => Week }[] = [
  { label: 'Her gün 11.00–23.00', build: () => Object.fromEntries(ORDER.map((d) => [d, [{ opensAt: '11:00', closesAt: '23:00' }]])) as Week },
  {
    label: 'Hafta içi 10.00–22.00, hafta sonu 11.00–24.00',
    build: () =>
      Object.fromEntries(ORDER.map((d) => [d, d === 0 || d === 6 ? [{ opensAt: '11:00', closesAt: '00:00' }] : [{ opensAt: '10:00', closesAt: '22:00' }]])) as Week,
  },
  {
    label: 'Öğle + akşam (11–15, 17–23)',
    build: () => Object.fromEntries(ORDER.map((d) => [d, [{ opensAt: '11:00', closesAt: '15:00' }, { opensAt: '17:00', closesAt: '23:00' }]])) as Week,
  },
];

/** Haftalık saat düzenleyici (04 §7.3): gün başına birden çok aralık, gece yarısını aşan kapanış, tüm günlere kopyala. */
export function HoursEditor({ onSaved }: { onSaved?: () => void }) {
  const branchId = useBranchId();
  const q = useBranchSettings(branchId);
  const qc = useQueryClient();
  const [week, setWeek] = useState<Week | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (q.data && !week) setWeek(toWeek(q.data.hours));
  }, [q.data, week]);

  const original = useMemo(() => (q.data ? JSON.stringify(toDays(toWeek(q.data.hours))) : ''), [q.data]);
  const days = week ? toDays(week) : [];
  const dirty = week ? JSON.stringify(days) !== original : false;
  const issues = useMemo(() => validateWeeklyHours(days), [days]);
  const issueByDay = new Map<number, string>();
  for (const i of issues) {
    const idx = Number(i.path.split('.')[1]);
    const wd = days[idx]?.weekday;
    if (wd !== undefined && !issueByDay.has(wd)) issueByDay.set(wd, i.message);
  }

  if (!branchId) return <SettingsError error={new Error('Şube bulunamadı')} />;
  if (q.isPending) return <SettingsLoading rows={7} />;
  if (q.isError) return <SettingsError error={q.error} onRetry={() => void q.refetch()} />;
  if (!week) return <SettingsLoading rows={7} />;

  const update = (wd: number, fn: (list: { opensAt: string; closesAt: string }[]) => { opensAt: string; closesAt: string }[]) =>
    setWeek((w) => (w ? { ...w, [wd]: fn([...(w[wd] ?? [])]) } : w));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || issues.length) return;
    setSaving(true);
    setServerErrors({});
    try {
      await apiFetch<{ hours: OpeningHourDto[]; state: BranchState }>(`/panel/branches/${branchId}/hours`, { method: 'PUT', body: { days } });
      await qc.invalidateQueries({ queryKey: SETTINGS_KEYS.branch(branchId) });
      await qc.invalidateQueries({ queryKey: SETTINGS_KEYS.onboarding });
      setWeek(null);
      toast.success('Çalışma saatleri kaydedildi.');
      onSaved?.();
    } catch (err) {
      setServerErrors(issuesOf(err));
      toast.error(errorMessage(err, 'Saatler kaydedilemedi.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4">
      <Section title="Haftalık saatler" description="Kapanış açılıştan önceyse ertesi güne sarkar (ör. 18.00–02.00). Kapalı günlerde sipariş alınmaz.">
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <Button key={t.label} variant="secondary" size="sm" onClick={() => setWeek(t.build())}>
              {t.label}
            </Button>
          ))}
        </div>
        <ul className="flex flex-col divide-y divide-border">
          {ORDER.map((wd) => {
            const list = week[wd] ?? [];
            const open = list.length > 0;
            const err = issueByDay.get(wd);
            return (
              <li key={wd} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-28 text-base font-semibold text-fg">{weekdayNameTR(wd)}</span>
                  <Switch
                    checked={open}
                    onCheckedChange={(v) => update(wd, () => (v ? [{ opensAt: '11:00', closesAt: '23:00' }] : []))}
                    label={<span className="sr-only">{weekdayNameTR(wd)} açık</span>}
                    className="py-0"
                  />
                  {open ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ms-auto"
                      onClick={() => setWeek((w) => (w ? (Object.fromEntries(ORDER.map((d) => [d, list.map((x) => ({ ...x }))])) as Week) : w))}
                    >
                      <Copy aria-hidden />
                      Tüm günlere kopyala
                    </Button>
                  ) : (
                    <span className="text-sm text-fg-muted">Kapalı</span>
                  )}
                </div>
                {list.map((iv, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 ps-0 sm:ps-28">
                    <TimeInput label={`${weekdayNameTR(wd)} açılış ${i + 1}`} value={iv.opensAt} onChange={(v) => update(wd, (l) => l.map((x, j) => (j === i ? { ...x, opensAt: v } : x)))} />
                    <span aria-hidden className="text-fg-muted">–</span>
                    <TimeInput label={`${weekdayNameTR(wd)} kapanış ${i + 1}`} value={iv.closesAt} onChange={(v) => update(wd, (l) => l.map((x, j) => (j === i ? { ...x, closesAt: v } : x)))} />
                    {crossesMidnight(iv.opensAt, iv.closesAt) || (iv.closesAt === '00:00' && iv.opensAt !== '00:00') ? (
                      <span className="inline-flex items-center gap-1 text-sm text-fg-muted">
                        <Moon aria-hidden className="size-4" />
                        ertesi gün
                      </span>
                    ) : null}
                    {iv.opensAt === iv.closesAt ? <span className="text-sm text-fg-muted">24 saat</span> : null}
                    <IconButton label="Aralığı sil" icon={<Trash2 />} variant="ghost" onClick={() => update(wd, (l) => l.filter((_, j) => j !== i))} />
                  </div>
                ))}
                {open && list.length < MAX_INTERVALS_PER_DAY ? (
                  <div className="sm:ps-28">
                    <Button variant="ghost" size="sm" onClick={() => update(wd, (l) => [...l, { opensAt: '17:00', closesAt: '23:00' }])}>
                      <Plus aria-hidden />
                      Aralık ekle
                    </Button>
                  </div>
                ) : null}
                {err ? <p className={cn('text-sm font-medium text-destructive sm:ps-28')}>{err}</p> : null}
              </li>
            );
          })}
        </ul>
        {Object.values(serverErrors)[0] ? <p className="text-sm font-medium text-destructive">{Object.values(serverErrors)[0]}</p> : null}
      </Section>
      <SaveBar dirty={dirty} saving={saving} onReset={() => setWeek(toWeek(q.data.hours))} />
    </form>
  );
}

function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      step={300}
      aria-label={label}
      value={value}
      onChange={(e) => e.target.value && onChange(e.target.value.slice(0, 5))}
      className="min-h-hit w-32 rounded-md border border-border-strong bg-surface-raised px-3 text-base text-fg focus-visible:outline-2 focus-visible:outline-ring"
    />
  );
}
