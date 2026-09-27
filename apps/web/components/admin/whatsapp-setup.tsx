'use client';

// Ortak numara "WhatsApp kurulumu" (yalnız platform sahibi; 15 §6.2a). Proje sahibi Meta'da yalnız tıklama yapar ve beş
// değeri girer; buradaki düğmeler sırasıyla: bilgileri göster (Meta'ya yapıştır) → bağlantıyı test et → numarayı
// etkinleştir (PIN) → webhook aboneliğini aç → şablonları gönder. Her aksiyon API'de denetim kaydına yazılır; gizli
// değerler ekranda yalnız "Göster" ile, token ve App secret hiçbir zaman (yalnız son 4 karakter) görünür.

import { useState, type FormEvent, type ReactNode } from 'react';
import { CircleCheck, CircleX, Copy, Eye, EyeOff, FileText, Info, KeyRound, PlugZap, RefreshCw, Send, TriangleAlert, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import type {
  AdminWaSetupRegister,
  AdminWaSetupReveal,
  AdminWaSetupStatus,
  AdminWaSetupSubscription,
  AdminWaSetupTest,
  AdminWaSetupTone,
  AdminWaTemplates,
} from '@siparis/core/admin/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { apiFetch, errorMessage, useApiQuery } from '@/lib/api';
import { InfoRow, QueryError } from './common';

const TONE_BADGE: Record<AdminWaSetupTone, 'success' | 'warning' | 'danger' | 'info'> = { ok: 'success', warn: 'warning', bad: 'danger', info: 'info' };
const TONE_ICON = { ok: CircleCheck, warn: TriangleAlert, bad: CircleX, info: Info } as const;

function ToneBadge({ tone, children }: { tone: AdminWaSetupTone; children: ReactNode }) {
  const Icon = TONE_ICON[tone];
  return (
    <Badge variant={TONE_BADGE[tone]} size="sm">
      <Icon aria-hidden />
      {children}
    </Badge>
  );
}

/** Tek seferlik istek durumu (yükleniyor / sonuç / hata). */
function useAction<T>() {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const run = async (fn: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      const r = await fn();
      setData(r);
      return r;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setLoading(false);
    }
  };
  const reset = () => {
    setData(null);
    setError(null);
  };
  return { data, error, loading, run, reset };
}

function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Alert variant="danger" title="İşlem tamamlanamadı">
      {errorMessage(error)}
    </Alert>
  );
}

function StepCard({ step, title, description, children }: { step: number; title: string; description: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-fg">
            {step}
          </span>
          <span>
            <span className="sr-only">Adım {step}: </span>
            {title}
          </span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

/** Adım çalıştırılamıyorsa nedeni (düğme pasif). */
function Blocked({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return <p className="text-sm text-fg-muted">{children}</p>;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} kopyalandı.`);
  } catch {
    toast.error('Kopyalanamadı; metni elle seçip kopyalayın.');
  }
}

function CopyRow({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
      <span className="text-sm font-semibold text-fg-muted">{label}</span>
      <code className="break-all font-mono text-sm text-fg">{value}</code>
      <span className="text-sm text-fg-muted">{hint}</span>
      <div>
        <Button variant="secondary" size="sm" onClick={() => void copy(value, label)}>
          <Copy aria-hidden />
          Kopyala
        </Button>
      </div>
    </div>
  );
}

function FieldState({ set, tail, missingText = 'Eksik' }: { set: boolean; tail: string | null; missingText?: string }) {
  return set ? (
    <span className="flex flex-wrap items-center gap-2">
      <ToneBadge tone="ok">Tanımlı</ToneBadge>
      {tail ? <span className="font-mono text-sm text-fg-muted">{tail}</span> : null}
    </span>
  ) : (
    <ToneBadge tone="bad">{missingText}</ToneBadge>
  );
}

const NOT_CLOUD = 'Bu adım yalnız Meta Cloud API bağlıyken çalışır (yukarıdaki sorun satırlarına bakın).';

export function WhatsappSetupSection() {
  const q = useApiQuery<AdminWaSetupStatus>(['admin', 'whatsapp', 'setup'], '/admin/whatsapp/setup');
  const s = q.data;

  return (
    <section aria-labelledby="wa-setup-title" className="mb-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="wa-setup-title" className="text-xl font-bold text-fg">
          WhatsApp kurulumu
        </h2>
        <p className="text-sm text-fg-muted">
          Ortak numarayı (Yemek Gelsin) gerçek WhatsApp’a bağlama adımları. Meta’daki tıklamalar ve girilecek değerler kurulum rehberinde (docs/15 §6.2a); geri kalanı
          buradaki düğmelerle sırayla yapılır. Her işlem denetim kaydına yazılır.
        </p>
      </div>
      {q.isError ? <QueryError error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isPending ? <Spinner label="Kurulum durumu yükleniyor" /> : null}
      {s ? (
        <>
          <SetupStatusCard s={s} />
          <RevealStep />
          <TestStep s={s} />
          <RegisterStep s={s} />
          <SubscribeStep s={s} />
          <TemplatesStep s={s} />
        </>
      ) : null}
    </section>
  );
}

function SetupStatusCard({ s }: { s: AdminWaSetupStatus }) {
  const f = s.fields;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Kurulum durumu</CardTitle>
          {s.problems.length ? <ToneBadge tone="warn">Eksik var</ToneBadge> : <ToneBadge tone="ok">Bilgiler tam</ToneBadge>}
        </div>
        <CardDescription>Gizli değerler gösterilmez; yalnız son 4 karakter. Değerler sunucunun ortam değişkenlerinden okunur.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {s.problems.length ? (
          <ul className="flex flex-col gap-2 rounded-md bg-warning-bg p-3 text-sm text-fg">
            {s.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        <dl className="grid gap-x-6 divide-y divide-border lg:grid-cols-2 lg:divide-y-0">
          <InfoRow label="Sağlayıcı">
            <span className="flex flex-wrap items-center gap-2">
              {s.providerLabel}
              {s.provider === 'cloud' ? <ToneBadge tone="ok">Gerçek WhatsApp</ToneBadge> : s.provider === 'mock' ? <ToneBadge tone="warn">Simülatör</ToneBadge> : null}
            </span>
          </InfoRow>
          <InfoRow label="Numara">{s.displayPhoneFormatted ?? <ToneBadge tone="bad">Tanımlı değil</ToneBadge>}</InfoRow>
          <InfoRow label="Phone number ID">
            <FieldState {...f.phoneNumberId} />
          </InfoRow>
          <InfoRow label="WABA ID">
            <FieldState {...f.wabaId} />
          </InfoRow>
          <InfoRow label="Erişim anahtarı (token)">
            <FieldState {...f.apiKey} />
          </InfoRow>
          <InfoRow label="App secret">
            <FieldState {...f.appSecret} />
          </InfoRow>
          <InfoRow label="Webhook belirteci">
            <FieldState {...f.webhookToken} />
          </InfoRow>
          <InfoRow label="Doğrulama belirteci">
            <FieldState set={f.verifyToken.set} tail={f.verifyToken.tail} missingText={f.verifyToken.isDefault ? 'Varsayılan değer' : 'Eksik'} />
          </InfoRow>
          <InfoRow label="Graph API sürümü">{s.graphApiVersion}</InfoRow>
        </dl>
      </CardContent>
    </Card>
  );
}

function RevealStep() {
  const a = useAction<AdminWaSetupReveal>();
  const shown = a.data;
  return (
    <StepCard
      step={1}
      title="Meta’ya girilecek bilgiler"
      description="Webhook adresi ve doğrulama belirteci gizlidir; yalnız Meta’ya yapıştırmak için gösterin. Gösterme işlemi denetim kaydına yazılır."
    >
      <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm leading-6 text-fg">
        <li>
          developers.facebook.com › uygulamanız › <strong>WhatsApp › Configuration (Yapılandırma)</strong> › Webhook › <strong>Edit (Düzenle)</strong>.
        </li>
        <li>
          <strong>Callback URL</strong> kutusuna aşağıdaki webhook adresini, <strong>Verify token</strong> kutusuna doğrulama belirtecini yapıştırın.
        </li>
        <li>
          <strong>Verify and save (Doğrula ve kaydet)</strong> düğmesine basın.
        </li>
        <li>
          Aynı sayfada <strong>Webhook fields › Manage</strong> › <strong>messages</strong> satırında <strong>Subscribe (Abone ol)</strong>.
        </li>
      </ol>
      <div className="flex flex-wrap gap-2">
        {shown ? (
          <Button variant="secondary" onClick={a.reset}>
            <EyeOff aria-hidden />
            Gizle
          </Button>
        ) : (
          <Button loading={a.loading} onClick={() => void a.run(() => apiFetch<AdminWaSetupReveal>('/admin/whatsapp/setup/reveal', { method: 'POST' }))}>
            <Eye aria-hidden />
            Göster
          </Button>
        )}
      </div>
      <ActionError error={a.error} />
      {shown ? (
        <div className="flex flex-col gap-3">
          {shown.webhookUrl ? (
            <CopyRow label="Webhook adresi (Callback URL)" value={shown.webhookUrl} hint="Meta › WhatsApp › Configuration › Callback URL" />
          ) : (
            <Alert variant="warning" title="Webhook adresi oluşmadı">
              PLATFORM_WA_WEBHOOK_TOKEN tanımlı değil. Değeri verip sunucuyu yeniden başlatın (Cloudflare dev’de iş akışı kendiliğinden üretir).
            </Alert>
          )}
          <CopyRow label="Doğrulama belirteci (Verify token)" value={shown.verifyToken} hint="Meta › WhatsApp › Configuration › Verify token" />
          <p className="text-sm text-fg-muted">
            Abone olunacak webhook alanı: <code className="font-mono">{shown.webhookField}</code>
          </p>
        </div>
      ) : null}
    </StepCard>
  );
}

function TestStep({ s }: { s: AdminWaSetupStatus }) {
  const a = useAction<AdminWaSetupTest>();
  const r = a.data;
  return (
    <StepCard step={2} title="Bağlantıyı test et" description="Token ve telefon numarası kimliğiyle Meta’dan numaranın durumunu okur. Mesaj göndermez.">
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!s.actions.test}
          loading={a.loading}
          onClick={() => void a.run(() => apiFetch<AdminWaSetupTest>('/admin/whatsapp/setup/test', { method: 'POST' }))}
        >
          <PlugZap aria-hidden />
          Bağlantıyı test et
        </Button>
      </div>
      <Blocked show={!s.actions.test}>{NOT_CLOUD}</Blocked>
      <ActionError error={a.error} />
      {r ? (
        <div className="flex flex-col gap-3">
          <Alert variant={r.ready ? 'success' : 'warning'} title={r.ready ? 'Bağlantı çalışıyor, numara kullanıma hazır.' : 'Bağlantı çalışıyor ama numara henüz hazır değil.'}>
            {r.hints.length ? (
              <ul className="flex list-disc flex-col gap-1 ps-5">
                {r.hints.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
          <dl className="grid gap-x-6 divide-y divide-border lg:grid-cols-2 lg:divide-y-0">
            {r.rows.map((row) => (
              <InfoRow key={row.label} label={row.label}>
                <ToneBadge tone={row.tone}>{row.value}</ToneBadge>
              </InfoRow>
            ))}
          </dl>
        </div>
      ) : null}
    </StepCard>
  );
}

function RegisterStep({ s }: { s: AdminWaSetupStatus }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [errors, setErrors] = useState<{ pin?: string; pin2?: string }>({});
  const a = useAction<AdminWaSetupRegister>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: { pin?: string; pin2?: string } = {};
    if (!/^\d{6}$/.test(pin)) next.pin = 'PIN 6 haneli bir sayı olmalı.';
    else if (pin !== pin2) next.pin2 = 'İki PIN aynı değil.';
    setErrors(next);
    if (next.pin || next.pin2) return;
    const r = await a.run(() => apiFetch<AdminWaSetupRegister>('/admin/whatsapp/setup/register', { method: 'POST', body: { pin } }));
    if (r) {
      setPin('');
      setPin2('');
      toast.success('Numara etkinleştirildi.');
    }
  };

  return (
    <StepCard
      step={3}
      title="Numarayı etkinleştir"
      description="Numarayı Cloud API’ye kaydeder. Bağlantı testinde “Cloud API kaydı: Kayıtlı değil” görünüyorsa bu adımı yapın; kayıtlıysa gerekmez."
    >
      <Alert variant="info" title="PIN nedir?">
        Bu PIN numaranın <strong>WhatsApp iki adımlı doğrulama PIN’idir</strong>. 6 haneli bir sayıyı siz seçersiniz; parola yöneticinize kaydedin ve unutmayın: numarayı
        yeniden kaydetmek ya da başka bir yere taşımak için gerekir. Numarada daha önce PIN belirlendiyse aynı PIN’i girin. PIN hiçbir yerde saklanmaz ve denetim kaydına
        yazılmaz.
      </Alert>
      <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="6 haneli PIN" required error={errors.pin}>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={!s.actions.register}
            />
          </Field>
          <Field label="PIN’i tekrar girin" required error={errors.pin2}>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={!s.actions.register}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!s.actions.register} loading={a.loading}>
            <KeyRound aria-hidden />
            Numarayı etkinleştir
          </Button>
        </div>
      </form>
      <Blocked show={!s.actions.register}>{NOT_CLOUD}</Blocked>
      <ActionError error={a.error} />
      {a.data ? <Alert variant="success" title="Numara etkinleştirildi">{a.data.message}</Alert> : null}
    </StepCard>
  );
}

function SubscribeStep({ s }: { s: AdminWaSetupStatus }) {
  const a = useAction<AdminWaSetupSubscription>();
  const r = a.data;
  return (
    <StepCard
      step={4}
      title="Webhook aboneliğini aç"
      description="Uygulamanızı WhatsApp hesabına (WABA) abone eder; gelen mesajlar ancak bundan sonra webhook adresine düşer. Tekrar basmak zararsızdır."
    >
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!s.actions.subscribe}
          loading={a.loading}
          onClick={() => void a.run(() => apiFetch<AdminWaSetupSubscription>('/admin/whatsapp/setup/subscription', { method: 'POST' }))}
        >
          <Webhook aria-hidden />
          Webhook aboneliğini aç
        </Button>
        <Button
          variant="secondary"
          disabled={!s.actions.subscribe || a.loading}
          onClick={() => void a.run(() => apiFetch<AdminWaSetupSubscription>('/admin/whatsapp/setup/subscription'))}
        >
          <RefreshCw aria-hidden />
          Aboneliği kontrol et
        </Button>
      </div>
      <Blocked show={!s.actions.subscribe}>{s.provider === 'cloud' && !s.fields.wabaId.set ? 'WABA ID tanımlı değil (yukarıdaki sorun satırları).' : NOT_CLOUD}</Blocked>
      <ActionError error={a.error} />
      {r ? (
        <Alert variant={r.subscribed ? 'success' : 'warning'} title={r.subscribed ? 'Abonelik açık' : 'Abonelik yok'}>
          {r.message}
        </Alert>
      ) : null}
    </StepCard>
  );
}

const AUDIENCE_LABEL = { customer: 'Müşteriye', platform: 'İşletmeye' } as const;

function TemplatesStep({ s }: { s: AdminWaSetupStatus }) {
  const a = useAction<AdminWaTemplates>();
  const r = a.data;
  const blockedText =
    s.provider !== 'cloud' || !s.fields.apiKey.set
      ? NOT_CLOUD
      : !s.fields.wabaId.set
        ? 'WABA ID tanımlı değil (yukarıdaki sorun satırları).'
        : 'APP_BASE_URL https ile başlamalı (şablon butonlarındaki bağlantılar).';
  return (
    <StepCard
      step={5}
      title="Mesaj şablonlarını Meta’ya gönder"
      description="Sistemin kullandığı tüm şablonları (sipariş durumu ve işletme uyarıları) Meta’da yoksa oluşturur; var olanlara dokunmaz, hiçbir şey silmez. Meta genelde dakikalar içinde onaylar."
    >
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!s.actions.templates}
          loading={a.loading}
          onClick={() => void a.run(() => apiFetch<AdminWaTemplates>('/admin/whatsapp/setup/templates', { method: 'POST' }))}
        >
          <Send aria-hidden />
          Şablonları Meta’ya gönder
        </Button>
        <Button
          variant="secondary"
          disabled={!s.actions.subscribe || a.loading}
          onClick={() => void a.run(() => apiFetch<AdminWaTemplates>('/admin/whatsapp/setup/templates'))}
        >
          <RefreshCw aria-hidden />
          Durumu yenile
        </Button>
      </div>
      <Blocked show={!s.actions.templates}>{blockedText}</Blocked>
      <ActionError error={a.error} />
      {r ? <TemplateResults r={r} /> : null}
    </StepCard>
  );
}

function TemplateResults({ r }: { r: AdminWaTemplates }) {
  const sm = r.summary;
  return (
    <div className="flex flex-col gap-3">
      {r.sync ? (
        <Alert variant={r.sync.failed.length ? 'warning' : 'success'} title="Gönderim tamamlandı">
          <p>
            {r.sync.created.length} şablon oluşturuldu, {r.sync.skipped.length} şablon zaten vardı
            {r.sync.failed.length ? `, ${r.sync.failed.length} şablon oluşturulamadı` : ''}.
          </p>
          {r.sync.failed.length ? (
            <ul className="mt-1 flex list-disc flex-col gap-1 ps-5">
              {r.sync.failed.map((f) => (
                <li key={f.name}>
                  <code className="font-mono">{f.name}</code>: {f.message}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2" aria-label="Şablon özeti">
        <Badge variant="neutral">Toplam {sm.total}</Badge>
        <Badge variant="success">Onaylı {sm.approved}</Badge>
        <Badge variant="warning">İncelemede {sm.pending}</Badge>
        <Badge variant="danger">Sorunlu {sm.rejected}</Badge>
        <Badge variant="info">Meta’da yok {sm.missing}</Badge>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {r.templates.map((t) => (
          <li key={t.name} className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <FileText aria-hidden className="size-4 shrink-0 text-fg-muted" />
                <code className="break-all font-mono text-sm font-semibold">{t.name}</code>
                <Badge variant="outline" size="sm">
                  {AUDIENCE_LABEL[t.audience]}
                </Badge>
              </span>
              <ToneBadge tone={t.tone}>{t.statusLabel}</ToneBadge>
            </div>
            {t.rejectedReasonLabel ? <p className="text-sm text-fg">Ret sebebi: {t.rejectedReasonLabel}</p> : null}
            {t.categoryChanged ? (
              <p className="text-sm text-fg">
                <ToneBadge tone="bad">Kategori {t.category}</ToneBadge> Meta kategoriyi değiştirdi; bu şablon durum bildirimi için kullanılmamalı (yeni sürüm gerekir).
              </p>
            ) : null}
            <details className="text-sm text-fg-muted">
              <summary className="flex min-h-hit cursor-pointer items-center">Metni göster</summary>
              <p className="whitespace-pre-wrap">{t.body}</p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
