'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  CircleCheck,
  CircleX,
  Copy,
  MessageCircle,
  MessageSquareOff,
  PlugZap,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Unplug,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PanelWhatsappResponse } from '@siparis/core';
import { PasswordInput } from '@/components/auth/password-input';
import { useTenantSettings } from '@/components/settings/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Field,
  Input,
  PageHeader,
  RadioGroup,
  Skeleton,
  buttonVariants,
} from '@/components/ui';
import { apiFetch, errorMessage, fieldErrorsOf, isApiError, useApiQuery } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { supportWhatsappHref } from '@/lib/site';
import { useQueryClient } from '@tanstack/react-query';
import { CustomerLinkField, QrDownloadLinks, svgDataUri, TableCardPrinter } from './shop-qr';

/** Kendi numara için sağlayıcılar (ortak numara satırı 'shared' bu formda seçilmez). */
type Provider = 'mock' | 'cloud' | 'd360';

/** GET /panel/whatsapp yanıtı (core contracts/whatsapp.ts panelWhatsappResponseSchema). */
type WhatsappSettings = PanelWhatsappResponse;

const KEY = ['panel', 'whatsapp'] as const;

/** Hesabın kendi-numara sağlayıcısı ('shared' satırı formda 360dialog'a düşer). */
function ownProvider(acc: WhatsappSettings['account']): Provider {
  return !acc || acc.provider === 'shared' ? 'd360' : acc.provider;
}

/** Bağlantı kesilmiş hesap: webhook adresi çalışmaz, mesaj gitmez; yeniden bağlamak için anahtar girilir. */
function isDisconnected(acc: WhatsappSettings['account']): boolean {
  return acc?.status === 'disconnected';
}

/** Webhook adresinin girileceği yer (sağlayıcıya göre). */
function webhookPlace(provider: Provider): string {
  return provider === 'd360' ? '360dialog panelinde (ya da API ile)' : provider === 'cloud' ? 'Meta uygulamanızda WhatsApp > Yapılandırma bölümünde' : 'sağlayıcı panelinde';
}

const PROVIDER_OPTIONS: { value: Provider; label: string; description: string }[] = [
  { value: 'd360', label: '360dialog', description: 'Önerilen aracı firma (BSP). Numaranızı 360dialog panelinden bağlar, aldığınız API anahtarını buraya girersiniz.' },
  { value: 'cloud', label: 'Meta Cloud API', description: 'Doğrudan Meta. Telefon numarası kimliği (Phone number ID) ve erişim anahtarı gerekir.' },
  { value: 'mock', label: 'Geliştirme / Simülatör', description: 'Gerçek mesaj gitmez; mesajlar geliştirici simülatöründe görünür. Yalnız deneme için.' },
];

function HealthCard({ data }: { data: WhatsappSettings }) {
  const { account, health } = data;
  const tone = isDisconnected(account)
    ? { Icon: Unplug, badge: 'warning' as const, label: 'Bağlantı kesik' }
    : health.level === 'ok'
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
  const [provider, setProvider] = useState<Provider>(ownProvider(acc));
  const [displayPhone, setDisplayPhone] = useState(acc?.displayPhoneFormatted ?? '');
  const [phoneNumberId, setPhoneNumberId] = useState(acc?.provider === 'mock' ? '' : (acc?.phoneNumberId ?? ''));
  const [wabaId, setWabaId] = useState(acc?.wabaId ?? '');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!acc) return;
    setProvider(ownProvider(acc));
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
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotated, setRotated] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Webhook adresi kopyalandı.');
    } catch {
      toast.error('Kopyalanamadı; adresi seçip elle kopyalayın.');
    }
  };
  const rotate = async () => {
    setRotating(true);
    try {
      // Yanıt güncel ayarları ve yeni adresi taşır; kart yeni adresi önbellekten gösterir
      const res = await apiFetch<WhatsappSettings & { webhookUrl: string }>('/panel/whatsapp/rotate-webhook-token', { method: 'POST', body: {} });
      qc.setQueryData(KEY, res);
      setRotated(true);
      setConfirmOpen(false);
      toast.success('Yeni webhook adresi oluşturuldu. Sağlayıcı paneline girmeyi unutmayın.');
    } catch (err) {
      toast.error(errorMessage(err, 'Webhook adresi yenilenemedi.'));
    } finally {
      setRotating(false);
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
        {rotated ? (
          <Alert variant="warning" title="Yeni adresi şimdi tanımlayın" className="mt-3">
            Eski adres artık çalışmıyor. Yukarıdaki yeni adresi {webhookPlace(provider)} webhook olarak kaydedin; kaydedene kadar müşterilerin WhatsApp
            mesajları size ulaşmaz.
          </Alert>
        ) : null}
        <div className="mt-4 flex flex-col items-start gap-2 border-t border-border pt-4">
          <p className="text-sm text-fg-muted">
            Adres başkalarının eline geçtiyse ya da tanımadığınız istekler görüyorsanız yenileyin. Eski adres hemen çalışmaz; yenisini {webhookPlace(provider)} tekrar
            girmeniz gerekir.
          </p>
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            <RefreshCw aria-hidden />
            Webhook adresini yenile
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Webhook adresi yenilensin mi?"
        description={`Yeni gizli bir adres oluşturulur, mevcut adres hemen geçersiz olur. Yeni adresi ${webhookPlace(provider)} webhook olarak kaydedene kadar müşterilerin WhatsApp mesajları size ulaşmaz ve bot yanıt vermez.`}
        confirmLabel="Adresi yenile"
        loading={rotating}
        onConfirm={() => void rotate()}
      />
    </Card>
  );
}

function DisconnectCard({ data }: { data: WhatsappSettings }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const smsReady = data.smsFallback.tenantEnabled && data.smsFallback.platformEnabled;
  const provider = ownProvider(data.account);
  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<WhatsappSettings>('/panel/whatsapp/disconnect', { method: 'POST', body: {} });
      qc.setQueryData(KEY, res);
      setOpen(false);
      toast.success('WhatsApp bağlantısı kesildi.');
    } catch (err) {
      toast.error(errorMessage(err, 'Bağlantı kesilemedi.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bağlantıyı kes</CardTitle>
        <CardDescription>
          Numaranızı başka bir sağlayıcıya taşıyacaksanız, API anahtarınızın başkasının eline geçtiğinden şüpheleniyorsanız ya da WhatsApp üzerinden sipariş almayı
          bırakacaksanız kullanın.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="danger" onClick={() => setOpen(true)}>
          <Unplug aria-hidden />
          Bağlantıyı kes
        </Button>
      </CardContent>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="WhatsApp bağlantısı kesilsin mi?"
        description="Bağlantı hemen kesilir. Yeniden bağlamak için kurulumu tekrarlamanız gerekir."
        confirmLabel="Bağlantıyı kes"
        loading={busy}
        onConfirm={() => void disconnect()}
      >
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm leading-6">
          <li>Kayıtlı API anahtarı silinir ve webhook adresi geçersiz olur.</li>
          <li>Müşterilere WhatsApp mesajı (onay, yolda, teslim) gitmez, gelen mesajlar alınmaz; gönderilmeyi bekleyen mesajlar da gitmez.</li>
          <li>
            {smsReady
              ? 'Web siparişleri SMS koduyla doğrulanır ve durum bildirimleri SMS ile gider (WhatsApp’sız mod).'
              : 'SMS yedeği kapalı: web siparişleri kendiliğinden doğrulanamaz; müşteriyi arayıp siparişi panelden doğrulamanız gerekir.'}
          </li>
          <li>Sohbet ve mesaj geçmişi silinmez.</li>
          <li>Yeniden bağlamak için API anahtarını tekrar girip kaydetmeniz ve yeni webhook adresini {webhookPlace(provider)} tanımlamanız gerekir.</li>
        </ul>
      </ConfirmDialog>
    </Card>
  );
}

function TestCard({ enabled, disabledHint, description }: { enabled: boolean; disabledHint: string; description?: string }) {
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
        <CardDescription>
          {description ?? 'Boş bırakırsanız hesabınızdaki telefona gider. Gerçek sağlayıcıda, test numarası son 24 saatte işletme numaranıza yazmış olmalıdır.'}
        </CardDescription>
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
        {!enabled ? <p className="mt-2 text-sm text-fg-muted">{disabledHint}</p> : null}
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

// ---------------------------------------------------------------------------
// Ortak numara (00 §12a madde 8): varsayılan mod. İşletmenin bağlayacağı bir şey yoktur; QR ve bağlantı paylaşılır.

type SharedInfo = NonNullable<WhatsappSettings['shared']>;

function SharedNumberCard({ data, shared }: { data: WhatsappSettings; shared: SharedInfo }) {
  const { health } = data;
  const tone =
    health.level === 'ok'
      ? { Icon: CircleCheck, badge: 'success' as const, label: 'Sipariş alıyor' }
      : health.level === 'error'
        ? { Icon: CircleX, badge: 'danger' as const, label: 'Hata' }
        : { Icon: TriangleAlert, badge: 'warning' as const, label: 'Dikkat' };
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Ortak numara</CardTitle>
          <Badge variant={tone.badge}>
            <tone.Icon aria-hidden />
            {tone.label}
          </Badge>
        </div>
        <p className="text-lg font-bold text-fg">Siparişleriniz ortak {shared.displayName} numarasından gelir.</p>
        <CardDescription>
          Ayrı bir WhatsApp numarası bağlamanız gerekmez. Müşteriniz QR kodunuzu okutunca ya da dükkan kodunuzu yazınca doğrudan size bağlanır;
          her mesajda dükkanınızın adı görünür ve siparişler bu panele düşer. Başka dükkanların müşterileri ve siparişleri sizinkilerden ayrıdır.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-fg-muted">Dükkan kodunuz</dt>
            <dd className="font-mono text-2xl font-bold tracking-wide">{shared.code ? `#${shared.code}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">WhatsApp numarası</dt>
            <dd className="font-semibold">{shared.displayPhoneFormatted ?? 'Henüz yapılandırılmadı'}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Müşterinin gördüğü ad</dt>
            <dd className="font-semibold">{shared.displayName}</dd>
          </div>
        </dl>
        {!shared.selectable && shared.selectableReason ? <Alert variant="warning">{shared.selectableReason}</Alert> : null}
        {health.level !== 'ok' && health.message !== shared.selectableReason ? (
          <Alert variant={health.level === 'error' ? 'danger' : 'warning'}>{health.message}</Alert>
        ) : null}
        <p className="text-sm text-fg-muted">
          Dükkan kodunu yalnız Siparişin Önünde ekibi değiştirebilir; kod değişirse eski QR’lar çalışmaz. Son 24 saat: {health.sentLast24h} mesaj gönderildi
          {health.failedLast24h ? ` · ${health.failedLast24h} gönderilemedi` : ''}
          {health.lastInboundAt ? ` · son gelen mesaj ${formatRelative(health.lastInboundAt)}` : ''}.
        </p>
      </CardContent>
    </Card>
  );
}

function SharedHowItWorks({ shared }: { shared: SharedInfo }) {
  const steps = [
    { Icon: QrCode, text: 'Müşteri masadaki, kapıdaki ya da paketteki QR kodunuzu okutur.' },
    {
      Icon: MessageCircle,
      text: `WhatsApp, “${shared.prefillText ?? `#${shared.code ?? ''}`}” mesajıyla ${shared.displayName} numarasına açılır; müşteri gönder’e basar.`,
    },
    { Icon: Smartphone, text: 'Bot dükkanınızın adıyla karşılar ve “Menüyü aç” bağlantısını gönderir; sipariş panelinize sesli düşer.' },
    {
      Icon: Users,
      text: 'Müşteri sonra kodsuz yazarsa son sipariş verdiği dükkanlar düğme olarak sorulur; dükkan adınızı ya da kodunuzu yazması da yeterlidir.',
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nasıl çalışır?</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3">
          {steps.map((s, i) => (
            <li key={s.text} className="flex items-start gap-3 text-sm leading-6">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface font-bold" aria-hidden>
                {i + 1}
              </span>
              <span className="flex items-start gap-2">
                <s.Icon aria-hidden className="mt-1 size-4 shrink-0 text-fg-muted" />
                {s.text}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function SharedLinkCard({ shared }: { shared: SharedInfo }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Müşteri bağlantısı</CardTitle>
        <CardDescription>
          Instagram profilinize, Google işletme kaydınıza ya da müşterilerinize gönderin. Bağlantı WhatsApp’ı dükkan kodunuzla açar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {shared.waLink ? (
          <CustomerLinkField link={shared.waLink} />
        ) : (
          <Alert variant="warning">Ortak numara henüz yapılandırılmadığı için bağlantı oluşturulamadı.</Alert>
        )}
      </CardContent>
    </Card>
  );
}

function SharedQrCard({ shared }: { shared: SharedInfo }) {
  const tenant = useTenantSettings();
  const qrSrc = shared.qrSvg ? svgDataUri(shared.qrSvg) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>QR kodunuz</CardTitle>
        <CardDescription>
          PNG’yi matbaaya verebilir, SVG’yi tasarımcınıza gönderebilir ya da hazır masa kartını yazdırabilirsiniz. Afiş ve paket kartı için “QR ve afiş” sayfasına bakın.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {qrSrc ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt={`Dükkan QR kodu (#${shared.code ?? ''})`} width={176} height={176} className="size-44 shrink-0 self-center rounded-md border border-border bg-white sm:self-auto" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <p className="text-sm text-fg-muted">
                Okutunca WhatsApp’ta hazır mesaj: <span className="font-semibold text-fg">{shared.prefillText}</span>
              </p>
              <QrDownloadLinks />
            </div>
          </div>
        ) : (
          <Alert variant="warning">QR kodu oluşturulamadı: ortak numara henüz yapılandırılmadı.</Alert>
        )}
        {qrSrc && shared.code ? (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <h3 className="text-base font-semibold text-fg">Masa kartı</h3>
            <TableCardPrinter
              shopName={tenant.data?.name ?? 'İşletmeniz'}
              code={shared.code}
              qrSrc={qrSrc}
              phoneFormatted={shared.displayPhoneFormatted}
              brandColor={tenant.data?.brandColor}
              logoUrl={tenant.data?.logoUrl}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Ortak numaradaki işletmeye kendi numara seçeneği: geçişi platform yapar (PUT ortak numarada 409 wa_shared_mode). */
function OwnNumberOffer() {
  const wa = supportWhatsappHref('Merhaba, kendi WhatsApp numaramla sipariş almak istiyorum. İşletme adı: ');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Kendi numaranızı bağlayın</CardTitle>
        <CardDescription>İsteğe bağlı. Çoğu işletme için ortak numara yeterlidir.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm leading-6">
          <li>Müşterileriniz sohbet başlığında kendi işletme adınızı görür; dükkan kodu gerekmez.</li>
          <li>Numaranız resmi WhatsApp Business Platform’a bir aracı firma (360dialog) ya da doğrudan Meta üzerinden bağlanır.</li>
          <li>Numara başına aylık aracı firma ücreti ve Meta mesaj ücretleri ayrıca faturalanır; bu nedenle üst pakette sunulur.</li>
          <li>Geçişi ekibimiz yapar; ardından bu sayfada sağlayıcı bilgilerinizi girersiniz. Sohbet ve sipariş geçmişiniz korunur.</li>
        </ul>
        {wa ? (
          <a href={wa} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary', className: 'self-start' })}>
            <MessageCircle aria-hidden />
            Bize yazın
          </a>
        ) : (
          <p className="text-sm font-semibold text-fg">Kendi numaranıza geçmek için destek hattımızdan bize ulaşın.</p>
        )}
      </CardContent>
    </Card>
  );
}

function SharedModeView({ data, shared }: { data: WhatsappSettings; shared: SharedInfo }) {
  return (
    <>
      <SharedNumberCard data={data} shared={shared} />
      <SharedLinkCard shared={shared} />
      <SharedQrCard shared={shared} />
      <SharedHowItWorks shared={shared} />
      <TestCard
        enabled={!!data.account && data.account.status === 'connected'}
        disabledHint="Ortak numara henüz hazır değil."
        description={`Ortak numaradan (${shared.displayName}) test mesajı gönderir. Boş bırakırsanız hesabınızdaki telefona gider; başka bir numaraya yalnız son 24 saatte size yazmış bir müşterinize gönderebilirsiniz (10 dakikada en çok 3 test). Gerçek numarada, test telefonundan son 24 saatte ortak numaraya yazılmış olmalıdır (ör. QR kodunuzu okutup mesajı gönderin).`}
      />
      <OwnNumberOffer />
    </>
  );
}

function OwnModeView({ data }: { data: WhatsappSettings }) {
  const acc = data.account;
  return (
    <>
      <HealthCard data={data} />
      <ConnectionForm data={data} />
      {acc && !isDisconnected(acc) && acc.webhookUrl ? <WebhookCard url={acc.webhookUrl} provider={ownProvider(acc)} /> : null}
      <TestCard
        enabled={!!acc && !isDisconnected(acc)}
        disabledHint={isDisconnected(acc) ? 'Bağlantı kesik. Yeniden bağlamak için yukarıdaki bilgileri kaydedin.' : 'Önce numaranızı kaydedin.'}
      />
      <SmsModeCard data={data} />
      <Guide360 />
      {acc && !isDisconnected(acc) ? <DisconnectCard data={data} /> : null}
    </>
  );
}

/** /panel/ayarlar/whatsapp (04 P-25) — yalnız işletme sahibi. Ortak numarada QR ve bağlantı, kendi numarada bağlantı ayarları. */
export function WhatsappSettingsPage() {
  const q = useApiQuery<WhatsappSettings>([...KEY], '/panel/whatsapp');
  const shared = q.data?.mode === 'shared' ? q.data.shared : null;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="WhatsApp"
        description={
          shared
            ? 'Ortak numara, dükkan kodunuz, müşteri bağlantınız ve QR kodunuz. Siparişin Önünde yalnız resmi WhatsApp Business Platform’u kullanır.'
            : 'Numaranız, bağlantı sağlığı ve test mesajı. Siparişin Önünde yalnız resmi WhatsApp Business Platform’u kullanır.'
        }
      />
      {q.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-80" />
        </div>
      ) : q.isError ? (
        <Alert variant={isApiError(q.error) && q.error.status === 403 ? 'warning' : 'danger'} title="WhatsApp bilgileri açılamadı">
          {isApiError(q.error) && q.error.status === 403 ? 'WhatsApp ayarlarını yalnız işletme sahibi yönetebilir.' : errorMessage(q.error)}
        </Alert>
      ) : shared ? (
        <SharedModeView data={q.data} shared={shared} />
      ) : (
        <OwnModeView data={q.data} />
      )}
    </div>
  );
}
