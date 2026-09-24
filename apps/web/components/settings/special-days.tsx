'use client';

import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarX2, Trash2 } from 'lucide-react';
import type { SpecialDayDto } from '@siparis/core/settings/contracts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { apiFetch, errorMessage } from '@/lib/api';
import { formatDate, toIstanbulDateKey } from '@/lib/format';
import { SETTINGS_KEYS, useBranchId, useBranchSettings } from './api';
import { Section, issuesOf } from './settings-shell';

/** Sabit tarihli resmi tatiller (öneri; işletme onaylar). Dini bayram tarihleri her yıl değişir, elle girilir. */
const HOLIDAYS = [
  { md: '01-01', name: 'Yılbaşı' },
  { md: '04-23', name: '23 Nisan' },
  { md: '05-01', name: '1 Mayıs' },
  { md: '05-19', name: '19 Mayıs' },
  { md: '07-15', name: '15 Temmuz' },
  { md: '08-30', name: '30 Ağustos' },
  { md: '10-29', name: '29 Ekim' },
];

function upcomingHolidays(today: string, taken: Set<string>) {
  const year = Number(today.slice(0, 4));
  const out: { date: string; name: string }[] = [];
  for (const y of [year, year + 1]) {
    for (const h of HOLIDAYS) {
      const date = `${y}-${h.md}`;
      if (date >= today && !taken.has(date)) out.push({ date, name: h.name });
    }
  }
  return out.slice(0, 4);
}

/** Özel günler ve tatiller (04 §7.3): kapalı ya da özel saat; tarih aralığı ("Tadilat: 1–5 Ekim"). */
export function SpecialDays() {
  const branchId = useBranchId();
  const q = useBranchSettings(branchId);
  const qc = useQueryClient();
  const today = toIstanbulDateKey(new Date());
  const [date, setDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [mode, setMode] = useState<'closed' | 'hours'>('closed');
  const [opensAt, setOpensAt] = useState('12:00');
  const [closesAt, setClosesAt] = useState('20:00');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<string | null>(null);

  const days: SpecialDayDto[] = q.data?.specialDays ?? [];
  const suggestions = upcomingHolidays(today, new Set(days.map((d) => d.date)));

  async function refresh() {
    await qc.invalidateQueries({ queryKey: SETTINGS_KEYS.branch(branchId) });
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!branchId) return;
    setErrors({});
    if (!date) {
      setErrors({ date: 'Tarih seçin.' });
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/panel/branches/${branchId}/special-days`, {
        method: 'POST',
        body: {
          date,
          ...(endDate && endDate !== date ? { endDate } : {}),
          isClosed: mode === 'closed',
          ...(mode === 'hours' ? { opensAt, closesAt } : {}),
          note: note.trim() || null,
        },
      });
      toast.success('Özel gün eklendi.');
      setDate('');
      setEndDate('');
      setNote('');
      await refresh();
    } catch (err) {
      setErrors(issuesOf(err));
      toast.error(errorMessage(err, 'Özel gün eklenemedi.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!branchId) return;
    setDeleting(id);
    try {
      await apiFetch(`/panel/branches/${branchId}/special-days/${id}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, 'Silinemedi.'));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Section title="Özel günler ve tatiller" description="Özel gün kaydı o günün haftalık saatlerini geçersiz kılar.">
      {days.length === 0 ? (
        <EmptyState icon={CalendarX2} title="Yaklaşan özel gün yok" description="Bayram, tatil ya da tadilat günlerini buradan ekleyin." />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {days.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold text-fg">{formatDate(`${d.date}T12:00:00+03:00`)}</span>
                <span className="text-sm text-fg-muted">
                  {d.isClosed ? 'Kapalı' : `${d.opensAt?.replace(':', '.')}–${d.closesAt?.replace(':', '.')}`}
                  {d.note ? ` · ${d.note}` : ''}
                </span>
              </div>
              <IconButton label={`${d.date} özel gününü sil`} icon={<Trash2 />} variant="ghost" onClick={() => void remove(d.id)} disabled={deleting === d.id} />
            </li>
          ))}
        </ul>
      )}

      {suggestions.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-muted">Öneriler:</span>
          {suggestions.map((s) => (
            <Button
              key={s.date}
              variant="secondary"
              size="sm"
              onClick={() => {
                setDate(s.date);
                setEndDate('');
                setMode('closed');
                setNote(s.name);
              }}
            >
              {s.name} ({s.date.slice(8, 10)}.{s.date.slice(5, 7)})
            </Button>
          ))}
        </div>
      ) : null}

      <form onSubmit={add} noValidate className="grid gap-3 rounded-md border border-dashed border-border-strong p-3 sm:grid-cols-2">
        <Field label="Başlangıç tarihi" required error={errors.date}>
          <Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Bitiş tarihi" hint="Tek gün için boş bırakın (en çok 60 gün)" error={errors.endDate}>
          <Input type="date" min={date || today} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <RadioGroup
          legend="O gün"
          variant="chips"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'closed', label: 'Kapalı' },
            { value: 'hours', label: 'Özel saat' },
          ]}
          className="sm:col-span-2"
        />
        {mode === 'hours' ? (
          <div className="flex flex-wrap items-end gap-3 sm:col-span-2">
            <Field label="Açılış" error={errors.opensAt}>
              <Input type="time" value={opensAt} onChange={(e) => setOpensAt(e.target.value.slice(0, 5))} className="w-32" />
            </Field>
            <Field label="Kapanış">
              <Input type="time" value={closesAt} onChange={(e) => setClosesAt(e.target.value.slice(0, 5))} className="w-32" />
            </Field>
          </div>
        ) : null}
        <Field label="Not" hint="Ör. Kurban Bayramı, Tadilat" className="sm:col-span-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={busy}>
            Özel gün ekle
          </Button>
        </div>
      </form>
    </Section>
  );
}
