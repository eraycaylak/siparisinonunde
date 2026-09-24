'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import type { TenantPatch, TenantSettings } from '@siparis/core/settings/contracts';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import { currentRole, useMe } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useTenantSettings, useUpdateTenant } from './api';
import { BrandColorPicker } from './brand-color-picker';
import { ImageField } from './image-field';
import { SaveBar, Section, SettingsError, SettingsLoading, issuesOf } from './settings-shell';
import { publicStorefrontUrl } from './urls';

interface FormState {
  name: string;
  phone: string;
  email: string;
  legalName: string;
  taxNo: string;
  taxOffice: string;
  address: string;
  brandColor: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  slug: string;
  commissionPct: string;
}

const COMMISSION_CHIPS = [15, 25, 35];

function fromTenant(t: TenantSettings): FormState {
  return {
    name: t.name,
    phone: t.phone ? t.phone.replace(/^\+90/, '0') : '',
    email: t.email ?? '',
    legalName: t.legalName ?? '',
    taxNo: t.taxNo ?? '',
    taxOffice: t.taxOffice ?? '',
    address: t.address ?? '',
    brandColor: t.brandColor,
    logoUrl: t.logoUrl,
    coverUrl: t.coverUrl,
    slug: t.slug,
    commissionPct: String(t.marketplaceCommissionBp / 100).replace('.', ','),
  };
}

const nullIfEmpty = (s: string) => (s.trim() === '' ? null : s.trim());

function toPatch(f: FormState, t: TenantSettings): TenantPatch {
  const patch: TenantPatch = {};
  const str = (k: 'legalName' | 'taxOffice' | 'address', v: string) => {
    const n = nullIfEmpty(v);
    if (n !== (t[k] ?? null)) patch[k] = n;
  };
  if (f.name.trim() !== t.name) patch.name = f.name.trim();
  const phone = nullIfEmpty(f.phone);
  if (phone !== (t.phone ? t.phone.replace(/^\+90/, '0') : null)) patch.phone = phone;
  const email = nullIfEmpty(f.email);
  if (email !== (t.email ?? null)) patch.email = email;
  str('legalName', f.legalName);
  str('taxOffice', f.taxOffice);
  str('address', f.address);
  const taxNo = nullIfEmpty(f.taxNo.replace(/\s/g, ''));
  if (taxNo !== (t.taxNo ?? null)) patch.taxNo = taxNo;
  if ((f.brandColor ?? null) !== (t.brandColor ?? null)) patch.brandColor = f.brandColor;
  if (f.logoUrl !== t.logoUrl) patch.logoUrl = f.logoUrl;
  if (f.coverUrl !== t.coverUrl) patch.coverUrl = f.coverUrl;
  if (f.slug.trim().toLowerCase() !== t.slug) patch.slug = f.slug.trim().toLowerCase();
  const pct = Number(f.commissionPct.replace(',', '.'));
  if (Number.isFinite(pct)) {
    const bp = Math.round(pct * 100);
    if (bp !== t.marketplaceCommissionBp) patch.marketplaceCommissionBp = bp;
  }
  return patch;
}

/** İşletme bilgileri, marka görünümü, künye, mağaza adresi ve tasarruf oranı (04 §7.2, P-26). */
export function BusinessForm({ embedded = false, onSaved }: { embedded?: boolean; onSaved?: () => void }) {
  const q = useTenantSettings();
  const me = useMe();
  const isOwner = currentRole(me.data) === 'owner';
  const update = useUpdateTenant();
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (q.data && !form) setForm(fromTenant(q.data));
  }, [q.data, form]);

  const patch = useMemo(() => (form && q.data ? toPatch(form, q.data) : {}), [form, q.data]);
  const dirty = Object.keys(patch).length > 0;
  const errors = issuesOf(update.error);

  if (q.isPending) return <SettingsLoading />;
  if (q.isError) return <SettingsError error={q.error} onRetry={() => void q.refetch()} />;
  if (!form) return <SettingsLoading />;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const pctInvalid = !Number.isFinite(Number(form.commissionPct.replace(',', '.'))) || Number(form.commissionPct.replace(',', '.')) > 60;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || pctInvalid) return;
    try {
      const saved = await update.mutateAsync(patch);
      setForm(fromTenant(saved));
      toast.success('İşletme bilgileri kaydedildi.');
      onSaved?.();
    } catch (err) {
      toast.error(errorMessage(err, 'Kaydedilemedi.'));
    }
  }

  const slugChanged = form.slug.trim().toLowerCase() !== q.data.slug;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {q.data.imprintMissing.length ? (
        <Alert variant="warning" title="Künye eksik">
          Künye tamamlanmadan mağazanız yayına alınmaz. Eksik: {q.data.imprintMissing.join(', ')}.
        </Alert>
      ) : null}

      <Section title="Genel bilgiler" description="Müşterinin mağazada ve mesajlarda göreceği bilgiler.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Görünen ad" required error={errors.name}>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} autoComplete="organization" />
          </Field>
          <Field label="Müşteriye gösterilecek telefon" hint="Sabit hat ya da cep" error={errors.phone}>
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" autoComplete="tel" placeholder="0354 212 00 00" />
          </Field>
          <Field label="E-posta" error={errors.email} className="sm:col-span-2">
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
          </Field>
        </div>
      </Section>

      <Section title="Marka görünümü" description="Ana renk, logo ve kapak görseli mağazanızda ve baskılarda kullanılır.">
        <BrandColorPicker value={form.brandColor} onChange={(v) => set('brandColor', v)} businessName={form.name} logoUrl={form.logoUrl} error={errors.brandColor} />
        <div className="grid gap-4 md:grid-cols-2">
          <ImageField
            label="Logo"
            hint="Önerilen 1024×1024 px kare; PNG, JPEG ya da WebP, en çok 5 MB."
            value={form.logoUrl}
            onChange={(v) => set('logoUrl', v)}
            minWidth={256}
            minHeight={256}
            error={errors.logoUrl}
          />
          <ImageField
            label="Kapak görseli"
            hint="Önerilen 1200×630 px; görselde yazı olmasın."
            value={form.coverUrl}
            onChange={(v) => set('coverUrl', v)}
            minWidth={800}
            minHeight={420}
            aspect="wide"
            error={errors.coverUrl}
          />
        </div>
      </Section>

      <Section title="Künye" description="Mesafeli satış mevzuatı gereği mağazanızın altında gösterilir.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Unvan ya da ad-soyad" error={errors.legalName}>
            <Input value={form.legalName} onChange={(e) => set('legalName', e.target.value)} maxLength={160} />
          </Field>
          <Field label="VKN / T.C. kimlik no" error={errors.taxNo}>
            <Input value={form.taxNo} onChange={(e) => set('taxNo', e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" maxLength={11} />
          </Field>
          <Field label="Vergi dairesi" error={errors.taxOffice}>
            <Input value={form.taxOffice} onChange={(e) => set('taxOffice', e.target.value)} maxLength={80} />
          </Field>
          <Field label="Adres" error={errors.address} className="sm:col-span-2">
            <Textarea value={form.address} onChange={(e) => set('address', e.target.value)} rows={2} maxLength={300} />
          </Field>
        </div>
      </Section>

      <Section title="Mağaza adresi" description="Müşterilerin sipariş verdiği bağlantı.">
        <Field
          label="Adres kısaltması"
          hint={isOwner ? publicStorefrontUrl(form.slug || q.data.slug) : 'Yalnız işletme sahibi değiştirebilir.'}
          error={errors.slug}
        >
          <Input
            value={form.slug}
            onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            disabled={!isOwner}
            maxLength={40}
            spellCheck={false}
          />
        </Field>
        {slugChanged ? (
          <p className="flex items-start gap-2 rounded-md bg-warning-bg p-3 text-sm text-fg">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            Adresiniz değişecek; basılı QR kodlar ve paylaştığınız bağlantılar eski adrese gider. Yeni QR ve afişleri yeniden yazdırın.
          </p>
        ) : null}
      </Section>

      <Section
        title="Tasarruf raporu oranı"
        description="Pazaryerinin sizden aldığı ortalama kesinti (KDV hariç). Raporlardaki tasarruf hesabı bu oranı kullanır."
      >
        <div className="flex flex-wrap items-end gap-2">
          {COMMISSION_CHIPS.map((c) => {
            const active = Number(form.commissionPct.replace(',', '.')) === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => set('commissionPct', String(c))}
                aria-pressed={active}
                className={cn(
                  'min-h-hit min-w-16 rounded-full border px-4 text-base font-semibold',
                  active ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong bg-surface-raised text-fg hover:bg-accent',
                )}
              >
                %{c}
              </button>
            );
          })}
          <Field label="Diğer (%)" className="w-32" error={pctInvalid ? '0–60 arası' : errors.marketplaceCommissionBp}>
            <Input value={form.commissionPct} onChange={(e) => set('commissionPct', e.target.value.replace(/[^\d,.]/g, ''))} inputMode="decimal" />
          </Field>
        </div>
      </Section>

      <SaveBar dirty={dirty} saving={update.isPending} onReset={embedded ? undefined : () => setForm(fromTenant(q.data))} />
    </form>
  );
}
