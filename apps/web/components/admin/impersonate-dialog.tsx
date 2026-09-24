'use client';

import { useState, type FormEvent } from 'react';
import { Eye, ShieldAlert } from 'lucide-react';
import type { AdminImpersonateRequest, AdminImpersonateResponse } from '@siparis/core/admin/contracts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, errorMessage, fieldErrorsOf } from '@/lib/api';

/**
 * "Paneli salt-okunur aç" (05 A-09): gerekçe zorunlu → POST /admin/tenants/:id/impersonate.
 * API bu tarayıcının oturumunu 30 dk'lık salt-okunur destek oturumuna çevirir; panel aynı sekmede açılır,
 * paneldeki kırmızı banttaki "Oturumu bitir" yönetim oturumunu geri yükler.
 */
export function ImpersonateButton({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [ticketRef, setTicketRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 10) {
      setFieldError('Gerekçe en az 10 karakter olmalı.');
      return;
    }
    setFieldError(undefined);
    setLoading(true);
    try {
      const body: AdminImpersonateRequest = { reason: reason.trim(), ...(ticketRef.trim() ? { ticketRef: ticketRef.trim() } : {}) };
      const res = await apiFetch<AdminImpersonateResponse>(`/admin/tenants/${tenantId}/impersonate`, { method: 'POST', body });
      // Tam sayfa geçiş: oturum çerezi değişti, önbellekteki "me" geçersiz.
      window.location.assign(res.redirectTo || '/panel');
    } catch (err) {
      setFieldError(fieldErrorsOf(err).reason);
      setError(errorMessage(err, 'Destek erişimi başlatılamadı.'));
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        <Eye aria-hidden />
        Paneli salt-okunur aç
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => !loading && setOpen(v)}
        dismissible={!loading}
        title="Paneli salt-okunur aç"
        description={`${tenantName} paneli bu sekmede, sahibin gözüyle ve yalnız okuma yetkisiyle açılır.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>
              Vazgeç
            </Button>
            <Button type="submit" form="impersonate-form" variant="danger" loading={loading}>
              <ShieldAlert aria-hidden />
              Destek erişimini başlat
            </Button>
          </>
        }
      >
        <form id="impersonate-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Alert variant="warning">
            En fazla 30 dakika sürer ve uzatılamaz. İşletme sahibine bildirim gider, panelde kırmızı bant görünür ve erişim denetim
            kaydına yazılır. Değişiklik yapılamaz.
          </Alert>
          <Field label="Gerekçe" required error={fieldError} hint="En az 10 karakter. Ör. “Sipariş düşmüyor şikayeti, bildirim ayarları kontrolü”.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} autoFocus />
          </Field>
          <Field label="Destek kaydı no" hint="İsteğe bağlı">
            <Input value={ticketRef} onChange={(e) => setTicketRef(e.target.value)} maxLength={60} />
          </Field>
          {error ? <Alert variant="danger">{error}</Alert> : null}
        </form>
      </Dialog>
    </>
  );
}
