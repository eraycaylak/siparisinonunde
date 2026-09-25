'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Store } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage, fieldErrorsOf, isApiError } from '@/lib/api';
import { useSignup } from '@/lib/auth';
import { PLAN_CODE_LABELS } from '@/lib/labels';
import { PILOT_AREA } from '@/lib/site';
import { TRIAL_DAYS } from '@/lib/plans';
import { PasswordInput } from './password-input';

interface Values {
  businessName: string;
  ownerName: string;
  phone: string;
  email: string;
  password: string;
  city: string;
  acceptTerms: boolean;
  commercePolicy: boolean;
}

type Errors = Partial<Record<keyof Values, string>>;

const INITIAL: Values = {
  businessName: '',
  ownerName: '',
  phone: '',
  email: '',
  password: '',
  city: PILOT_AREA.city,
  acceptTerms: false,
  commercePolicy: false,
};

function validate(v: Values): Errors {
  const e: Errors = {};
  if (v.businessName.trim().length < 2) e.businessName = 'İşletmenin adını yazın.';
  if (v.ownerName.trim().length < 2) e.ownerName = 'Adınızı ve soyadınızı yazın.';
  const digits = v.phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 12) e.phone = 'Cep telefonunu 0 (5xx) xxx xx xx biçiminde yazın.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = 'Geçerli bir e-posta adresi yazın.';
  if (v.password.length < 8) e.password = 'Parola en az 8 karakter olmalı.';
  if (v.city.trim().length < 2) e.city = 'İli yazın.';
  if (!v.acceptTerms) e.acceptTerms = 'Devam etmek için kullanım koşullarını kabul edin.';
  if (!v.commercePolicy) e.commercePolicy = 'Devam etmek için bu beyanı onaylayın.';
  return e;
}

/** İşletme kaydı → POST /api/v1/auth/signup → /panel/kurulum (14 §6.1). */
export function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const signup = useSignup();
  const [values, setValues] = useState<Values>(INITIAL);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const plan = params.get('paket');
  const planLabel = plan === 'esnaf' || plan === 'pro' ? PLAN_CODE_LABELS[plan] : null;

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const v = validate(values);
    setErrors(v);
    if (Object.keys(v).length > 0) {
      const first = Object.keys(v)[0];
      if (first) document.getElementsByName(first)[0]?.focus();
      return;
    }
    try {
      await signup.mutateAsync({
        businessName: values.businessName.trim(),
        ownerName: values.ownerName.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
        password: values.password,
        city: values.city.trim(),
        acceptTerms: true,
      });
      router.push('/panel/kurulum');
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === 'email_taken') {
          setErrors({ email: 'Bu e-posta ile bir hesap var. Giriş yapmayı deneyin.' });
          return;
        }
        if (err.code === 'phone_taken') {
          setErrors({ phone: 'Bu telefonla bir hesap var. Giriş yapmayı deneyin.' });
          return;
        }
        if (err.code === 'signup_closed') {
          setFormError('Yeni kayıtlar geçici olarak kapalı. Demo formundan bize ulaşın; sizi arayalım.');
          return;
        }
        const fe = fieldErrorsOf(err) as Errors;
        if (Object.keys(fe).length > 0) {
          setErrors(fe);
          return;
        }
      }
      setFormError(`${errorMessage(err, 'Kayıt tamamlanamadı.')} Bilgileriniz bu sayfada duruyor.`);
    }
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {planLabel ? (
        <Alert variant="info" title={`Seçtiğiniz paket: ${planLabel}`}>
          {TRIAL_DAYS} günlük deneme boyunca bize kart vermezsiniz. Paketi deneme sonunda seçersiniz.
        </Alert>
      ) : null}
      {formError ? <Alert variant="danger">{formError}</Alert> : null}
      <Field label="İşletme adı" required error={errors.businessName}>
        <Input
          name="businessName"
          autoComplete="organization"
          value={values.businessName}
          onChange={(e) => set('businessName', e.target.value)}
        />
      </Field>
      <Field label="Adınız soyadınız" required error={errors.ownerName}>
        <Input name="ownerName" autoComplete="name" value={values.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Cep telefonu" required error={errors.phone}>
          <Input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0 (5__) ___ __ __"
            value={values.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </Field>
        <Field label="İl" required error={errors.city}>
          <Input name="city" autoComplete="address-level1" value={values.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
      </div>
      <Field label="E-posta" required error={errors.email}>
        <Input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={values.email}
          onChange={(e) => set('email', e.target.value)}
        />
      </Field>
      <Field label="Parola" required error={errors.password} hint="En az 8 karakter.">
        <PasswordInput
          name="password"
          autoComplete="new-password"
          value={values.password}
          onChange={(e) => set('password', e.target.value)}
        />
      </Field>
      <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
        <Checkbox
          name="acceptTerms"
          checked={values.acceptTerms}
          onChange={(e) => set('acceptTerms', e.target.checked)}
          error={errors.acceptTerms}
          label={
            <>
              <Link href="/yasal/kullanim-kosullari" target="_blank" className="font-semibold underline underline-offset-4">
                Kullanım koşullarını ve abonelik şartlarını
              </Link>{' '}
              okudum, kabul ediyorum.
            </>
          }
        />
        <Checkbox
          name="commercePolicy"
          checked={values.commercePolicy}
          onChange={(e) => set('commercePolicy', e.target.checked)}
          error={errors.commercePolicy}
          label="Alkol, tütün, ilaç ve tüp gazı WhatsApp ve web üzerinden satmayacağımı beyan ederim."
        />
        {/* Aydınlatma bilgilendirmedir, onay kutusu değildir (08 §7.4 satır 3, 03 §4.4) */}
        <p className="pt-1 text-sm text-fg-muted">
          Kişisel verileriniz{' '}
          <Link href="/yasal/kvkk-aydinlatma" target="_blank" className="font-semibold text-fg underline underline-offset-4">
            KVKK aydınlatma metnine
          </Link>{' '}
          uygun olarak işlenir.
        </p>
      </div>
      <Button type="submit" size="lg" block loading={signup.isPending}>
        <Store aria-hidden />
        Hesabımı aç
      </Button>
      <p className="text-sm text-fg-muted">
        Zaten hesabınız var mı?{' '}
        <Link href="/panel/giris" className="font-semibold text-fg underline underline-offset-4">
          Giriş yapın
        </Link>
      </p>
    </form>
  );
}
