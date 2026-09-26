'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BellRing,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  ClipboardList,
  ExternalLink,
  MessageCircle,
  MessageCircleOff,
  PartyPopper,
  QrCode,
  Rocket,
  ShoppingBag,
  UtensilsCrossed,
} from 'lucide-react';
import type { OnboardingStatus, OnboardingStepCode } from '@siparis/core/settings/contracts';
import { AlertTriangleIcon } from './icons';
import { BusinessForm } from '@/components/settings/business-form';
import { HoursEditor } from '@/components/settings/hours-editor';
import { PaymentForm } from '@/components/settings/branch-options';
import { ZonesManager } from '@/components/settings/zones-manager';
import { SETTINGS_KEYS, useBranchId, useBranchSettings, useOnboarding, useUpdateBranch } from '@/components/settings/api';
import { LocationPicker, type LatLng } from '@/components/settings/map/location-picker';
import { Section, SettingsError, SettingsLoading } from '@/components/settings/settings-shell';
import { publicStorefrontUrl } from '@/components/settings/urls';
import { QrDownloadLinks, qrDownloadHref } from '@/components/whatsapp/shop-qr';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { apiFetch, errorMessage } from '@/lib/api';
import { currentRole, ME_QUERY_KEY, useMe } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatPhone } from '@/lib/format';

const STEP_ICONS: Record<OnboardingStepCode, typeof Check> = {
  business_info: ClipboardList,
  menu: UtensilsCrossed,
  hours: Clock,
  zones: ShoppingBag,
  whatsapp: MessageCircle,
  test_order: BellRing,
  go_live: Rocket,
};

/** Onboarding sihirbazı (04 §3, P-38): ilerleme çubuğu, adım formları gömülü, WhatsApp'sız başla, test siparişi, canlıya geç. */
export function OnboardingWizard() {
  const q = useOnboarding();
  const qc = useQueryClient();
  const [current, setCurrent] = useState<OnboardingStepCode | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  // İlk açılışta kalınan adım: ilk tamamlanmamış adım
  useEffect(() => {
    if (q.data && !current) {
      const first = q.data.steps.find((s) => !s.done)?.code ?? 'go_live';
      setCurrent(first);
    }
  }, [q.data, current]);

  const refresh = () => void qc.invalidateQueries({ queryKey: SETTINGS_KEYS.onboarding });

  if (q.isPending) return <SettingsLoading rows={3} />;
  if (q.isError) return <SettingsError error={q.error} onRetry={() => void q.refetch()} />;
  const status = q.data;
  const idx = Math.max(0, status.steps.findIndex((s) => s.code === current));
  const step = status.steps[idx]!;
  const pct = Math.round((status.doneCount / status.totalCount) * 100);
  const go = (delta: number) => setCurrent(status.steps[Math.min(status.steps.length - 1, Math.max(0, idx + delta))]!.code);

  if (celebrate) return <Congrats status={status} />;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-fg sm:text-3xl">İşletmenizi hazırlayalım</h1>
            <p className="text-base text-fg-muted">Adımları istediğiniz sırayla tamamlayabilirsiniz; her değişiklik kaydedilir.</p>
          </div>
          <Link href="/panel" className={buttonVariants({ variant: 'ghost' })}>
            Sonra devam et
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="h-3 flex-1 overflow-hidden rounded-full bg-surface"
            role="progressbar"
            aria-label="Kurulum ilerlemesi"
            aria-valuemin={0}
            aria-valuemax={status.totalCount}
            aria-valuenow={status.doneCount}
          >
            <div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-sm font-semibold text-fg">
            {status.doneCount}/{status.totalCount}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Kurulum adımları" className="relative flex min-w-0 gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {status.steps.map((s, i) => {
            const Icon = STEP_ICONS[s.code];
            const active = s.code === step.code;
            return (
              <button
                key={s.code}
                type="button"
                onClick={() => setCurrent(s.code)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex min-h-hit shrink-0 items-center gap-3 rounded-md border px-3 text-start text-sm font-semibold transition-colors lg:w-full',
                  active ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface-raised text-fg hover:bg-accent',
                )}
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border',
                    s.done ? 'border-success bg-success text-success-fg' : active ? 'border-primary-fg' : 'border-border-strong',
                  )}
                >
                  {s.done ? <Check aria-hidden className="size-4" /> : <span className="text-xs">{i + 1}</span>}
                </span>
                <Icon aria-hidden className="hidden size-4 lg:block" />
                <span className="whitespace-nowrap">{s.label}</span>
                <span className="sr-only">{s.done ? '(tamamlandı)' : '(eksik)'}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-fg">
              {idx + 1}. {step.label}
            </h2>
            {step.done ? <Badge variant="success">Tamam</Badge> : step.requiredForWeb ? <Badge variant="warning">Gerekli</Badge> : <Badge variant="neutral">Önerilir</Badge>}
            {step.detail ? <span className="text-sm text-fg-muted">{step.detail}</span> : null}
          </div>

          <StepBody code={step.code} status={status} onChanged={refresh} onLive={() => setCelebrate(true)} />

          <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
            <Button variant="secondary" onClick={() => go(-1)} disabled={idx === 0}>
              <ChevronLeft aria-hidden />
              Geri
            </Button>
            {idx < status.steps.length - 1 ? (
              <Button onClick={() => go(1)}>
                {step.done ? 'Sonraki adım' : 'Bu adımı atla'}
                <ChevronRight aria-hidden />
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepBody({ code, status, onChanged, onLive }: { code: OnboardingStepCode; status: OnboardingStatus; onChanged: () => void; onLive: () => void }) {
  switch (code) {
    case 'business_info':
      return (
        <div className="flex flex-col gap-4">
          <BranchAddressMini onSaved={onChanged} />
          <BusinessForm embedded onSaved={onChanged} />
        </div>
      );
    case 'menu':
      return <MenuStep status={status} onRefresh={onChanged} />;
    case 'hours':
      return <HoursEditor onSaved={onChanged} />;
    case 'zones':
      return (
        <div className="flex flex-col gap-4">
          <ZonesManager />
          <PaymentForm onSaved={onChanged} />
          <Button variant="secondary" onClick={onChanged} className="self-start">
            Durumu yenile
          </Button>
        </div>
      );
    case 'whatsapp':
      return <WhatsappStep status={status} onChanged={onChanged} />;
    case 'test_order':
      return <TestOrderStep status={status} onChanged={onChanged} />;
    case 'go_live':
      return <GoLiveStep status={status} onLive={onLive} onChanged={onChanged} />;
  }
}

/** İşletme adımı için şube adresi + konum (künyede adres gerekir). */
function BranchAddressMini({ onSaved }: { onSaved: () => void }) {
  const branchId = useBranchId();
  const q = useBranchSettings(branchId);
  const update = useUpdateBranch(branchId);
  const [address, setAddress] = useState<string | null>(null);
  const [neighborhood, setNeighborhood] = useState<string | null>(null);
  const [loc, setLoc] = useState<LatLng | null | undefined>(undefined);
  if (!q.data) return null;
  const a = address ?? q.data.addressLine ?? '';
  const n = neighborhood ?? q.data.neighborhood ?? '';
  const l = loc === undefined ? (q.data.lat != null && q.data.lng != null ? { lat: q.data.lat, lng: q.data.lng } : null) : loc;
  const dirty = a !== (q.data.addressLine ?? '') || n !== (q.data.neighborhood ?? '') || l?.lat !== (q.data.lat ?? undefined) || l?.lng !== (q.data.lng ?? undefined);
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        addressLine: a.trim() || null,
        neighborhood: n.trim() || null,
        ...(l ? { lat: l.lat, lng: l.lng } : {}),
      });
      toast.success('Şube adresi kaydedildi.');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err, 'Adres kaydedilemedi.'));
    }
  }
  return (
    <form onSubmit={save} noValidate>
      <Section title="Şube adresi ve konumu" description="Müşteri ve kurye için; haritadan pin seçin.">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Açık adres">
            <Input value={a} onChange={(e) => setAddress(e.target.value)} maxLength={300} placeholder="Cadde, sokak, bina no" />
          </Field>
          <Field label="Mahalle">
            <Input value={n} onChange={(e) => setNeighborhood(e.target.value)} maxLength={60} />
          </Field>
        </div>
        <LocationPicker value={l} onChange={setLoc} />
        <div>
          <Button type="submit" loading={update.isPending} disabled={!dirty}>
            Adresi kaydet
          </Button>
        </div>
      </Section>
    </form>
  );
}

function MenuStep({ status, onRefresh }: { status: OnboardingStatus; onRefresh: () => void }) {
  const step = status.steps.find((s) => s.code === 'menu')!;
  return (
    <Section title="Menünüzü ekleyin" description="Kategori ve ürünleri fiyatlarıyla girin. 15 ürünlük bir menü birkaç dakikada girilir.">
      <p className="text-base text-fg">{step.done ? `${step.detail}. İstediğiniz zaman menü sayfasından değiştirebilirsiniz.` : 'Henüz aktif ürün yok.'}</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/panel/menu" className={buttonVariants({ variant: step.done ? 'secondary' : 'primary', size: 'lg' })}>
          <UtensilsCrossed aria-hidden />
          Menüyü düzenle
        </Link>
        <Button variant="ghost" size="lg" onClick={onRefresh}>
          Kontrol et
        </Button>
      </div>
      <p className="text-sm text-fg-muted">Menünüz kalabalıksa fotoğrafını ekibimize gönderin; biz hazırlayalım, siz fiyatları onaylayın.</p>
    </Section>
  );
}

function WhatsappStep({ status, onChanged }: { status: OnboardingStatus; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const me = useMe();
  const isOwner = currentRole(me.data) === 'owner';
  async function setWhatsappless(enabled: boolean) {
    setBusy(true);
    try {
      await apiFetch('/panel/onboarding/whatsappless', { method: 'POST', body: { enabled } });
      toast.success(enabled ? 'WhatsApp’sız başlıyorsunuz. Siparişler web ve SMS doğrulamasıyla gelir.' : 'Seçim geri alındı.');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  // Ortak numara (00 §12a madde 8): kayıtta hazırdır, adım kendiliğinden tamamdır; QR kodu burada da gösterilir
  if (status.whatsapp.connected && status.whatsapp.mode === 'shared') {
    return <SharedWhatsappReady code={status.whatsapp.code ?? null} displayPhone={status.whatsapp.displayPhone} isOwner={isOwner} />;
  }
  if (status.whatsapp.connected) {
    return (
      <Section title="WhatsApp bağlı">
        <p className="text-base text-fg">Numaranız bağlı: {status.whatsapp.displayPhone}. Müşterileriniz WhatsApp’tan yazınca menü bağlantısı otomatik gider.</p>
      </Section>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title="WhatsApp’ı bağla (önerilen)" description="Müşteri yazınca menü bağlantısı ve durum mesajları otomatik gider.">
        <p className="text-sm text-fg-muted">
          Numaranızı aracı firmanın ekranından bağlarsınız; aldığınız anahtarı WhatsApp ayarlarına girersiniz. Bağlantıyı yalnız işletme sahibi yapar.
        </p>
        {isOwner ? (
          <Link href="/panel/ayarlar/whatsapp" className={buttonVariants({ size: 'lg' })}>
            <MessageCircle aria-hidden />
            WhatsApp ayarlarına git
          </Link>
        ) : (
          <p className="text-sm font-semibold text-fg">İşletme sahibinden bu adımı tamamlamasını isteyin.</p>
        )}
      </Section>
      <Section title="WhatsApp’sız başla" description="Meta adımları bitmeden bugün web siparişi almaya başlayın.">
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-fg">
          <li>Müşteri siparişini SMS koduyla doğrular.</li>
          <li>Onaylandı, ret ve iptal bilgisi SMS ile gider; diğer durumlar takip sayfasında.</li>
          <li>Telefon siparişi normal çalışır. WhatsApp’ı sonra bağlayınca mod kendiliğinden kapanır.</li>
        </ul>
        {status.whatsapp.whatsappless ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">Seçildi</Badge>
            <Button variant="ghost" onClick={() => void setWhatsappless(false)} loading={busy}>
              Geri al
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="lg" onClick={() => void setWhatsappless(true)} loading={busy}>
            <MessageCircleOff aria-hidden />
            WhatsApp’sız başla
          </Button>
        )}
      </Section>
    </div>
  );
}

/** Ortak numarada WhatsApp adımı: yapılacak bir şey yok; dükkan kodu ve QR (GET /panel/whatsapp/qr, owner + manager). */
function SharedWhatsappReady({ code, displayPhone, isOwner }: { code: string | null; displayPhone: string | null; isOwner: boolean }) {
  const [qrFailed, setQrFailed] = useState(false);
  return (
    <Section
      title={
        <span className="flex flex-wrap items-center gap-2">
          WhatsApp hazır
          <Badge variant="success" size="sm">
            <Check aria-hidden />
            Tamam
          </Badge>
        </span>
      }
      description="Siparişleriniz ortak Siparişin Önünde numarasından gelir; ayrıca numara bağlamanız gerekmez."
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {!qrFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDownloadHref('svg')}
            alt={code ? `Dükkan QR kodu (#${code})` : 'Dükkan QR kodu'}
            width={176}
            height={176}
            onError={() => setQrFailed(true)}
            className="size-44 shrink-0 self-center rounded-md border border-border bg-white sm:self-start"
          />
        ) : null}
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-base text-fg">
            Dükkan kodunuz <span className="font-mono text-xl font-bold tracking-wide">{code ? `#${code}` : '—'}</span>
            {displayPhone ? (
              <>
                {' '}
                · WhatsApp numarası <span className="whitespace-nowrap font-semibold">{formatPhone(displayPhone)}</span>
              </>
            ) : null}
          </p>
          <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-fg">
            <li>Müşteri QR kodunuzu okutunca WhatsApp dükkan kodunuzla açılır; bot dükkanınızın adıyla karşılar ve menü bağlantısını gönderir.</li>
            <li>Her mesajda dükkanınızın adı görünür; siparişler bu panele düşer, başka dükkanlarla karışmaz.</li>
            <li>QR’ı masaya, kapıya ve paketlere koyun; afiş ve masa kartı hazır.</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <QrDownloadLinks />
            <Link href={isOwner ? '/panel/ayarlar/whatsapp' : '/panel/ayarlar/qr'} className={buttonVariants({ variant: 'ghost' })}>
              <QrCode aria-hidden />
              {isOwner ? 'Bağlantı ve masa kartı' : 'QR ve afiş'}
            </Link>
          </div>
        </div>
      </div>
    </Section>
  );
}

function TestOrderStep({ status, onChanged }: { status: OnboardingStatus; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const open = status.testOrder && ['new', 'accepted', 'preparing', 'ready', 'on_the_way'].includes(status.testOrder.status);

  // Test siparişi açıkken durumunu 5 sn'de bir tazele
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => void qc.invalidateQueries({ queryKey: SETTINGS_KEYS.onboarding }), 5000);
    return () => window.clearInterval(t);
  }, [open, qc]);

  async function create() {
    setBusy(true);
    try {
      await apiFetch('/panel/onboarding/test-order', { method: 'POST' });
      toast.success('Test siparişi oluşturuldu. Canlı ekranda görün ve onaylayın.');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err, 'Test siparişi oluşturulamadı.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="İlk siparişi deneyin" description="Test siparişi raporlara, müşteri listesine ve faturaya girmez.">
      <ol className="grid gap-3 sm:grid-cols-3">
        {[
          { n: 1, t: 'Test siparişi oluştur', d: 'Menünüzdeki ilk üründen bir sipariş.' },
          { n: 2, t: 'Sesi duy', d: 'Canlı ekranda “Vardiyayı başlat”a basın; kart kırmızı yanıp söner.' },
          { n: 3, t: 'Onayla’ya bas', d: 'Onaylayınca müşteri tarafı “Onaylandı” bilgisini alır.' },
        ].map((s) => (
          <li key={s.n} className="flex flex-col gap-1 rounded-md bg-surface p-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-fg">{s.n}</span>
            <span className="font-semibold text-fg">{s.t}</span>
            <span className="text-sm text-fg-muted">{s.d}</span>
          </li>
        ))}
      </ol>
      {status.testOrder ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
          <span className="font-semibold text-fg">Test siparişi #{status.testOrder.number}</span>
          <StatusBadge status={status.testOrder.status} />
          <Badge variant="ink" size="sm">
            TEST
          </Badge>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={() => void create()} loading={busy} disabled={Boolean(open)}>
          <BellRing aria-hidden />
          {status.testOrder ? 'Yeni test siparişi' : 'Test siparişi oluştur'}
        </Button>
        {status.testOrder ? (
          <Link href="/panel" className={buttonVariants({ variant: open ? 'primary' : 'secondary', size: 'lg' })}>
            Canlı ekranda görün ve onaylayın
            <ExternalLink aria-hidden />
          </Link>
        ) : null}
      </div>
    </Section>
  );
}

function GoLiveStep({ status, onLive, onChanged }: { status: OnboardingStatus; onLive: () => void; onChanged: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const isOwner = currentRole(me.data) === 'owner';
  const [busy, setBusy] = useState(false);
  const checklist = useMemo(
    () => status.steps.filter((s) => s.code !== 'go_live').map((s) => ({ label: s.label, done: s.done, required: s.requiredForWeb, missing: s.missing })),
    [status.steps],
  );
  async function goLive() {
    setBusy(true);
    try {
      await apiFetch('/panel/onboarding/go-live', { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      onChanged();
      onLive();
    } catch (err) {
      toast.error(errorMessage(err, 'Canlıya geçilemedi.'));
    } finally {
      setBusy(false);
    }
  }
  const live = status.liveAt != null;
  const webLive = status.webLiveAt != null;
  return (
    <Section title="Canlıya geç" description="Zorunlu adımlar tamamsa mağazanız web siparişine açılır; WhatsApp bağlı ve test siparişi verilmişse tam canlıya geçersiniz.">
      <ul className="flex flex-col gap-2">
        {checklist.map((c) => (
          <li key={c.label} className="flex items-start gap-3">
            <span
              className={cn(
                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border',
                c.done ? 'border-success bg-success text-success-fg' : c.required ? 'border-destructive text-destructive' : 'border-border-strong text-fg-muted',
              )}
            >
              {c.done ? <Check aria-hidden className="size-4" /> : c.required ? <AlertTriangleIcon /> : <Circle aria-hidden className="size-3" />}
            </span>
            <span className="flex flex-col">
              <span className="font-semibold text-fg">
                {c.label}
                {!c.done ? <span className="ms-2 text-sm font-normal text-fg-muted">{c.required ? 'Zorunlu' : 'Önerilir'}</span> : null}
              </span>
              {!c.done && c.missing.length ? <span className="text-sm text-fg-muted">{c.missing.join(', ')}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {live ? (
        <p className="font-semibold text-success">İşletmeniz canlıda.</p>
      ) : webLive ? (
        <p className="text-sm text-fg">Web siparişine açıksınız. {status.missingForFull.length ? `Tam canlı için: ${status.missingForFull.join('; ')}` : ''}</p>
      ) : null}
      {isOwner ? (
        <Button size="xl" onClick={() => void goLive()} loading={busy} disabled={!status.canGoLiveWeb || live}>
          <Rocket aria-hidden />
          {live ? 'Canlıdasınız' : webLive && status.canGoLiveFull ? 'Tam canlıya geç' : 'Canlıya geç'}
        </Button>
      ) : (
        <p className="text-sm font-semibold text-fg">Canlıya geçişi işletme sahibi yapar.</p>
      )}
      {!status.canGoLiveWeb ? <p className="text-sm text-fg-muted">Önce zorunlu adımları tamamlayın.</p> : null}
    </Section>
  );
}

function Congrats({ status }: { status: OnboardingStatus }) {
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(publicStorefrontUrl(status.slug)), [status.slug]);
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-10 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-success text-success-fg">
        <PartyPopper aria-hidden className="size-8" />
      </span>
      <h1 className="text-3xl font-bold text-fg">Tebrikler, yayındasınız!</h1>
      <p className="text-base text-fg-muted">
        Mağazanız sipariş almaya hazır. Şimdi müşterilerinize duyurun: kapıya afiş, paketlere kart, Instagram profilinize bağlantı.
      </p>
      {url ? <p className="break-all rounded-md bg-surface p-3 font-mono text-sm text-fg">{url}</p> : null}
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/panel/ayarlar/qr" className={buttonVariants({ size: 'lg' })}>
          <QrCode aria-hidden />
          QR ve afiş hazırla
        </Link>
        <Link href="/panel" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
          Canlı siparişlere git
        </Link>
      </div>
    </div>
  );
}
