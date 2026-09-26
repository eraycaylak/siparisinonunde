'use client';

// A-04 WhatsApp sekmesi: ortak numara (00 §12a madde 8) dükkan kodu ve WhatsApp modu. Kod tekildir (409 wa_code_taken);
// biçim, komut sözcüğü ve sipariş koduna benzerlik core kurallarıyla (waCodeProblem) istemcide de denetlenir. Değişiklik
// gerekçesiyle denetim kaydına yazılır (PATCH /admin/tenants/:id { reason, waCode?, waMode? }; izin tenants:whatsapp).

import { useEffect, useState, type FormEvent } from 'react';
import { Copy, ExternalLink, Save } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { WA_CODE_MAX, WA_CODE_PROBLEM_MESSAGES, normalizeWaCode, waCodeProblem } from '@siparis/core';
import type { AdminTenantDetail, AdminTenantPatch } from '@siparis/core/admin/contracts';
import { WA_MODE_LABELS, type WaMode } from '@siparis/core/enums';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, errorMessage, fieldErrorsOf, isApiError } from '@/lib/api';
import { InfoRow, useAdminAccess } from './common';

const MODE_OPTIONS: { value: WaMode; label: string; description: string }[] = [
  {
    value: 'shared',
    label: WA_MODE_LABELS.shared,
    description: 'Varsayılan. Müşteri platformun tek numarasına dükkan koduyla (#KOD) yazar; bot bu işletme adına yanıt verir.',
  },
  {
    value: 'own',
    label: WA_MODE_LABELS.own,
    description: 'İşletme kendi WhatsApp numarasını (360dialog ya da Meta Cloud API) panelden bağlar. Üst paket.',
  },
];

/** Kod alanı için Türkçe hata (boş = değişiklik yok). */
export function waCodeInputError(input: string): string | null {
  if (!input.trim()) return null;
  const code = normalizeWaCode(input);
  if (!code) return WA_CODE_PROBLEM_MESSAGES.format;
  const problem = waCodeProblem(code);
  return problem ? WA_CODE_PROBLEM_MESSAGES[problem] : null;
}

/** Sunucu hatasını alan hatasına çevirir (409 wa_code_taken, 400 invalid_wa_code). */
function codeErrorOf(err: unknown): string | null {
  if (!isApiError(err)) return null;
  if (err.code === 'wa_code_taken') return 'Bu dükkan kodu başka bir işletmede kullanılıyor. Başka bir kod seçin.';
  if (err.code === 'invalid_wa_code') return errorMessage(err, WA_CODE_PROBLEM_MESSAGES.format);
  return null;
}

export function TenantWhatsappCard({ detail }: { detail: AdminTenantDetail }) {
  const t = detail.tenant;
  const { can } = useAdminAccess();
  const qc = useQueryClient();
  const canEdit = can('tenants:whatsapp');
  const [code, setCode] = useState(t.waCode ?? '');
  const [mode, setMode] = useState<WaMode>(t.waMode);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCode(t.waCode ?? '');
    setMode(t.waMode);
  }, [t.waCode, t.waMode]);

  const normalized = normalizeWaCode(code);
  const codeError = waCodeInputError(code);
  const codeChanged = !!normalized && normalized !== t.waCode;
  const modeChanged = mode !== t.waMode;
  const dirty = codeChanged || modeChanged;

  const copyLink = async () => {
    if (!t.sharedWaLink) return;
    try {
      await navigator.clipboard.writeText(t.sharedWaLink);
      toast.success('Bağlantı kopyalandı.');
    } catch {
      toast.error('Kopyalanamadı.');
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!code.trim()) next.waCode = 'Dükkan kodu boş olamaz.';
    else if (codeError) next.waCode = codeError;
    if (reason.trim().length < 10) next.reason = 'Gerekçe en az 10 karakter olmalı.';
    setErrors(next);
    if (Object.keys(next).length || !dirty) return;
    setSaving(true);
    try {
      const body: AdminTenantPatch = { reason: reason.trim(), ...(codeChanged ? { waCode: normalized! } : {}), ...(modeChanged ? { waMode: mode } : {}) };
      const updated = await apiFetch<AdminTenantDetail>(`/admin/tenants/${t.id}`, { method: 'PATCH', body });
      qc.setQueryData(['admin', 'tenant', t.id], updated);
      void qc.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'whatsapp'] });
      setReason('');
      toast.success('WhatsApp ayarı kaydedildi ve denetim kaydına yazıldı.');
    } catch (err) {
      const codeErr = codeErrorOf(err);
      setErrors({ ...fieldErrorsOf(err), ...(codeErr ? { waCode: codeErr } : {}) });
      toast.error(codeErr ?? errorMessage(err, 'Kaydedilemedi.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>WhatsApp modu ve dükkan kodu</CardTitle>
          <Badge variant={t.waMode === 'shared' ? 'info' : 'outline'}>{WA_MODE_LABELS[t.waMode]}</Badge>
        </div>
        <CardDescription>
          Ortak numarada müşteri QR’ı okutunca ya da #KOD yazınca bu işletmeye bağlanır. Kod değişirse işletmenin basılı QR’ları ve paylaştığı bağlantılar
          çalışmaz.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="divide-y divide-border">
          <InfoRow label="Mod">{WA_MODE_LABELS[t.waMode]}</InfoRow>
          <InfoRow label="Dükkan kodu">{t.waCode ? <span className="font-mono font-semibold">#{t.waCode}</span> : null}</InfoRow>
          <InfoRow label="QR bağlantısı">
            {t.sharedWaLink ? (
              <span className="flex flex-col gap-2">
                <span className="break-all font-mono text-sm">{t.sharedWaLink}</span>
                <span className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
                    <Copy aria-hidden />
                    Kopyala
                  </Button>
                  <a href={t.sharedWaLink} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                    <ExternalLink aria-hidden />
                    Aç
                  </a>
                </span>
              </span>
            ) : t.waMode === 'shared' ? (
              'Ortak numara yapılandırılmadı'
            ) : (
              'Kendi numarasında QR, işletmenin numarasına açılır'
            )}
          </InfoRow>
        </dl>

        {canEdit ? (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4 border-t border-border pt-4">
            <Field
              label="Dükkan kodu"
              required
              error={errors.waCode ?? codeError ?? undefined}
              hint={
                codeChanged && !codeError
                  ? `Kaydedilecek kod: #${normalized}. Türkçe harfler ve küçük harf kendiliğinden çevrilir.`
                  : `3–${WA_CODE_MAX} karakter, harf (A–Z) ve rakam. Türkçe harfler kendiliğinden çevrilir (Ç→C, Ş→S).`
              }
            >
              <Input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  // Sunucu hatası (ör. 409 kod dolu) yeni yazımda kalkar; biçim hatası istemcide yeniden hesaplanır
                  setErrors(({ waCode: _drop, ...rest }) => rest);
                }}
                maxLength={20}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-mono uppercase"
              />
            </Field>
            <RadioGroup legend="WhatsApp modu" options={MODE_OPTIONS} value={mode} onValueChange={setMode} />
            {modeChanged && mode === 'own' ? (
              <Alert variant="warning">
                Ortak numara bağlantısı kapanır. İşletme sahibi kendi numarasını panelden bağlayana kadar WhatsApp’tan sipariş gelmez; web siparişleri SMS
                koduyla doğrulanır (SMS yedeği açıksa). Müşteri #KOD yazarsa işletmenin kendi numarası bildirilir.
              </Alert>
            ) : null}
            {modeChanged && mode === 'shared' ? (
              <Alert variant="warning">
                Kendi numara bağlantısı kaldırılır (API anahtarı silinir); işletme ortak numaraya geçer. Sohbet ve sipariş geçmişi korunur. Kendi numarasına
                basılmış QR’lar artık bota ulaşmaz.
              </Alert>
            ) : null}
            {codeChanged && !codeError && t.waCode ? (
              <Alert variant="info">Eski kod (#{t.waCode}) hemen geçersiz olur; işletmeye yeni QR’ı basmasını hatırlatın.</Alert>
            ) : null}
            <Field label="Gerekçe" required error={errors.reason} hint="En az 10 karakter. Denetim kaydında görünür.">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" loading={saving} disabled={!dirty}>
                <Save aria-hidden />
                Kaydet
              </Button>
              {dirty ? (
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setCode(t.waCode ?? '');
                    setMode(t.waMode);
                    setErrors({});
                  }}
                >
                  Geri al
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          <p className="text-sm text-fg-muted">Dükkan kodunu ve modu yalnız platform sahibi ya da platform yöneticisi değiştirebilir.</p>
        )}
      </CardContent>
    </Card>
  );
}
