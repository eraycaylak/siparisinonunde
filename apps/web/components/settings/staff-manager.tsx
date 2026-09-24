'use client';

import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Link2, Plus, Power, Trash2, UserPlus, UsersRound } from 'lucide-react';
import type { TenantRole } from '@siparis/core';
import { STAFF_ASSIGNABLE_ROLES, type StaffCreate, type StaffDto } from '@siparis/core/settings/contracts';
import { CourierLinkDialog } from '@/components/couriers/courier-link-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { apiFetch, errorMessage } from '@/lib/api';
import { currentRole, useMe } from '@/lib/auth';
import { formatPhone, formatRelative } from '@/lib/format';
import { TENANT_ROLE_LABELS } from '@/lib/labels';
import { SETTINGS_KEYS, useStaff } from './api';
import { Section, SettingsError, SettingsLoading, issuesOf } from './settings-shell';

const ROLE_HINTS: Record<TenantRole, string> = {
  owner: 'Her şey + abonelik ve WhatsApp bağlantısı',
  manager: 'Menü, ayarlar, raporlar, personel',
  cashier: 'Siparişler, sohbetler, müşteriler, telefon siparişi',
  kitchen: 'Yalnız sipariş ve hazırlık ekranı (fiyat görmez)',
  courier: 'Yalnız kendine atanan siparişler; giriş bağlantısıyla',
};

/** Personel (04 §7.11, P-23): liste, ekle, rol, parola sıfırla, devre dışı, kaldır; kurye giriş bağlantısı. */
export function StaffManager() {
  const q = useStaff();
  const me = useMe();
  const actorRole = currentRole(me.data);
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<StaffDto | null>(null);
  const [removeFor, setRemoveFor] = useState<StaffDto | null>(null);
  const [linkFor, setLinkFor] = useState<StaffDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: SETTINGS_KEYS.staff });

  async function patch(s: StaffDto, body: Record<string, unknown>, ok: string) {
    setBusy(s.userId);
    try {
      await apiFetch(`/panel/staff/${s.userId}`, { method: 'PATCH', body });
      await refresh();
      await qc.invalidateQueries({ queryKey: SETTINGS_KEYS.couriers });
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err, 'Güncellenemedi.'));
    } finally {
      setBusy(null);
    }
  }

  async function remove(s: StaffDto) {
    setBusy(s.userId);
    try {
      await apiFetch(`/panel/staff/${s.userId}`, { method: 'DELETE' });
      await refresh();
      toast.success(`${s.name} personel listesinden çıkarıldı.`);
    } catch (err) {
      toast.error(errorMessage(err, 'Kaldırılamadı.'));
    } finally {
      setBusy(null);
      setRemoveFor(null);
    }
  }

  if (q.isPending) return <SettingsLoading />;
  if (q.isError) return <SettingsError error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data.items;
  const canTouch = (s: StaffDto) => !s.isSelf && (s.role !== 'owner' || actorRole === 'owner');
  const roleOptions = (s: StaffDto) =>
    [...(actorRole === 'owner' ? (['owner'] as TenantRole[]) : []), ...STAFF_ASSIGNABLE_ROLES].map((r) => ({ value: r, label: TENANT_ROLE_LABELS[r] })).concat(
      s.role === 'owner' && actorRole !== 'owner' ? [{ value: 'owner', label: TENANT_ROLE_LABELS.owner }] : [],
    );

  return (
    <div className="flex flex-col gap-4">
      <Section title="Kullanıcılar" description="Her personel kendi hesabıyla girer. Kuryeler parola yerine tek kullanımlık bağlantıyla girer.">
        {items.length === 0 ? (
          <EmptyState icon={UsersRound} title="Personel yok" />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((s) => (
              <li key={s.userId} className="flex flex-col gap-3 py-3 md:flex-row md:items-center">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-fg">
                    {s.name}
                    {s.isSelf ? <Badge variant="info" size="sm">Siz</Badge> : null}
                    {s.disabled ? <Badge variant="neutral" size="sm">Devre dışı</Badge> : null}
                  </span>
                  <span className="truncate text-sm text-fg-muted">{[s.email, s.phone ? formatPhone(s.phone) : null].filter(Boolean).join(' · ')}</span>
                  <span className="text-sm text-fg-muted">{s.lastLoginAt ? `Son giriş ${formatRelative(s.lastLoginAt)}` : 'Henüz giriş yapmadı'}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canTouch(s) ? (
                    <Select
                      aria-label={`${s.name} rolü`}
                      value={s.role}
                      options={roleOptions(s)}
                      disabled={busy === s.userId}
                      onChange={(e) => void patch(s, { role: e.target.value }, 'Rol güncellendi.')}
                      className="w-40"
                    />
                  ) : (
                    <Badge variant="outline">{TENANT_ROLE_LABELS[s.role]}</Badge>
                  )}
                  {s.role === 'courier' && !s.disabled ? (
                    <Button variant="secondary" onClick={() => setLinkFor(s)}>
                      <Link2 aria-hidden />
                      Giriş bağlantısı
                    </Button>
                  ) : null}
                  {canTouch(s) && s.role !== 'courier' && !s.sharedAccount ? (
                    <Button variant="ghost" onClick={() => setResetFor(s)}>
                      <KeyRound aria-hidden />
                      Parola
                    </Button>
                  ) : null}
                  {canTouch(s) ? (
                    <Button
                      variant="ghost"
                      loading={busy === s.userId}
                      onClick={() => void patch(s, { disabled: !s.disabled }, s.disabled ? 'Etkinleştirildi.' : 'Devre dışı bırakıldı; açık oturumları kapandı.')}
                    >
                      <Power aria-hidden />
                      {s.disabled ? 'Etkinleştir' : 'Devre dışı'}
                    </Button>
                  ) : null}
                  {canTouch(s) ? (
                    <Button variant="ghost" className="text-destructive" onClick={() => setRemoveFor(s)} aria-label={`${s.name} kaldır`}>
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button onClick={() => setAdding(true)}>
            <UserPlus aria-hidden />
            Personel ekle
          </Button>
        </div>
      </Section>

      <Section title="Roller ne yapabilir?">
        <dl className="grid gap-2 sm:grid-cols-2">
          {(['owner', 'manager', 'cashier', 'kitchen', 'courier'] as TenantRole[]).map((r) => (
            <div key={r} className="rounded-md bg-surface p-3">
              <dt className="font-semibold text-fg">{TENANT_ROLE_LABELS[r]}</dt>
              <dd className="text-sm text-fg-muted">{ROLE_HINTS[r]}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Sheet open={adding} onOpenChange={setAdding} title="Personel ekle" description="Kişi başka bir işletmede kayıtlıysa mevcut hesabına üyelik eklenir.">
        {adding ? (
          <AddStaffForm
            onDone={() => {
              setAdding(false);
              void refresh();
              void qc.invalidateQueries({ queryKey: SETTINGS_KEYS.couriers });
            }}
          />
        ) : null}
      </Sheet>

      <ResetPasswordDialog staff={resetFor} onClose={() => setResetFor(null)} onSave={async (pw) => { if (resetFor) await patch(resetFor, { password: pw }, 'Parola sıfırlandı; kişinin açık oturumları kapandı.'); }} />

      <ConfirmDialog
        open={removeFor !== null}
        onOpenChange={(o) => !o && setRemoveFor(null)}
        title="Personel kaldırılsın mı?"
        description={`${removeFor?.name ?? ''} bu işletmeye artık giriş yapamaz. Hesabı başka işletmelerde varsa etkilenmez.`}
        confirmLabel="Kaldır"
        onConfirm={() => removeFor && void remove(removeFor)}
        loading={busy === removeFor?.userId}
      />

      <CourierLinkDialog courier={linkFor} onOpenChange={(o) => !o && setLinkFor(null)} />
    </div>
  );
}

function AddStaffForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'cashier' as (typeof STAFF_ASSIGNABLE_ROLES)[number], password: '' });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const courier = form.role === 'courier';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (form.name.trim().length < 2) local.name = 'Ad soyad girin.';
    if (!form.email.trim() && !form.phone.trim()) local.email = 'E-posta ya da telefon girin.';
    if (!courier && form.password.length < 8) local.password = 'Parola en az 8 karakter olmalı.';
    setErrors(local);
    if (Object.keys(local).length) return;
    const body: StaffCreate = {
      name: form.name.trim(),
      role: form.role,
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.password ? { password: form.password } : {}),
    };
    setSaving(true);
    try {
      const res = await apiFetch<{ staff: StaffDto; existingUser: boolean }>('/panel/staff', { method: 'POST', body });
      toast.success(res.existingUser ? `${res.staff.name} mevcut hesabıyla eklendi.` : `${res.staff.name} eklendi.`);
      onDone();
    } catch (err) {
      setErrors(issuesOf(err));
      toast.error(errorMessage(err, 'Eklenemedi.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Ad soyad" required error={errors.name}>
        <Input value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" maxLength={80} />
      </Field>
      <Field label="Rol" required hint={ROLE_HINTS[form.role]}>
        <Select value={form.role} onChange={(e) => set('role', e.target.value as typeof form.role)} options={STAFF_ASSIGNABLE_ROLES.map((r) => ({ value: r, label: TENANT_ROLE_LABELS[r] }))} />
      </Field>
      <Field label="Cep telefonu" error={errors.phone} hint={courier ? 'Kurye için önerilir' : undefined}>
        <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" autoComplete="off" placeholder="0532 000 00 00" />
      </Field>
      <Field label="E-posta" error={errors.email}>
        <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" />
      </Field>
      <Field label={courier ? 'Parola (isteğe bağlı)' : 'Geçici parola'} required={!courier} error={errors.password} hint={courier ? 'Kuryeler giriş bağlantısıyla girer.' : 'En az 8 karakter; kişiye iletin.'}>
        <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
      </Field>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="submit" size="lg" loading={saving}>
          <Plus aria-hidden />
          Ekle
        </Button>
      </div>
    </form>
  );
}

function ResetPasswordDialog({ staff, onClose, onSave }: { staff: StaffDto | null; onClose: () => void; onSave: (pw: string) => Promise<void> | void }) {
  const [pw, setPw] = useState('');
  const [saving, setSaving] = useState(false);
  const invalid = pw.length > 0 && pw.length < 8;
  return (
    <Dialog
      open={staff !== null}
      onOpenChange={(o) => {
        if (!o) {
          setPw('');
          onClose();
        }
      }}
      title="Parolayı sıfırla"
      description={`${staff?.name ?? ''} için yeni geçici parola belirleyin. Açık oturumları kapanır.`}
      footer={
        <Button
          loading={saving}
          disabled={pw.length < 8}
          onClick={async () => {
            setSaving(true);
            await onSave(pw);
            setSaving(false);
            setPw('');
            onClose();
          }}
        >
          Parolayı kaydet
        </Button>
      }
    >
      <Field label="Yeni parola" error={invalid ? 'En az 8 karakter.' : undefined}>
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </Field>
    </Dialog>
  );
}
