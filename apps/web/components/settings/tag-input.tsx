'use client';

import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';

/** Etiket girişi (mahalle listesi): Enter, virgül ya da yapıştırma ile ekler; çipte x ile siler. */
export function TagInput({
  label,
  values,
  onChange,
  placeholder,
  hint,
  error,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
}) {
  const [draft, setDraft] = useState('');

  function addMany(raw: string) {
    const parts = raw
      .split(/[,\n;]+/)
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (!parts.length) return;
    const lower = new Set(values.map((v) => v.toLocaleLowerCase('tr-TR')));
    const next = [...values];
    for (const p of parts) {
      const key = p.toLocaleLowerCase('tr-TR');
      if (!lower.has(key)) {
        lower.add(key);
        next.push(p);
      }
    }
    onChange(next);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addMany(draft);
      setDraft('');
    } else if (e.key === 'Backspace' && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold text-fg">
        {label}
        <Input
          className="mt-1.5"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,\n;]/.test(v)) {
              addMany(v);
              setDraft('');
            } else setDraft(v);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim()) {
              addMany(draft);
              setDraft('');
            }
          }}
          aria-invalid={Boolean(error) || undefined}
        />
      </label>
      {values.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={`${label} listesi`}>
          {values.map((v) => (
            <li key={v} className="inline-flex min-h-10 items-center gap-1 rounded-full border border-border-strong bg-surface ps-3 text-sm font-semibold text-fg">
              {v}
              <button
                type="button"
                className="inline-flex size-10 items-center justify-center rounded-full hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`${v} kaldır`}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hint ? <p className="text-sm text-fg-muted">{hint}</p> : null}
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
