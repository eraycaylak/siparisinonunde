'use client';

import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bike, Link2, LogOut, Phone, Plus } from 'lucide-react';
import { PAYMENT_METHOD_LABELS } from '@siparis/core';
import type { CourierDto } from '@siparis/core/settings/contracts';
import { SETTINGS_KEYS } from '@/components/settings/api';
import { SettingsError, SettingsLoading } from '@/components/settings/settings-shell';
import { usePanelEvent } from '@/components/panel/stream-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Sheet } from '@/components/ui/sheet';
import { StatusBadge } from '@/components/ui/status-badge';
import { apiFetch, errorMessage, useApiQuery } from '@/lib/api';
import { currentRole, useMe } from '@/lib/auth';
import { formatMoney, formatPhone, formatRelative } from '@/lib/format';
import { CourierLinkDialog } from './courier-link-dialog';

/** Kuryeler (04 §7.11 P-24, §4.15): kurye personeli, giriş bağlantısı (QR + kopyala), aktif atamalar. */
export function CouriersView() {
  const me = useMe();
  const role = currentRole(me.data);
  const canManage = role === 'owner' || role === 'manager';
  const qc = useQueryClient();
  const q = useApiQuery<{ items: CourierDto[] }>(SETTINGS_KEYS.couriers, '/panel/couriers');
  const [linkFor, setLinkFor] = useState<CourierDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Atama/durum değişince listeyi tazele
  usePanelEvent(['order.updated', 'order.created'], () => void qc.invalidateQueries({ queryKey: SETTINGS_KEYS.couriers }));

  async function logout(c: CourierDto) {
    setBusy(c.userId);
    try {
      const res = await apiFetch<{ closedSessions: number }>(`/panel/couriers/${c.userId}/logout`, { method: 'POST' });
      toast.success(res.closedSessions ? `${c.name} oturumu kapatıldı.` : 'Açık oturum yoktu.');
      await qc.invalidateQueries({ queryKey: SETTINGS_KEYS.couriers });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageHeader
        title="Kuryeler"
        description="Kuryeler parola yerine tek kullanımlık giriş bağlantısıyla girer; oturum 12 saat sürer."
        actions={
          canManage ? (
            <Button onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Kurye ekle
            </Button>
          ) : undefined
        }
      />
      {q.isPending ? (
        <SettingsLoading rows={3} />
      ) : q.isError ? (
        <SettingsError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={Bike} title="Henüz kurye yok" description="Kurye ekleyin, sonra giriş bağlantısını telefonuna gönderin." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data.items.map((c) => (
            <li key={c.userId} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
              <div className="flex flex-wrap items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-2 text-lg font-bold text-fg">
                    {c.name}
                    {c.disabled ? (
                      <Badge variant="neutral" size="sm">
                        Pasif
                      </Badge>
                    ) : c.activeOrders.some((o) => o.status === 'on_the_way') ? (
                      <Badge variant="info" size="sm">
                        Yolda · {c.activeOrders.length} sipariş
                      </Badge>
                    ) : (
                      <Badge variant="success" size="sm">
                        Müsait
                      </Badge>
                    )}
                  </span>
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="inline-flex min-h-10 items-center gap-1.5 self-start text-sm text-fg underline underline-offset-4">
                      <Phone aria-hidden className="size-4" />
                      {formatPhone(c.phone)}
                    </a>
                  ) : null}
                  <span className="text-sm text-fg-muted">
                    Bugün {c.deliveredToday} teslimat · {c.activeSession ? 'Oturum açık' : c.lastLoginAt ? `Son giriş ${formatRelative(c.lastLoginAt)}` : 'Hiç giriş yapmadı'}
                  </span>
                </div>
              </div>
              {c.activeOrders.length ? (
                <ul className="flex flex-col gap-2">
                  {c.activeOrders.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 rounded-md bg-surface p-2 text-sm">
                      <span className="font-semibold text-fg">#{o.number}</span>
                      <StatusBadge status={o.status} size="sm" />
                      <span className="text-fg-muted">{o.neighborhood ?? ''}</span>
                      <span className="ms-auto tabular-nums text-fg">
                        {formatMoney(o.totalKurus)} · {PAYMENT_METHOD_LABELS[o.paymentMethod]}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-muted">Atanmış açık sipariş yok.</p>
              )}
              {canManage && !c.disabled ? (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setLinkFor(c)}>
                    <Link2 aria-hidden />
                    Giriş bağlantısı oluştur
                  </Button>
                  {c.activeSession ? (
                    <Button variant="ghost" onClick={() => void logout(c)} loading={busy === c.userId}>
                      <LogOut aria-hidden />
                      Oturumu kapat
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <CourierLinkDialog courier={linkFor} onOpenChange={(o) => !o && setLinkFor(null)} />
      <Sheet open={adding} onOpenChange={setAdding} title="Kurye ekle">
        {adding ? (
          <AddCourierForm
            onDone={(created) => {
              setAdding(false);
              void qc.invalidateQueries({ queryKey: SETTINGS_KEYS.couriers });
              void qc.invalidateQueries({ queryKey: SETTINGS_KEYS.staff });
              if (created) setLinkFor(created);
            }}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function AddCourierForm({ onDone }: { onDone: (created: CourierDto | null) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2 || phone.trim().length < 10) {
      setError('Ad soyad ve cep telefonu girin.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ staff: { userId: string; name: string } }>('/panel/staff', { method: 'POST', body: { name: name.trim(), phone: phone.trim(), role: 'courier' } });
      toast.success(`${res.staff.name} eklendi. Şimdi giriş bağlantısını gönderin.`);
      onDone({ userId: res.staff.userId, name: res.staff.name } as CourierDto);
    } catch (err) {
      setError(errorMessage(err, 'Eklenemedi.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Ad soyad" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </Field>
      <Field label="Cep telefonu" required>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="0532 000 00 00" />
      </Field>
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
      <Button type="submit" size="lg" loading={saving}>
        Kurye ekle
      </Button>
    </form>
  );
}
