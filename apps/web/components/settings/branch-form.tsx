'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { BranchPatch, BranchSettings } from '@siparis/core/settings/contracts';
import { PREP_MINUTES_LIMITS } from '@siparis/core/settings/validation';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import { useBranchId, useBranchSettings, useUpdateBranch } from './api';
import { LocationPicker, type LatLng } from './map/location-picker';
import { SaveBar, Section, SettingsError, SettingsLoading, issuesOf } from './settings-shell';

interface FormState {
  name: string;
  phone: string;
  addressLine: string;
  neighborhood: string;
  district: string;
  city: string;
  location: LatLng | null;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  pickupMinTl: string;
  prep: string;
  usePreparingStep: boolean;
}

function fromBranch(b: BranchSettings): FormState {
  return {
    name: b.name,
    phone: b.phone ? b.phone.replace(/^\+90/, '0') : '',
    addressLine: b.addressLine ?? '',
    neighborhood: b.neighborhood ?? '',
    district: b.district,
    city: b.city,
    location: b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : null,
    acceptsDelivery: b.acceptsDelivery,
    acceptsPickup: b.acceptsPickup,
    pickupMinTl: String(b.pickupMinOrderKurus / 100).replace('.', ','),
    prep: String(b.defaultPrepMinutes),
    usePreparingStep: b.usePreparingStep,
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);
const tlToKurus = (s: string) => Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100);

function toPatch(f: FormState, b: BranchSettings): BranchPatch {
  const p: BranchPatch = {};
  if (f.name.trim() !== b.name) p.name = f.name.trim();
  const phone = orNull(f.phone);
  if (phone !== (b.phone ? b.phone.replace(/^\+90/, '0') : null)) p.phone = phone;
  if (orNull(f.addressLine) !== b.addressLine) p.addressLine = orNull(f.addressLine);
  if (orNull(f.neighborhood) !== b.neighborhood) p.neighborhood = orNull(f.neighborhood);
  if (f.district.trim() !== b.district) p.district = f.district.trim();
  if (f.city.trim() !== b.city) p.city = f.city.trim();
  if ((f.location?.lat ?? null) !== b.lat || (f.location?.lng ?? null) !== b.lng) {
    p.lat = f.location?.lat ?? null;
    p.lng = f.location?.lng ?? null;
  }
  if (f.acceptsDelivery !== b.acceptsDelivery) p.acceptsDelivery = f.acceptsDelivery;
  if (f.acceptsPickup !== b.acceptsPickup) p.acceptsPickup = f.acceptsPickup;
  const pickupMin = tlToKurus(f.pickupMinTl || '0');
  if (Number.isFinite(pickupMin) && pickupMin !== b.pickupMinOrderKurus) p.pickupMinOrderKurus = pickupMin;
  const prep = Number(f.prep);
  if (Number.isInteger(prep) && prep !== b.defaultPrepMinutes) p.defaultPrepMinutes = prep;
  if (f.usePreparingStep !== b.usePreparingStep) p.usePreparingStep = f.usePreparingStep;
  return p;
}

/** Şube bilgileri: adres, mahalle, harita pini, teslim türleri, hazırlık süresi (04 §7.2, §7.5, §7.7). */
export function BranchForm({ onSaved }: { onSaved?: () => void }) {
  const branchId = useBranchId();
  const q = useBranchSettings(branchId);
  const update = useUpdateBranch(branchId);
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (q.data && !form) setForm(fromBranch(q.data));
  }, [q.data, form]);

  const patch = useMemo(() => (form && q.data ? toPatch(form, q.data) : {}), [form, q.data]);
  const dirty = Object.keys(patch).length > 0;
  const errors = issuesOf(update.error);

  if (!branchId) return <SettingsError error={new Error('Şube bulunamadı')} />;
  if (q.isPending) return <SettingsLoading />;
  if (q.isError) return <SettingsError error={q.error} onRetry={() => void q.refetch()} />;
  if (!form) return <SettingsLoading />;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const prepNum = Number(form.prep);
  const prepInvalid = !Number.isInteger(prepNum) || prepNum < PREP_MINUTES_LIMITS.min || prepNum > PREP_MINUTES_LIMITS.max;
  const neither = !form.acceptsDelivery && !form.acceptsPickup;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || prepInvalid || neither) return;
    try {
      const saved = await update.mutateAsync(patch);
      setForm(fromBranch(saved));
      toast.success('Şube bilgileri kaydedildi.');
      onSaved?.();
    } catch (err) {
      toast.error(errorMessage(err, 'Kaydedilemedi.'));
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Section title="Adres ve konum" description="Kurye ve gel-al müşterileri için. Yarıçaplı teslimat bölgesi bu konumdan hesaplanır.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Şube adı" error={errors.name}>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={60} />
          </Field>
          <Field label="Şube telefonu" error={errors.phone}>
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" placeholder="0354 212 00 00" />
          </Field>
          <Field label="Açık adres" error={errors.addressLine} className="sm:col-span-2">
            <Textarea value={form.addressLine} onChange={(e) => set('addressLine', e.target.value)} rows={2} maxLength={300} placeholder="Cadde, sokak, bina no" />
          </Field>
          <Field label="Mahalle" error={errors.neighborhood}>
            <Input value={form.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} maxLength={60} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="İlçe" error={errors.district}>
              <Input value={form.district} onChange={(e) => set('district', e.target.value)} maxLength={60} />
            </Field>
            <Field label="İl" error={errors.city}>
              <Input value={form.city} onChange={(e) => set('city', e.target.value)} maxLength={60} />
            </Field>
          </div>
        </div>
        <LocationPicker value={form.location} onChange={(v) => set('location', v)} />
        {errors.lat ? <p className="text-sm text-destructive">{errors.lat}</p> : null}
      </Section>

      <Section title="Teslim türleri">
        <Switch checked={form.acceptsDelivery} onCheckedChange={(v) => set('acceptsDelivery', v)} label="Paket servis" description="Teslimat bölgelerinize adrese teslim" />
        <Switch checked={form.acceptsPickup} onCheckedChange={(v) => set('acceptsPickup', v)} label="Gel-al" description="Müşteri siparişi kendisi alır" />
        {form.acceptsPickup ? (
          <Field label="Gel-al en az sepet (TL)" hint="0 = sınır yok" className="max-w-xs">
            <Input value={form.pickupMinTl} onChange={(e) => set('pickupMinTl', e.target.value.replace(/[^\d,]/g, ''))} inputMode="decimal" />
          </Field>
        ) : null}
        {neither ? <p className="text-sm font-medium text-destructive">En az bir teslim türü açık olmalı.</p> : null}
      </Section>

      <Section title="Hazırlık" description="Onaylarken önerilen süre; müşteriye tahmini süre olarak gösterilir.">
        <Field
          label="Varsayılan hazırlık süresi (dk)"
          hint={`${PREP_MINUTES_LIMITS.min}–${PREP_MINUTES_LIMITS.max} dk`}
          error={prepInvalid ? `${PREP_MINUTES_LIMITS.min}–${PREP_MINUTES_LIMITS.max} arası bir sayı girin.` : errors.defaultPrepMinutes}
          className="max-w-xs"
        >
          <Input value={form.prep} onChange={(e) => set('prep', e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={3} />
        </Field>
        <Switch
          checked={form.usePreparingStep}
          onCheckedChange={(v) => set('usePreparingStep', v)}
          label='"Hazırlanıyor" adımını kullan'
          description="Açıksa siparişler Onaylandı → Hazırlanıyor → Hazır adımlarından geçer."
        />
      </Section>

      <SaveBar dirty={dirty} saving={update.isPending} onReset={() => setForm(fromBranch(q.data))} />
    </form>
  );
}
