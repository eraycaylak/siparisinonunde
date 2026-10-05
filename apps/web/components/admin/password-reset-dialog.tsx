'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, ShieldAlert } from 'lucide-react';
import type { AdminPasswordResetRequest, AdminPasswordResetResponse } from '@siparis/core/admin/support-access';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, errorMessage, fieldErrorsOf } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/** Gerekçe alt sınırı adminReasonSchema ile aynı (05 §A.1 #6). */
const REASON_MIN = 10;

export interface PasswordResetTarget {
  userId: string;
  name: string;
  roleLabel: string;
}

/**
 * "Parolayı sıfırla" (A-04 üyeler sekmesi; denetim H29).
 *
 * Parolasını unutan işletme sahibinin tek kurtarma yolu budur: self-servis sıfırlama akışı ve e-posta kanalı yok.
 * Yeni parola SUNUCUDA üretilir ve YALNIZ BU PENCEREDE bir kez görünür — yanıt dışında hiçbir yere yazılmaz
 * (log, denetim kaydı, e-posta). Pencere kapandıktan sonra parola bir daha gösterilemez; gerekiyorsa yeniden
 * sıfırlanır. Kullanıcının tüm oturumları kapanır.
 */
export function PasswordResetDialog({
  tenantId,
  target,
  onOpenChange,
}: {
  tenantId: string;
  target: PasswordResetTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdminPasswordResetResponse | null>(null);

  const close = (open: boolean) => {
    if (loading) return;
    if (!open) {
      setReason('');
      setFieldError(undefined);
      setError(null);
      setResult(null);
    }
    onOpenChange(open);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setError(null);
    if (reason.trim().length < REASON_MIN) {
      setFieldError(`Gerekçe en az ${REASON_MIN} karakter olmalı.`);
      return;
    }
    setFieldError(undefined);
    setLoading(true);
    try {
      const body: AdminPasswordResetRequest = { reason: reason.trim() };
      const res = await apiFetch<AdminPasswordResetResponse>(`/admin/tenants/${tenantId}/members/${target.userId}/reset-password`, {
        method: 'POST',
        body,
      });
      setResult(res);
    } catch (err) {
      setFieldError(fieldErrorsOf(err).reason);
      setError(errorMessage(err, 'Parola sıfırlanamadı.'));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.password);
      toast.success('Parola kopyalandı. Yalnız bu pencerede görünür.');
    } catch {
      toast.error('Kopyalanamadı; parolayı elle seçin.');
    }
  };

  return (
    <Dialog
      open={target !== null}
      onOpenChange={close}
      dismissible={!loading}
      title={result ? 'Yeni parola hazır' : `${target?.name ?? 'Kullanıcı'} parolasını sıfırla`}
      description={
        result
          ? 'Parolayı kullanıcıya okuyun. Bu pencere kapanınca bir daha gösterilemez.'
          : `${target?.roleLabel ?? 'Üye'} · Parolayı sistem üretir; siz bir parola yazmazsınız.`
      }
      footer={
        result ? (
          <>
            <Button onClick={() => void copy()}>
              <Copy aria-hidden />
              Parolayı kopyala
            </Button>
            <Button variant="secondary" onClick={() => close(false)}>
              Kapat
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => close(false)} disabled={loading}>
              Vazgeç
            </Button>
            <Button type="submit" form="password-reset-form" variant="danger" loading={loading}>
              <KeyRound aria-hidden />
              Parolayı sıfırla
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <p
            className="select-all break-all rounded-md border border-border bg-surface p-3 text-center font-mono text-xl font-bold tracking-wider text-fg"
            data-testid="reset-password-value"
          >
            {result.password}
          </p>
          <Alert variant="warning" title="Bu parola bir daha gösterilmez">
            Platform hiçbir yere kaydetmez: ne loga, ne denetim kaydına, ne e-postaya. Kullanıcı girdikten sonra kendi parolasını
            değiştirsin.
          </Alert>
          <ul className="flex flex-col gap-1 text-sm text-fg-muted">
            <li>{result.userName} adına sıfırlandı · {formatDateTime(result.at)}</li>
            <li>
              {result.sessionsEnded > 0
                ? `Açık ${result.sessionsEnded} oturum kapatıldı; eski parolayla hiçbir cihazda kalınamaz.`
                : 'Kullanıcının açık oturumu yoktu.'}
            </li>
            {result.otherTenantCount > 0 ? (
              <li className="font-semibold text-warning">
                Bu hesap {result.otherTenantCount} başka işletmede de üye: parola o işletmelerde de değişti.
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <form id="password-reset-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Alert variant="warning">
            Kullanıcının tüm cihazlardaki oturumları kapanır ve işletme sahiplerine panelde bir kayıt düşer. Sıfırlamayı yalnız
            kullanıcının kimliğini doğruladıktan sonra yapın.
          </Alert>
          <Field
            label="Gerekçe"
            required
            error={fieldError}
            hint={`En az ${REASON_MIN} karakter. Ör. “Sahip parolasını unuttu, telefonda kimliği doğrulandı, DST-128”.`}
          >
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} autoFocus />
          </Field>
          {error ? <Alert variant="danger">{error}</Alert> : null}
        </form>
      )}
    </Dialog>
  );
}

/** Üyeler sekmesindeki satır düğmesi. */
export function PasswordResetButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick} disabled={disabled}>
      <ShieldAlert aria-hidden />
      Parolayı sıfırla
    </Button>
  );
}
