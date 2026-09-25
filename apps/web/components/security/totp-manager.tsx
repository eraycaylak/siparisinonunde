'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, RefreshCw, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { PasswordInput } from '@/components/auth/password-input';
import { Section } from '@/components/settings/settings-shell';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage, isApiError } from '@/lib/api';
import {
  useMe,
  useTotpDisable,
  useTotpEnable,
  useTotpRegenerate,
  useTotpSetup,
  useTotpStatus,
  type TotpSetupResponse,
} from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { RecoveryCodesPanel } from './recovery-codes';

export interface TotpManagerProps {
  /** Kapalıyken "önerilir" notu (işletme sahibi). */
  recommended?: boolean;
}

/** Kod alanı hataları: API kodu → Türkçe metin. */
function codeErrorText(err: unknown): string {
  if (isApiError(err)) {
    if (err.code === 'invalid_totp') return 'Kod hatalı ya da süresi dolmuş. Uygulamadaki güncel kodu yazın.';
    if (err.code === 'invalid_password') return 'Parola hatalı.';
    if (err.status === 429) {
      const retry = (err.details as { retryAfterSec?: number } | undefined)?.retryAfterSec ?? 60;
      return `Çok fazla deneme yapıldı. ${Math.max(1, Math.ceil(retry / 60))} dakika bekleyip tekrar deneyin.`;
    }
  }
  return errorMessage(err, 'İşlem yapılamadı. Tekrar deneyin.');
}

/** "ABCDEFGH…" → "ABCD EFGH …" (elle girişte okunaklı). */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/** SVG metnini data: URL'ye çevirir; <img> içinde gösterilir (HTML'e gömülmez). */
function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * İki adımlı doğrulama (TOTP) yönetimi — platform yöneticisi (/admin/guvenlik) ve işletme kullanıcıları
 * (/panel/ayarlar/guvenlik) için ortak: kurulum (QR + elle anahtar + ilk kod), kurtarma kodları (bir kez),
 * kodları yenileme ve kapatma (zorunlu olduğu platform yöneticisinde kapalı).
 */
export function TotpManager({ recommended = false }: TotpManagerProps) {
  const me = useMe();
  const impersonating = Boolean(me.data?.impersonating);
  const status = useTotpStatus({ enabled: me.data != null && !impersonating });
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  if (impersonating) {
    return <Alert variant="info">Destek görünümündeyken güvenlik ayarları görüntülenemez ve değiştirilemez.</Alert>;
  }
  if (me.isPending || status.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Yükleniyor">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-12 w-48" />
      </div>
    );
  }
  if (status.isError) {
    return (
      <Alert
        variant="danger"
        title="Güvenlik bilgileri yüklenemedi"
        action={
          <Button variant="secondary" onClick={() => void status.refetch()}>
            Tekrar dene
          </Button>
        }
      >
        {errorMessage(status.error)}
      </Alert>
    );
  }

  if (codes) {
    return (
      <Section title="Kurtarma kodları">
        <RecoveryCodesPanel codes={codes} onDone={() => setCodes(null)} />
      </Section>
    );
  }

  const s = status.data;
  if (s.enabled) {
    return <EnabledView enabledAt={s.enabledAt} remaining={s.recoveryCodesRemaining} required={s.required} onNewCodes={setCodes} />;
  }
  if (setup) {
    return (
      <SetupView
        setup={setup}
        onCancel={() => setSetup(null)}
        onEnabled={(c) => {
          setSetup(null);
          setCodes(c);
        }}
      />
    );
  }
  return <IntroView required={s.required} recommended={recommended} onStarted={setSetup} />;
}

function IntroView({ required, recommended, onStarted }: { required: boolean; recommended: boolean; onStarted: (s: TotpSetupResponse) => void }) {
  const start = useTotpSetup();
  const [error, setError] = useState<string | null>(null);

  const begin = () => {
    setError(null);
    start.mutate(undefined, { onSuccess: onStarted, onError: (err) => setError(errorMessage(err, 'Kurulum başlatılamadı. Tekrar deneyin.')) });
  };

  return (
    <Section
      title="İki adımlı doğrulama"
      description="Girişte parolanıza ek olarak telefonunuzdaki doğrulama uygulamasının ürettiği 6 haneli kod istenir. Parolanız başkasının eline geçse bile telefonunuz olmadan hesabınıza girilemez."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="neutral">
          <ShieldOff aria-hidden />
          Kapalı
        </Badge>
        {required ? <Badge variant="danger">Zorunlu</Badge> : recommended ? <Badge variant="warning">Önerilir</Badge> : null}
      </div>
      {required ? (
        <Alert variant="warning" title="Yönetim ekranları için zorunlu">
          Platform yöneticileri iki adımlı doğrulamayı açmadan yönetim ekranlarını kullanamaz. Kurulum iki dakika sürer.
        </Alert>
      ) : recommended ? (
        <Alert variant="info">
          İşletme sahibi hesabı siparişlere, müşteri bilgilerine ve WhatsApp bağlantısına erişir; açmanızı öneririz.
        </Alert>
      ) : null}
      <p className="text-sm text-fg-muted">
        Gerekenler: telefonunuzda bir doğrulama uygulaması (ör. Google Authenticator, Microsoft Authenticator ya da parola
        yöneticinizin kod özelliği).
      </p>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <Button size="lg" className="self-start" onClick={begin} loading={start.isPending}>
        <ShieldCheck aria-hidden />
        Kurulumu başlat
      </Button>
    </Section>
  );
}

function SetupView({ setup, onCancel, onEnabled }: { setup: TotpSetupResponse; onCancel: () => void; onEnabled: (codes: string[]) => void }) {
  const enable = useTotpEnable();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(setup.secret);
      toast.success('Anahtar kopyalandı.');
    } catch {
      toast.error('Kopyalanamadı. Anahtarı elle yazın.');
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setCodeError('Uygulamadaki 6 haneli kodu yazın.');
      return;
    }
    setCodeError(undefined);
    // mutateAsync: kodlar üst bileşenin durumuna yazılır (bu görünüm sökülse de kaybolmaz)
    try {
      const res = await enable.mutateAsync(code);
      toast.success('İki adımlı doğrulama açıldı. Diğer cihazlardaki oturumlar kapatıldı.');
      onEnabled(res.recoveryCodes);
    } catch (err) {
      setCode('');
      setCodeError(codeErrorText(err));
    }
  };

  return (
    <Section title="İki adımlı doğrulamayı kur" description="Üç adım: QR kodu okutun, uygulamadaki kodu yazın, kurtarma kodlarını kaydedin.">
      <ol className="flex flex-col gap-5">
        <li className="flex flex-col gap-3">
          <p className="text-base font-semibold text-fg">
            1. Doğrulama uygulamasında “Hesap ekle”ye dokunun ve bu QR kodu okutun.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {/* QR SVG'si API'den gelir; HTML'e gömülmez, data: URL ile resim olarak gösterilir */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={svgDataUrl(setup.qrSvg)}
              alt="İki adımlı doğrulama kurulum QR kodu"
              width={208}
              height={208}
              className="size-52 shrink-0 rounded-md border border-border bg-white p-1"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="flex items-start gap-2 text-sm text-fg-muted">
                <Smartphone aria-hidden className="mt-0.5 size-4 shrink-0" />
                QR okutamıyorsanız uygulamada “Anahtarı elle gir”i seçip bu anahtarı yazın (zamana dayalı):
              </p>
              <p className="break-words rounded-md bg-surface px-3 py-2 font-mono text-base font-semibold tracking-wider text-fg" aria-label="Kurulum anahtarı">
                {groupSecret(setup.secret)}
              </p>
              <Button variant="secondary" className="self-start" onClick={() => void copySecret()}>
                <Copy aria-hidden />
                Anahtarı kopyala
              </Button>
            </div>
          </div>
        </li>
        <li>
          <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
            <p className="text-base font-semibold text-fg">2. Uygulamada görünen 6 haneli kodu yazın.</p>
            <Field label="Doğrulama kodu" required error={codeError} hint="Kod 30 saniyede bir yenilenir; güncel olanı yazın.">
              <Input
                name="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="max-w-48 font-mono text-lg tracking-[0.3em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="lg" loading={enable.isPending}>
                <ShieldCheck aria-hidden />
                Doğrula ve aç
              </Button>
              <Button variant="ghost" size="lg" onClick={onCancel} disabled={enable.isPending}>
                Vazgeç
              </Button>
            </div>
          </form>
        </li>
      </ol>
    </Section>
  );
}

function EnabledView({
  enabledAt,
  remaining,
  required,
  onNewCodes,
}: {
  enabledAt: string | null;
  remaining: number;
  required: boolean;
  onNewCodes: (codes: string[]) => void;
}) {
  const [dialog, setDialog] = useState<'regenerate' | 'disable' | null>(null);

  return (
    <Section title="İki adımlı doğrulama" description="Girişte parolanızdan sonra doğrulama uygulamanızdaki kod istenir.">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">
          <ShieldCheck aria-hidden />
          Açık
        </Badge>
        {enabledAt ? <span className="text-sm text-fg-muted">{formatDateTime(enabledAt)} tarihinden beri</span> : null}
      </div>
      <p className="text-base text-fg">
        Kullanılmamış kurtarma kodu: <strong>{remaining}</strong>
      </p>
      {remaining <= 2 ? (
        <Alert variant="warning">
          {remaining === 0 ? 'Hiç kurtarma kodunuz kalmadı.' : 'Kurtarma kodlarınız azaldı.'} Telefonunuzu kaybederseniz giriş
          yapabilmek için yeni kodlar oluşturun.
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setDialog('regenerate')}>
          <RefreshCw aria-hidden />
          Yeni kurtarma kodları
        </Button>
        {!required ? (
          <Button variant="secondary" onClick={() => setDialog('disable')}>
            <ShieldOff aria-hidden />
            Kapat
          </Button>
        ) : null}
      </div>
      {required ? (
        <p className="text-sm text-fg-muted">
          Platform yöneticilerinde iki adımlı doğrulama kapatılamaz. Telefonunuzu kaybederseniz kurtarma kodlarından biriyle
          girin; kodlarınız da yoksa sunucu yöneticisi kurulumu sıfırlar.
        </p>
      ) : null}

      <RegenerateDialog
        open={dialog === 'regenerate'}
        onOpenChange={(o) => setDialog(o ? 'regenerate' : null)}
        onDone={(codes) => {
          setDialog(null);
          onNewCodes(codes);
        }}
      />
      {!required ? <DisableDialog open={dialog === 'disable'} onOpenChange={(o) => setDialog(o ? 'disable' : null)} /> : null}
    </Section>
  );
}

function CodeField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Field label="Doğrulama kodu" required error={error} hint="Uygulamadaki 6 haneli kod ya da kurtarma kodlarınızdan biri.">
      <Input
        name="code"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={20}
        className="font-mono tracking-wider"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function RegenerateDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (codes: string[]) => void }) {
  const regenerate = useTotpRegenerate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();

  const close = (o: boolean) => {
    if (!o) {
      setCode('');
      setError(undefined);
    }
    onOpenChange(o);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 6) {
      setError('Kodu yazın.');
      return;
    }
    setError(undefined);
    regenerate.mutate(code.trim(), {
      onSuccess: (res) => {
        setCode('');
        onDone(res.recoveryCodes);
      },
      onError: (err) => setError(codeErrorText(err)),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      dismissible={!regenerate.isPending}
      title="Yeni kurtarma kodları"
      description="Eski kodların hepsi geçersiz olur. Devam etmek için kodunuzu girin."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={regenerate.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="totp-regenerate" loading={regenerate.isPending}>
            <KeyRound aria-hidden />
            Kodları oluştur
          </Button>
        </>
      }
    >
      <form id="totp-regenerate" noValidate onSubmit={submit}>
        <CodeField value={code} onChange={setCode} error={error} />
      </form>
    </Dialog>
  );
}

function DisableDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const disable = useTotpDisable();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ password?: string; code?: string; form?: string }>({});

  const close = (o: boolean) => {
    if (!o) {
      setPassword('');
      setCode('');
      setErrors({});
    }
    onOpenChange(o);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fe: typeof errors = {};
    if (!password) fe.password = 'Parolanızı yazın.';
    if (code.trim().length < 6) fe.code = 'Kodu yazın.';
    setErrors(fe);
    if (Object.keys(fe).length) return;
    disable.mutate(
      { password, code: code.trim() },
      {
        onSuccess: () => {
          toast.success('İki adımlı doğrulama kapatıldı.');
          close(false);
        },
        onError: (err) => {
          if (isApiError(err) && err.code === 'invalid_password') setErrors({ password: codeErrorText(err) });
          else if (isApiError(err) && err.code === 'invalid_totp') setErrors({ code: codeErrorText(err) });
          else setErrors({ form: codeErrorText(err) });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      dismissible={!disable.isPending}
      title="İki adımlı doğrulamayı kapat"
      description="Kapatınca girişte yalnız parolanız istenir ve kurtarma kodlarınız silinir."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={disable.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="totp-disable" variant="danger" loading={disable.isPending}>
            <ShieldOff aria-hidden />
            Kapat
          </Button>
        </>
      }
    >
      <form id="totp-disable" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {errors.form ? <Alert variant="danger">{errors.form}</Alert> : null}
        <Field label="Parola" required error={errors.password}>
          <PasswordInput name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <CodeField value={code} onChange={setCode} error={errors.code} />
      </form>
    </Dialog>
  );
}
