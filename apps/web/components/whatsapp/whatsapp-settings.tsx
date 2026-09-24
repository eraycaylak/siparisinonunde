'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CircleCheck, CircleX, Copy, MessageSquareOff, PlugZap, Send, ShieldCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { PasswordInput } from '@/components/auth/password-input';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  PageHeader,
  RadioGroup,
  Skeleton,
} from '@/components/ui';
import { apiFetch, errorMessage, fieldErrorsOf, isApiError, useApiQuery } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useQueryClient } from '@tanstack/react-query';

type Provider = 'mock' | 'cloud' | 'd360';

interface WhatsappSettings {
  account: {
    id: string;
    provider: Provider;
    providerLabel: string;
    displayPhone: string | null;
    displayPhoneFormatted: string | null;
    phoneNumberId: string | null;
    wabaId: string | null;
    hasApiKey: boolean;
    apiKeyMasked: string | null;
    status: 'connected' | 'disconnected' | 'error';
    statusLabel: string;
    lastWebhookAt: string | null;
    lastError: string | null;
    webhookUrl: string;
    updatedAt: string;
  } | null;
  health: { level: 'ok' | 'warning' | 'error' | 'none'; message: string; sentLast24h: number; failedLast24h: number; lastOutboundAt: string | null; lastInboundAt: string | null };
  smsFallback: { tenantEnabled: boolean; platformEnabled: boolean; active: boolean };
  providers: { value: Provider; label: string }[];
}

const KEY = ['panel', 'whatsapp'] as const;

const PROVIDER_OPTIONS: { value: Provider; label: string; description: string }[] = [
  { value: 'd360', label: '360dialog', description: 'Önerilen aracı firma (BSP). Numaranızı 360dialog panelinden bağlar, aldığınız API anahtarını buraya girersiniz.' },
  { value: 'cloud', label: 'Meta Cloud API', description: 'Doğrudan Meta. Telefon numarası kimliği (Phone number ID) ve erişim anahtarı gerekir.' },
  { value: 'mock', label: 'Geliştirme / Simülatör', description: 'Gerçek mesaj gitmez; mesajlar geliştirici simülatöründe görünür. Yalnız deneme için.' },
];

function HealthCard({ data }: { data: WhatsappSettings }) {
  const { account, health } = data;
  const tone =
    health.level === 'ok'
      ? { Icon: CircleCheck, badge: 'success' as const, label: 'Bağlı' }
      : health.level === 'error'
        ? { Icon: CircleX, badge: 'danger' as const, label: 'Hata' }
        : health.level === 'warning'
          ? { Icon: TriangleAlert, badge: 'warning' as const, label: 'Dikkat' }
          : { Icon: PlugZap, badge: 'neutral' as const, label: 'Bağlı değil' };
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Bağlantı sağlığı</CardTitle>
          <Badge variant={tone.badge}>
            <tone.Icon aria-hidden />
            {tone.label}
          </Badge>
        </div>
        <CardDescription>{health.message}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-fg-muted">Numara</dt>
            <dd className="font-semibold">{account?.displayPhoneFormatted ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Sağlayıcı</dt>
            <dd className="font-semibold">{account?.providerLabel ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Son webhook</dt>
            <dd className="font-semibold">{account?.lastWebhookAt ? `${formatRelative(account.lastWebhookAt)} · ${formatDateTime(account.lastWebhookAt)}` : 'Henüz gelmedi'}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Son 24 saat</dt>
            <dd className="font-semibold">
              {health.sentLast24h} gönderildi{health.failedLast24h ? ` · ${health.failedLast24h} gönderilemedi` : ''}
            </dd>
          </div>
          {account?.lastError ? (
            <div className="sm:col-span-2">
              <dt className="text-fg-muted">Son hata</dt>
              <dd className="font-semibold text-destructive">{account.lastError}</dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function ConnectionForm({ data }: { data: WhatsappSettings }) {
  const qc = useQueryClient();
  const acc = data.account;
  const [provider, setProvider] = useState<Provider>(acc?.provider ?? 'd360');
  const [displayPhone, setDisplayPhone] = useState(acc?.displayPhoneFormatted ?? '');
  const [phoneNumberId, setPhoneNumberId] = useState(acc?.provider === 'mock' ? '' : (acc?.phoneNumberId ?? ''));
  const [wabaId, setWabaId] = useState(acc?.wabaId ?? '');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!acc) return;
    setProvider(acc.provider);
    setDisplayPhone(acc.displayPhoneFormatted ?? '');
    setPhoneNumberId(acc.provider === 'mock' ? '' : (acc.phoneNumberId ?? ''));
    setWabaId(acc.wabaId ?? '');
  }, [acc]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const res = await apiFetch<WhatsappSettings>('/panel/whatsapp', {
        method: 'PUT',
        body: {
          provider,
          displayPhone,
          phoneNumberId: phoneNumberId.trim() || null,
          wabaId: wabaId.trim() || null,
          apiKey: apiKey.trim() || null,
        },
      });
      qc.setQueryData(KEY, res);
      setApiKey('');
      toast.success('WhatsApp bağlantısı kaydedildi.');
    } catch (err) {
      setErrors(fieldErrorsOf(err));
      setFormError(errorMessage(err, 'Kaydedilemedi.'));
    } finally {
      setSaving(false);
    }
  };

  const keyHint = acc?.hasApiKey ? `Kayıtlı anahtar: ${acc.apiKeyMasked ?? '••••'}. Değiştirmek için yenisini yazın; boş bırakırsanız mevcut anahtar kalır.` : 'Anahtar şifrelenerek saklanır; bir daha tam olarak gösterilmez.';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Numara ve sağlayıcı</CardTitle>
        <CardDescription>İşletme WhatsApp numaranızı aracı firma üzerinden bağlayın. Resmi WhatsApp Business Platform (Cloud API) kullanılır.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <RadioGroup legend="Sağlayıcı" options={PROVIDER_OPTIONS} value={provider} onValueChange={setProvider} />
          <Field label="WhatsApp numarası" required hint="Müşterilerin yazdığı numara, ör. 0532 123 45 67" error={errors.displayPhone}>
            <Input value={displayPhone} onChange={(e) => setDisplayPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
          </Field>
          {provider !== 'mock' ? (
            <>
              <Field
                label="Telefon numarası kimliği (Phone number ID)"
                required={provider === 'cloud'}
                hint={provider === 'd360' ? '360dialog için isteğe bağlı (kayıt ve eşleştirme için).' : 'Meta Business Suite > WhatsApp Manager > Telefon numaraları.'}
                error={errors.phoneNumberId}
              >
                <Input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} autoComplete="off" />
              </Field>
              <Field label="WhatsApp Business hesap kimliği (WABA ID)" hint="İsteğe bağlı." error={errors.wabaId}>
                <Input value={wabaId} onChange={(e) => setWabaId(e.target.value)} autoComplete="off" />
              </Field>
              <Field label={provider === 'd360' ? '360dialog API anahtarı' : 'Erişim anahtarı (access token)'} required={!acc?.hasApiKey} hint={keyHint} error={errors.apiKey}>
                <PasswordInput value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password" placeholder={acc?.hasApiKey ? (acc.apiKeyMasked ?? '••••') : ''} />
              </Field>
            </>
          ) : null}
          {formError ? <Alert variant="danger">{formError}</Alert> : null}
          <div>
            <Button type="submit" size="xl" loading={saving}>
              <ShieldCheck aria-hidden />
              Kaydet
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function WebhookCard({ url, provider }: { url: string; provider: Provider }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Webhook adresi kopyalandı.');
    } catch {
      toast.error('Kopyalanamadı; adresi seçip elle kopyalayın.');
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook adresi</CardTitle>
        <CardDescription>
          {provider === 'd360'
            ? '360dialog panelinde (ya da API ile) bu adresi webhook olarak tanımlayın. Gelen mesajlar buraya düşer.'
            : provider === 'cloud'
              ? 'Meta uygulamanızda WhatsApp > Yapılandırma bölümünde geri çağırma adresi olarak girin.'
              : 'Simülatörde gerekmez; gerçek sağlayıcıya geçince kullanılır.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Webhook adresi</span>
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-sm" />
          </label>
          <Button variant="secondary" onClick={() => void copy()}>
            <Copy aria-hidden />
            Kopyala
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TestCard({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch<{ to: string }>('/panel/whatsapp/test', { method: 'POST', body: { to: to.trim() || null } });
      toast.success(`Test mesajı gönderildi (${res.to}).`);
    } catch (err) {
      setError(errorMessage(err, 'Test mesajı gönderilemedi.'));
      if (isApiError(err) && err.code === 'wa_send_failed') void qc.invalidateQueries({ queryKey: KEY });
    } finally {
      setSending(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Test mesajı</CardTitle>
        <CardDescription>Boş bırakırsanız hesabınızdaki telefona gider. Gerçek sağlayıcıda, test numarası son 24 saatte işletme numaranıza yazmış olmalıdır.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={send} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Telefon (isteğe bağlı)" className="min-w-0 flex-1">
            <Input value={to} onChange={(e) => setTo(e.target.value)} inputMode="tel" placeholder="0532 123 45 67" />
          </Field>
          <Button type="submit" size="lg" loading={sending} disabled={!enabled}>
            <Send aria-hidden />
            Test mesajı gönder
          </Button>
        </form>
        {!enabled ? <p className="mt-2 text-sm text-fg-muted">Önce numaranızı kaydedin.</p> : null}
        {error ? (
          <Alert variant="danger" className="mt-3">
            {error}
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Guide360() {
  const steps = [
    'WhatsApp Business uygulamasındaki numaranızı kullanacaksanız telefonunuzda uygulamanın güncel olduğundan emin olun (Coexistence: numaranız telefonda da çalışmaya devam eder — Türkiye numarasıyla teyit edilmeli).',
    '360dialog kayıt sayfasında (hub.360dialog.com) hesap açın ve "Numara ekle" adımını başlatın. Facebook hesabınızla giriş yapıp işletme portföyünüzü seçin.',
    'Numaranızı doğrulayın (SMS ya da arama ile gelen kod). Görünen ad olarak işletmenizin tabeladaki adını girin; Meta onayı birkaç saat sürebilir (teyit edilmeli).',
    'Meta Business hesabınıza geçerli bir ödeme kartı ekleyin; mesaj ücretlerini Meta bu karttan çeker. Kart yoksa müşterilere giden mesajlar durur (hata 131042).',
    '360dialog panelinde numaranız için API anahtarı oluşturun ve bu sayfadaki "360dialog API anahtarı" alanına yapıştırıp kaydedin.',
    'Bu sayfadaki webhook adresini 360dialog panelinde (ya da API ile) webhook olarak tanımlayın (teyit edilmeli: v2 uç noktasında "configs/webhook").',
    '"Test mesajı gönder" ile kendi telefonunuza mesaj gönderin. Önce kendi telefonunuzdan işletme numaranıza "merhaba" yazın (24 saat kuralı).',
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>360dialog ile bağlama rehberi</CardTitle>
        <CardDescription>Adımlar aracı firmanın ekranlarına göre küçük farklılık gösterebilir; kurulumu biz de yapabiliriz.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex list-decimal flex-col gap-2 ps-5 text-sm leading-6">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function SmsModeCard({ data }: { data: WhatsappSettings }) {
  const { smsFallback } = data;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>WhatsApp’sız mod</CardTitle>
          <Badge variant={smsFallback.active ? 'warning' : 'neutral'}>
            <MessageSquareOff aria-hidden />
            {smsFallback.active ? 'Şu an etkin' : 'Etkin değil'}
          </Badge>
        </div>
        <CardDescription>
          WhatsApp bağlantınız yoksa ya da hata verirse web siparişleri SMS koduyla doğrulanır; müşteriler durumu takip sayfasından görür, onay, ret ve iptal SMS ile
          bildirilir. Böylece Meta adımları bitmeden sipariş almaya başlayabilirsiniz.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1 text-sm">
          <li>İşletme ayarı: {smsFallback.tenantEnabled ? 'SMS yedeği açık' : 'SMS yedeği kapalı'}</li>
          <li>Platform: {smsFallback.platformEnabled ? 'SMS gönderimi açık' : 'SMS gönderimi geçici olarak kapalı'}</li>
          <li>SMS’ler paketinizdeki aylık kotaya dahildir (Esnaf 100, Pro 300, Zincir şube başına 300); kota aşımında uyarılırsınız.</li>
        </ul>
      </CardContent>
    </Card>
  );
}

/** /panel/ayarlar/whatsapp (04 P-25) — yalnız işletme sahibi. */
export function WhatsappSettingsPage() {
  const q = useApiQuery<WhatsappSettings>([...KEY], '/panel/whatsapp');
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title="WhatsApp bağlantısı" description="Numaranız, bağlantı sağlığı ve test mesajı. Siparişin Önünde yalnız resmi WhatsApp Business Platform’u kullanır." />
      {q.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-80" />
        </div>
      ) : q.isError ? (
        <Alert variant={isApiError(q.error) && q.error.status === 403 ? 'warning' : 'danger'} title="Bağlantı bilgileri açılamadı">
          {isApiError(q.error) && q.error.status === 403 ? 'WhatsApp bağlantısını yalnız işletme sahibi yönetebilir.' : errorMessage(q.error)}
        </Alert>
      ) : (
        <>
          <HealthCard data={q.data} />
          <ConnectionForm data={q.data} />
          {q.data.account ? <WebhookCard url={q.data.account.webhookUrl} provider={q.data.account.provider} /> : null}
          <TestCard enabled={!!q.data.account} />
          <SmsModeCard data={q.data} />
          <Guide360 />
        </>
      )}
    </div>
  );
}
