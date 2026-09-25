'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { KeyRound, LogIn, MessageCircle, Phone, Smartphone } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage, isApiError } from '@/lib/api';
import { homePathFor, logout, safeNextPath, useLogin, useMe } from '@/lib/auth';
import { formatPhone } from '@/lib/format';
import { SUPPORT_WHATSAPP, supportWhatsappHref } from '@/lib/site';
import { PasswordInput } from './password-input';

export interface LoginFormProps {
  /** 'panel': işletme girişi; 'admin': platform girişi (yetki kontrolü + TOTP). */
  variant?: 'panel' | 'admin';
}

type SecondFactor = 'totp' | 'recovery';

function loginErrorText(err: unknown, factor: SecondFactor): string {
  if (isApiError(err)) {
    // Önce kod: 'invalid_totp' da 401 döner
    if (err.code === 'invalid_totp') {
      return factor === 'recovery'
        ? 'Kurtarma kodu hatalı ya da daha önce kullanılmış.'
        : 'Doğrulama kodu hatalı ya da süresi dolmuş. Uygulamadaki güncel kodu yazın.';
    }
    if (err.code === 'account_disabled') return 'Bu hesap kapatılmış. İşletme sahibinizle görüşün.';
    if (err.status === 429 || err.code === 'rate_limited') {
      const retry = (err.details as { retryAfterSec?: number } | undefined)?.retryAfterSec ?? 60;
      const minutes = Math.max(1, Math.ceil(retry / 60));
      return `Çok fazla deneme yaptınız. ${minutes} dakika bekleyip tekrar deneyin.`;
    }
    if (err.status === 401 || err.code === 'invalid_credentials') return 'E-posta/telefon ya da parola hatalı. Kontrol edip tekrar deneyin.';
  }
  return errorMessage(err, 'Giriş yapılamadı. Tekrar deneyin.');
}

/** Kurtarma kodu biçimi: 8 harf/rakam (tire ve boşluk serbest). */
function isRecoveryCodeShape(value: string): boolean {
  return value.replace(/[^a-z0-9]/gi, '').length === 8;
}

/** E-posta/telefon + parola ile giriş (14 §6.1 POST /auth/login). */
export function LoginForm({ variant = 'panel' }: LoginFormProps) {
  const router = useRouter();
  const params = useSearchParams();
  const me = useMe();
  const login = useLogin();
  const [values, setValues] = useState({ login: '', password: '', totp: '', recoveryCode: '' });
  const [needTotp, setNeedTotp] = useState(false);
  const [factor, setFactor] = useState<SecondFactor>('totp');
  const [fieldErrors, setFieldErrors] = useState<{ login?: string; password?: string; totp?: string; recoveryCode?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);
  const submitted = useRef(false);
  const loginRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const next = params.get('next');

  // Zaten oturum varsa hedefe geç.
  useEffect(() => {
    if (submitted.current || !me.data) return;
    if (variant === 'admin') {
      if (me.data.isPlatformAdmin) router.replace(safeNextPath(next, '/admin'));
      return;
    }
    router.replace(safeNextPath(next, homePathFor(me.data)));
  }, [me.data, next, router, variant]);

  useEffect(() => {
    loginRef.current?.focus();
  }, []);

  // İkinci adım alanı açılınca ya da kod türü değişince odak koda
  useEffect(() => {
    if (needTotp) codeRef.current?.focus();
  }, [needTotp, factor]);

  const switchFactor = () => {
    setFactor((f) => (f === 'totp' ? 'recovery' : 'totp'));
    setFieldErrors((fe) => ({ ...fe, totp: undefined, recoveryCode: undefined }));
    setError(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const fe: typeof fieldErrors = {};
    if (values.login.trim().length < 3) fe.login = 'E-posta adresinizi ya da telefonunuzu yazın.';
    if (!values.password) fe.password = 'Parolanızı yazın.';
    if (needTotp && factor === 'totp' && !/^\d{6}$/.test(values.totp.trim())) fe.totp = '6 haneli kodu yazın.';
    if (needTotp && factor === 'recovery' && !isRecoveryCodeShape(values.recoveryCode)) fe.recoveryCode = 'Kurtarma kodunu yazın (ör. ABCD-EFGH).';
    setFieldErrors(fe);
    if (Object.keys(fe).length > 0) return;

    submitted.current = true;
    try {
      const secondFactor = !needTotp ? {} : factor === 'totp' ? { totp: values.totp.trim() } : { recoveryCode: values.recoveryCode.trim() };
      const res = await login.mutateAsync({
        login: values.login.trim(),
        password: values.password,
        ...secondFactor,
      });
      if (variant === 'admin') {
        if (!res.isPlatformAdmin) {
          await logout().catch(() => undefined);
          submitted.current = false;
          setError('Bu hesabın platform yetkisi yok. İşletme girişini kullanın.');
          return;
        }
        router.replace(safeNextPath(next, '/admin'));
        return;
      }
      router.replace(safeNextPath(next, homePathFor({ isPlatformAdmin: res.isPlatformAdmin, memberships: res.memberships })));
    } catch (err) {
      submitted.current = false;
      if (isApiError(err) && err.code === 'totp_required') {
        setNeedTotp(true);
        setError(null);
        return;
      }
      if (isApiError(err) && err.code === 'invalid_totp') {
        // Kod alanında göster, alanı temizle ve yeniden odakla
        const msg = loginErrorText(err, factor);
        setValues((v) => (factor === 'totp' ? { ...v, totp: '' } : { ...v, recoveryCode: '' }));
        setFieldErrors((fe) => (factor === 'totp' ? { ...fe, totp: msg } : { ...fe, recoveryCode: msg }));
        setError(null);
        codeRef.current?.focus();
        return;
      }
      setError(loginErrorText(err, factor));
    }
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <Field label="E-posta ya da telefon" required error={fieldErrors.login}>
        <Input
          ref={loginRef}
          name="login"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={values.login}
          onChange={(e) => setValues((v) => ({ ...v, login: e.target.value }))}
        />
      </Field>
      <Field label="Parola" required error={fieldErrors.password}>
        <PasswordInput
          name="password"
          autoComplete="current-password"
          value={values.password}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
        />
      </Field>
      {needTotp ? (
        <div className="flex flex-col gap-3">
          <Alert variant="info">Bu hesapta iki adımlı doğrulama açık. Girişi tamamlamak için ikinci adımı doğrulayın.</Alert>
          {factor === 'totp' ? (
            <Field label="Doğrulama kodu" required error={fieldErrors.totp} hint="Doğrulama uygulamanızdaki 6 haneli kod.">
              <Input
                key="totp"
                ref={codeRef}
                name="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="font-mono tracking-[0.3em]"
                value={values.totp}
                onChange={(e) => setValues((v) => ({ ...v, totp: e.target.value.replace(/\D/g, '') }))}
              />
            </Field>
          ) : (
            <Field
              label="Kurtarma kodu"
              required
              error={fieldErrors.recoveryCode}
              hint="İki adımlı doğrulamayı açarken kaydettiğiniz kodlardan biri. Her kod yalnız bir kez kullanılabilir."
            >
              <Input
                key="recovery"
                ref={codeRef}
                name="recoveryCode"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={20}
                placeholder="ABCD-EFGH"
                className="font-mono uppercase tracking-wider"
                value={values.recoveryCode}
                onChange={(e) => setValues((v) => ({ ...v, recoveryCode: e.target.value }))}
              />
            </Field>
          )}
          <button
            type="button"
            className="inline-flex min-h-hit items-center gap-2 self-start rounded-md text-sm font-semibold text-fg underline underline-offset-4"
            onClick={switchFactor}
          >
            {factor === 'totp' ? <KeyRound aria-hidden className="size-4" /> : <Smartphone aria-hidden className="size-4" />}
            {factor === 'totp' ? 'Kurtarma kodu kullan' : 'Doğrulama uygulamasındaki kodu kullan'}
          </button>
        </div>
      ) : null}
      <Button type="submit" size="lg" block loading={login.isPending}>
        <LogIn aria-hidden />
        Giriş yap
      </Button>
      {variant === 'panel' ? (
        <div className="flex flex-col gap-3 text-sm">
          <button
            type="button"
            className="min-h-hit self-start font-semibold text-fg underline underline-offset-4"
            onClick={() => setShowForgot((s) => !s)}
            aria-expanded={showForgot}
          >
            Parolamı unuttum
          </button>
          {showForgot ? <ForgotPasswordHelp /> : null}
          <p className="text-fg-muted">Kuryeyseniz işletmenizin gönderdiği giriş linkini kullanın.</p>
          <p className="text-fg-muted">
            Hesabınız yok mu?{' '}
            <Link href="/panel/kayit" className="font-semibold text-fg underline underline-offset-4">
              Ücretsiz deneyin
            </Link>
          </p>
        </div>
      ) : null}
      {me.isError && !me.data ? (
        <p className="text-sm text-fg-muted">Sunucuya şu an ulaşılamıyor olabilir; giriş denemeniz başarısız olursa biraz sonra tekrar deneyin.</p>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {login.isPending ? 'Giriş yapılıyor' : ''}
      </span>
    </form>
  );
}

/** Parola sıfırlama yolu: personel → işletme sahibi; sahip → platform destek hattı (WhatsApp) ya da iletişim formu. */
function ForgotPasswordHelp() {
  const wa = supportWhatsappHref('Merhaba, işletme paneli parolamı unuttum. İşletme adı: ');
  return (
    <Alert variant="info">
      <span className="flex flex-col gap-2">
        <span>Personelseniz işletme sahibinizden parolanızı sıfırlamasını isteyin.</span>
        {wa ? (
          <span>
            İşletme sahibiyseniz destek hattımıza yazın; kimliğinizi doğruladıktan sonra parolanızı sıfırlarız.
            <span className="mt-2 flex flex-wrap gap-2">
              <a href={wa} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                <MessageCircle aria-hidden /> WhatsApp’tan yaz
              </a>
              <a href={`tel:+${SUPPORT_WHATSAPP}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                <Phone aria-hidden /> {formatPhone(SUPPORT_WHATSAPP)}
              </a>
            </span>
          </span>
        ) : (
          <span>
            İşletme sahibiyseniz{' '}
            <Link href="/demo" className="font-semibold underline underline-offset-4">
              iletişim formundan
            </Link>{' '}
            bize yazın; sizi arayıp kimliğinizi doğruladıktan sonra parolanızı sıfırlarız.
          </span>
        )}
      </span>
    </Alert>
  );
}
