'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CircleCheck, Send } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { apiFetch, errorMessage, fieldErrorsOf, isApiError } from '@/lib/api';
import { decodeCalculatorInput, hasCalculatorParams, type CalculatorInput } from '@/lib/calculator';
import { PILOT_AREA } from '@/lib/site';

const BUSINESS_TYPES = [
  'Dönerci',
  'Pide / lahmacun',
  'Kebap',
  'Çiğ köfte',
  'Pizza / burger',
  'Ev yemekleri',
  'Kafe',
  'Pastane',
  'Su bayi',
  'Tüp bayi',
  'Eczane',
  'Tekel',
  'Nargile kafe',
  'Diğer',
] as const;

/** Commerce Policy: WhatsApp ve web üzerinden satışı yasak/kısıtlı işletme türleri (00 §6.10). */
const RESTRICTED = new Set(['Tüp bayi', 'Eczane', 'Tekel', 'Nargile kafe']);

const DAILY_RANGES = ['0–10', '10–20', '20–40', '40–80', '80+'] as const;
const CALL_TIMES = ['Fark etmez', 'Sabah (09.00–12.00)', 'Öğleden sonra (12.00–17.00)', 'Akşam (17.00–20.00)'] as const;

interface FormState {
  name: string;
  businessName: string;
  phone: string;
  city: string;
  district: string;
  businessType: string;
  dailyOrders: string;
  marketplaces: string;
  callTime: string;
  waOptIn: boolean;
  website: string; // bal küpü
}

const INITIAL: FormState = {
  name: '',
  businessName: '',
  phone: '',
  city: PILOT_AREA.city,
  district: PILOT_AREA.district,
  businessType: '',
  dailyOrders: '',
  marketplaces: '',
  callTime: CALL_TIMES[0],
  waOptIn: false,
  website: '',
};

type Errors = Partial<Record<keyof FormState, string>>;

function validate(s: FormState): Errors {
  const e: Errors = {};
  if (s.name.trim().length < 2) e.name = 'Adını ve soyadını yaz.';
  if (s.businessName.trim().length < 2) e.businessName = 'İşletmenin adını yaz.';
  const digits = s.phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 12) e.phone = 'Telefonu 0 (5xx) xxx xx xx biçiminde yaz.';
  if (s.city.trim().length < 2) e.city = 'İli yaz.';
  if (s.district.trim().length < 2) e.district = 'İlçeyi yaz.';
  if (!s.businessType) e.businessType = 'İşletme türünü seç.';
  if (!s.dailyOrders) e.dailyOrders = 'Günlük paket sipariş aralığını seç.';
  return e;
}

/** Demo talebi formu → POST /api/v1/public/leads (05 C.5.1). */
export function DemoForm() {
  const [state, setState] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [calcInput, setCalcInput] = useState<CalculatorInput | null>(null);

  // Hesaplayıcıdan gelindiyse girdiler lead'e eklenir (source = calculator).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('kaynak') === 'hesaplayici' && hasCalculatorParams(sp)) setCalcInput(decodeCalculatorInput(sp));
  }, []);

  const restricted = RESTRICTED.has(state.businessType);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((s) => ({ ...s, [key]: value }));

  const notes = useMemo(
    () =>
      [
        `İlçe: ${state.district.trim()}`,
        `İşletme türü: ${state.businessType}`,
        `Günlük paket: ${state.dailyOrders}`,
        state.marketplaces.trim() ? `Pazaryerleri: ${state.marketplaces.trim()}` : null,
        `Arama zamanı: ${state.callTime}`,
        `WhatsApp'tan yazılabilir: ${state.waOptIn ? 'evet' : 'hayır'}`,
      ]
        .filter(Boolean)
        .join(' · '),
    [state],
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (restricted) return;
    const v = validate(state);
    setErrors(v);
    if (Object.keys(v).length > 0) {
      const first = Object.keys(v)[0];
      if (first) document.getElementsByName(first)[0]?.focus();
      return;
    }
    if (state.website) {
      // Bot: sessizce "gönderildi" göster.
      setDone(true);
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/public/leads', {
        method: 'POST',
        body: {
          name: state.name.trim(),
          businessName: state.businessName.trim(),
          phone: state.phone.trim(),
          city: state.city.trim(),
          source: calcInput ? 'calculator' : 'demo_form',
          notes,
          ...(calcInput ? { calculatorInput: calcInput } : {}),
        },
      });
      setDone(true);
    } catch (err) {
      const fe = fieldErrorsOf(err) as Errors;
      if (Object.keys(fe).length > 0) setErrors(fe);
      const unavailable = !isApiError(err) || err.status === 0 || err.status === 404 || err.status >= 500;
      setSubmitError(
        unavailable
          ? 'Talebin şu an gönderilemedi. Bilgilerin bu sayfada duruyor; biraz sonra tekrar deneyebilirsin.'
          : `${errorMessage(err, 'Talebin gönderilemedi.')} Bilgilerini kontrol edip tekrar dene.`,
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div role="status" className="flex flex-col items-start gap-4 rounded-xl border border-border bg-surface-raised p-6">
        <CircleCheck aria-hidden className="size-10 text-status-ready-fg" />
        <h2 className="text-2xl font-bold text-fg">Teşekkürler, talebini aldık.</h2>
        <p className="text-lg text-fg-muted">1 iş günü içinde seni arıyoruz. Bu arada kendi rakamlarınla bir hesap yapabilirsin.</p>
        <Link href="/hesaplayici" className="font-semibold text-fg underline underline-offset-4">
          Hesaplayıcıyı aç
        </Link>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="relative flex flex-col gap-5 rounded-xl border border-border bg-surface-raised p-5 sm:p-6">
      {calcInput ? (
        <Alert variant="info" title="Hesaplayıcı sonucun forma eklendi">
          Görüşmede kendi rakamlarınla konuşacağız. Bu bilgiler kişisel veri içermez.
        </Alert>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Ad soyad" required error={errors.name}>
          <Input name="name" autoComplete="name" value={state.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="İşletme adı" required error={errors.businessName}>
          <Input
            name="businessName"
            autoComplete="organization"
            value={state.businessName}
            onChange={(e) => set('businessName', e.target.value)}
          />
        </Field>
      </div>
      <Field label="WhatsApp telefonu" required error={errors.phone} hint="0 (5xx) xxx xx xx">
        <Input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0 (5__) ___ __ __"
          value={state.phone}
          onChange={(e) => set('phone', e.target.value)}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="İl" required error={errors.city}>
          <Input name="city" autoComplete="address-level1" value={state.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="İlçe" required error={errors.district}>
          <Input name="district" autoComplete="address-level2" value={state.district} onChange={(e) => set('district', e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="İşletme türü" required error={errors.businessType}>
          <Select
            name="businessType"
            placeholder="Seçin"
            value={state.businessType}
            onChange={(e) => set('businessType', e.target.value)}
            options={BUSINESS_TYPES.map((t) => ({ value: t, label: t }))}
          />
        </Field>
        <Field label="Günlük paket sipariş" required error={errors.dailyOrders}>
          <Select
            name="dailyOrders"
            placeholder="Seçin"
            value={state.dailyOrders}
            onChange={(e) => set('dailyOrders', e.target.value)}
            options={DAILY_RANGES.map((t) => ({ value: t, label: t }))}
          />
        </Field>
      </div>
      {restricted ? (
        <Alert variant="warning" title="Şu an bu işletme türüne hizmet veremiyoruz">
          Alkol, tütün, ilaç ve tüp gaz WhatsApp ve web üzerinden satılamıyor. Bu yüzden bu işletme türü için kayıt alamıyoruz.
        </Alert>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Kullandığın pazaryerleri" hint="İsteğe bağlı">
          <Input name="marketplaces" value={state.marketplaces} onChange={(e) => set('marketplaces', e.target.value)} />
        </Field>
        <Field label="Uygun arama zamanı">
          <Select
            name="callTime"
            value={state.callTime}
            onChange={(e) => set('callTime', e.target.value)}
            options={CALL_TIMES.map((t) => ({ value: t, label: t }))}
          />
        </Field>
      </div>
      {/* Bal küpü: insanlar görmez, botlar doldurur. */}
      <div aria-hidden className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Web sitesi
          <input tabIndex={-1} autoComplete="off" name="website" value={state.website} onChange={(e) => set('website', e.target.value)} />
        </label>
      </div>
      <Checkbox
        name="waOptIn"
        checked={state.waOptIn}
        onChange={(e) => set('waOptIn', e.target.checked)}
        label="Demo ve teklif için WhatsApp’tan yazılmasını kabul ediyorum."
        description="İsteğe bağlı. İşaretlemezsen seni telefonla ararız."
      />
      <p className="text-sm text-fg-muted">
        Bilgilerin demo talebini değerlendirmek için işlenir. Ayrıntı:{' '}
        <Link href="/yasal/kvkk-aydinlatma" className="font-semibold text-fg underline underline-offset-4">
          KVKK aydınlatma metni
        </Link>
        .
      </p>
      {submitError ? <Alert variant="danger">{submitError}</Alert> : null}
      <Button type="submit" size="lg" loading={submitting} disabled={restricted} className="sm:self-start">
        <Send aria-hidden />
        Demo iste
      </Button>
    </form>
  );
}
