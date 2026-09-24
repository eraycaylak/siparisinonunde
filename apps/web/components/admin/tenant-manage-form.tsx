'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AdminTenantDetail, AdminTenantPatch } from '@siparis/core/admin/contracts';
import { PLAN_CODES, type LifecycleStage, type PlanCode, type SubscriptionStatus, type SuspensionReason } from '@siparis/core/enums';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, errorMessage, fieldErrorsOf } from '@/lib/api';
import { toIstanbulDateKey } from '@/lib/format';
import { LIFECYCLE_STAGE_LABELS, PLAN_CODE_LABELS } from '@/lib/labels';
import { SUBSCRIPTION_STATUSES, SUBSCRIPTION_STATUS_LABELS, SUSPENSION_REASONS, SUSPENSION_REASON_LABELS } from './admin-labels';
import { useAdminAccess } from './common';

interface FormState {
  stage: LifecycleStage;
  suspensionReason: SuspensionReason | '';
  planCode: PlanCode;
  orderingEnabled: boolean;
  trialEnd: string; // YYYY-MM-DD (İstanbul)
  subStatus: SubscriptionStatus | '';
  founderPct: string;
}

function fromDetail(d: AdminTenantDetail): FormState {
  return {
    stage: d.tenant.lifecycleStage,
    suspensionReason: d.tenant.suspensionReason ?? '',
    planCode: d.tenant.planCode,
    orderingEnabled: d.tenant.orderingEnabled,
    trialEnd: d.tenant.trialEndsAt ? toIstanbulDateKey(d.tenant.trialEndsAt) : '',
    subStatus: d.subscription?.status ?? '',
    founderPct: d.subscription?.founderDiscountBp != null ? String(d.subscription.founderDiscountBp / 100) : '',
  };
}

/** A-04 yönetim aksiyonları (gerekçeli): aşama, askı sebebi, plan, sipariş alma, deneme bitişi, abonelik. */
export function TenantManageForm({ detail }: { detail: AdminTenantDetail }) {
  const { can } = useAdminAccess();
  const qc = useQueryClient();
  const initial = useMemo(() => fromDetail(detail), [detail]);
  const [s, setS] = useState<FormState>(initial);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => setS(initial), [initial]);

  const canStage = detail.allowedLifecycleTransitions.length > 0;
  const canSub = can('tenants:subscription');
  const canOrdering = can('tenants:ordering');
  const canTrial = can('tenants:extend_trial');
  if (!canStage && !canSub && !canOrdering && !canTrial) return null;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((prev) => ({ ...prev, [k]: v }));

  const buildPatch = (): Omit<AdminTenantPatch, 'reason'> => {
    const p: Omit<AdminTenantPatch, 'reason'> = {};
    if (s.stage !== initial.stage) p.lifecycleStage = s.stage;
    if (s.stage === 'suspended' && s.suspensionReason && s.suspensionReason !== initial.suspensionReason) {
      p.suspensionReason = s.suspensionReason;
    }
    if (s.planCode !== initial.planCode) p.planCode = s.planCode;
    if (s.orderingEnabled !== initial.orderingEnabled) p.orderingEnabled = s.orderingEnabled;
    if (s.trialEnd !== initial.trialEnd) p.trialEndsAt = s.trialEnd ? `${s.trialEnd}T23:59:00+03:00` : null;
    const sub: NonNullable<AdminTenantPatch['subscription']> = {};
    if (s.subStatus && s.subStatus !== initial.subStatus) sub.status = s.subStatus;
    if (s.founderPct !== initial.founderPct) {
      const pct = s.founderPct.trim() === '' ? null : Number(s.founderPct.replace(',', '.'));
      sub.founderDiscountBp = pct == null || Number.isNaN(pct) ? null : Math.round(pct * 100);
    }
    if (Object.keys(sub).length) p.subscription = sub;
    return p;
  };

  const patch = buildPatch();
  const dirty = Object.keys(patch).length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (reason.trim().length < 10) next.reason = 'Gerekçe en az 10 karakter olmalı.';
    if (s.stage === 'suspended' && !s.suspensionReason) next.suspensionReason = 'Askıya alma sebebini seçin.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const updated = await apiFetch<AdminTenantDetail>(`/admin/tenants/${detail.tenant.id}`, {
        method: 'PATCH',
        body: { reason: reason.trim(), ...patch } satisfies AdminTenantPatch,
      });
      qc.setQueryData(['admin', 'tenant', detail.tenant.id], updated);
      void qc.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      setReason('');
      toast.success('Değişiklik kaydedildi ve denetim kaydına yazıldı.');
    } catch (err) {
      setErrors(fieldErrorsOf(err));
      toast.error(errorMessage(err, 'Kaydedilemedi.'));
    } finally {
      setSaving(false);
    }
  };

  const stageOptions = [detail.tenant.lifecycleStage, ...detail.allowedLifecycleTransitions];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Yönetim</CardTitle>
        <CardDescription>Her değişiklik gerekçesiyle denetim kaydına yazılır. Yalnız rolünüzün izin verdiği alanlar görünür.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            {canStage ? (
              <Field label="Yaşam döngüsü aşaması" error={errors.lifecycleStage}>
                <Select
                  value={s.stage}
                  onChange={(e) => set('stage', e.target.value as LifecycleStage)}
                  options={stageOptions.map((st) => ({
                    value: st,
                    label: st === detail.tenant.lifecycleStage ? `${LIFECYCLE_STAGE_LABELS[st]} (şu an)` : LIFECYCLE_STAGE_LABELS[st],
                  }))}
                />
              </Field>
            ) : null}
            {s.stage === 'suspended' ? (
              <Field label="Askı sebebi" required error={errors.suspensionReason}>
                <Select
                  value={s.suspensionReason}
                  placeholder="Seçin"
                  onChange={(e) => set('suspensionReason', e.target.value as SuspensionReason)}
                  options={SUSPENSION_REASONS.map((r) => ({ value: r, label: SUSPENSION_REASON_LABELS[r] }))}
                />
              </Field>
            ) : null}
            {canSub ? (
              <Field label="Plan" error={errors.planCode}>
                <Select
                  value={s.planCode}
                  onChange={(e) => set('planCode', e.target.value as PlanCode)}
                  options={PLAN_CODES.map((c) => ({ value: c, label: PLAN_CODE_LABELS[c] }))}
                />
              </Field>
            ) : null}
            {canSub ? (
              <Field label="Abonelik durumu" hint="Aşama abonelik durumundan türetilir; kurulumdaki ve pilot işletme aşamasını korur.">
                <Select
                  value={s.subStatus}
                  placeholder="Abonelik yok"
                  onChange={(e) => set('subStatus', e.target.value as SubscriptionStatus)}
                  options={SUBSCRIPTION_STATUSES.map((st) => ({ value: st, label: SUBSCRIPTION_STATUS_LABELS[st] }))}
                />
              </Field>
            ) : null}
            {canSub ? (
              <Field label="Kurucu üye indirimi (%)" hint="Boş bırakırsanız indirim yok. Kurucu üye: %30.">
                <Input inputMode="decimal" value={s.founderPct} onChange={(e) => set('founderPct', e.target.value)} />
              </Field>
            ) : null}
            {canTrial ? (
              <Field label="Deneme bitişi" error={errors.trialEndsAt} hint={can('tenants:lifecycle') ? undefined : 'Satış ekibi: tek sefer, en fazla 14 gün uzatma.'}>
                <Input type="date" value={s.trialEnd} onChange={(e) => set('trialEnd', e.target.value)} />
              </Field>
            ) : null}
          </div>
          {canOrdering ? (
            <Switch
              checked={s.orderingEnabled}
              onCheckedChange={(v) => set('orderingEnabled', v)}
              label="Online sipariş alma (işletme bazında acil durdurma)"
              description="Kapalıyken storefront ve bot “şu an online sipariş alınmıyor, lütfen arayın” der. Aşama değişmez."
            />
          ) : null}
          <Field label="Gerekçe" required error={errors.reason} hint="En az 10 karakter. Denetim kaydında görünür.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
          </Field>
          {s.stage === 'suspended' && initial.stage !== 'suspended' ? (
            <Alert variant="warning">Askıdaki işletmede yeni online sipariş alınmaz; storefront ve bot “lütfen arayın” gösterir.</Alert>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={saving} disabled={!dirty}>
              <Save aria-hidden />
              Kaydet
            </Button>
            {dirty ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setS(initial);
                  setErrors({});
                }}
                disabled={saving}
              >
                Değişiklikleri geri al
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
