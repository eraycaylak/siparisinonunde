'use client';

import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AdminNote, AdminNoteCreate, AdminNoteUpdate } from '@siparis/core/admin/contracts';
import { SUPPORT_TAG_GROUPS, SUPPORT_TAG_LABELS } from '@siparis/core/admin/support-tags';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, errorMessage, useApiQuery } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { QueryError, useAdminAccess } from './common';

function TagPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  return (
    <div className="flex flex-col gap-3">
      {SUPPORT_TAG_GROUPS.map((g) => (
        <fieldset key={g.key} className="flex flex-col gap-1.5">
          <legend className="text-sm font-semibold text-fg-muted">{g.label}</legend>
          <div className="flex flex-wrap gap-2">
            {g.tags.map((t) => {
              const on = value.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(t)}
                  className={cn(
                    'inline-flex min-h-hit items-center rounded-full border px-3 text-sm font-semibold',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    on ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-fg hover:bg-accent',
                  )}
                >
                  {SUPPORT_TAG_LABELS[t] ?? t}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function NoteEditor({
  initialBody = '',
  initialTags = [],
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialBody?: string;
  initialTags?: string[];
  submitLabel: string;
  onSubmit: (body: string, tags: string[]) => Promise<void>;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initialBody);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [showTags, setShowTags] = useState(initialTags.length > 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) {
      setError('Not boş olamaz.');
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      await onSubmit(body.trim(), tags);
      if (!onCancel) {
        setBody('');
        setTags([]);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <Field label="Not" required error={error}>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} />
      </Field>
      {tags.length ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Seçili etiketler">
          {tags.map((t) => (
            <Badge key={t} variant="info" size="sm">
              {SUPPORT_TAG_LABELS[t] ?? t}
            </Badge>
          ))}
        </div>
      ) : null}
      <Button variant="ghost" className="self-start" onClick={() => setShowTags((v) => !v)} aria-expanded={showTags}>
        {showTags ? 'Etiketleri gizle' : 'Etiket seç'}
      </Button>
      {showTags ? <TagPicker value={tags} onChange={setTags} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={saving}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Vazgeç
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** A-10 destek notları ve etiketleri. */
export function TenantNotes({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const me = useMe();
  const { can } = useAdminAccess();
  const key = ['admin', 'tenant', tenantId, 'notes'];
  const q = useApiQuery<{ items: AdminNote[] }>(key, `/admin/tenants/${tenantId}/notes`);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminNote | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: key });
    await qc.invalidateQueries({ queryKey: ['admin', 'tenant', tenantId], exact: true });
  };

  const create = async (body: string, tags: string[]) => {
    try {
      await apiFetch<AdminNote>(`/admin/tenants/${tenantId}/notes`, { method: 'POST', body: { body, tags } satisfies AdminNoteCreate });
      toast.success('Not eklendi.');
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, 'Not eklenemedi.'));
      throw err;
    }
  };

  const update = async (id: string, body: string, tags: string[]) => {
    try {
      await apiFetch<AdminNote>(`/admin/tenants/${tenantId}/notes/${id}`, { method: 'PATCH', body: { body, tags } satisfies AdminNoteUpdate });
      toast.success('Not güncellendi.');
      setEditing(null);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, 'Not güncellenemedi.'));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/admin/tenants/${tenantId}/notes/${deleting.id}`, { method: 'DELETE' });
      toast.success('Not silindi.');
      setDeleting(null);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, 'Not silinemedi.'));
    } finally {
      setDeleteBusy(false);
    }
  };

  const mine = (n: AdminNote) => n.authorUserId === me.data?.user.id || can('notes:manage_any');

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus aria-hidden className="size-5" />
            Not ekle
          </CardTitle>
        </CardHeader>
        <CardContent>
          <NoteEditor submitLabel="Notu kaydet" onSubmit={create} />
        </CardContent>
      </Card>
      <div className="flex flex-col gap-3">
        {q.isError ? <QueryError error={q.error} onRetry={() => void q.refetch()} /> : null}
        {q.isPending ? <Spinner label="Notlar yükleniyor" /> : null}
        {q.data && q.data.items.length === 0 ? <EmptyState title="Henüz not yok" description="Her destek temasını etiketleriyle buraya yazın." /> : null}
        {q.data?.items.map((n) => (
          <Card key={n.id}>
            <CardContent className="flex flex-col gap-2 pt-4">
              {editing === n.id ? (
                <NoteEditor
                  initialBody={n.body}
                  initialTags={n.tags}
                  submitLabel="Güncelle"
                  onSubmit={(body, tags) => update(n.id, body, tags)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-base text-fg">{n.body}</p>
                  {n.tags.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {n.tags.map((t) => (
                        <Badge key={t} variant="neutral" size="sm">
                          {SUPPORT_TAG_LABELS[t] ?? t}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-fg-muted">
                      {n.authorName ?? 'Bilinmeyen'} · {formatDateTime(n.createdAt)}
                    </span>
                    {mine(n) ? (
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => setEditing(n.id)}>
                          <Pencil aria-hidden />
                          Düzenle
                        </Button>
                        <Button variant="ghost" onClick={() => setDeleting(n)}>
                          <Trash2 aria-hidden />
                          Sil
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Not silinsin mi?"
        description="Not kalıcı olarak silinir; silme işlemi denetim kaydına yazılır."
        confirmLabel="Sil"
        variant="danger"
        loading={deleteBusy}
        onConfirm={remove}
      />
    </div>
  );
}
