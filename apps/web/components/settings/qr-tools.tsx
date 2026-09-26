'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Copy, Download, Printer, TriangleAlert } from 'lucide-react';
import { normalizeTrMobile, SHARED_WA_DISPLAY_NAME, sharedWaLink } from '@siparis/core';
import { brandPalette } from '@siparis/core/settings/brand';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { formatPhone } from '@/lib/format';
import { useOnboarding, useTenantSettings } from './api';
import { Section, SettingsError, SettingsLoading } from './settings-shell';
import { publicStorefrontUrl, waMeUrl } from './urls';

const HEADLINES = ['WhatsApp’tan doğrudan sipariş verin', 'Menümüz cebinizde', 'Komisyonsuz, doğrudan bizden sipariş'];

async function qrDataUrl(text: string, width = 1024): Promise<string> {
  // 12 §7.5: hata düzeltme M, sessiz bölge ≥ 4 modül, tek renk siyah
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 4, width, color: { dark: '#000000', light: '#ffffff' } });
}

function useQr(text: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!text) {
      setSrc(null);
      return;
    }
    void qrDataUrl(text).then((s) => alive && setSrc(s));
    return () => {
      alive = false;
    };
  }, [text]);
  return src;
}

/** QR, afiş ve paket kartı oluşturucu (04 §12.1, 12 §7). */
export function QrTools() {
  const tenant = useTenantSettings();
  const onboarding = useOnboarding();
  const [waNumber, setWaNumber] = useState('');
  const [headline, setHeadline] = useState(HEADLINES[0]!);
  const [subline, setSubline] = useState('');
  const [printTarget, setPrintTarget] = useState<'poster' | 'card' | null>(null);
  const [origin, setOrigin] = useState('');

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (waNumber || !tenant.data) return;
    const n = onboarding.data?.whatsapp.displayPhone ?? normalizeTrMobile(tenant.data.phone);
    if (n) setWaNumber(n);
  }, [tenant.data, onboarding.data, waNumber]);

  const slug = tenant.data?.slug ?? '';
  const storeUrl = slug && origin ? publicStorefrontUrl(slug, '?src=afis') : null;
  const standUrl = slug && origin ? publicStorefrontUrl(slug, '?src=stand') : null;
  // Ortak numara (00 §12a madde 8): QR platform numarasına dükkan kodlu ön-dolu mesajla açılır (#KOD); numara elle girilmez
  const wa = onboarding.data?.whatsapp;
  const shared = wa?.mode === 'shared' && wa.connected && wa.displayPhone && wa.code && tenant.data ? { phone: wa.displayPhone, code: wa.code } : null;
  const e164 = shared ? shared.phone : normalizeTrMobile(waNumber);
  const waUrl = shared ? sharedWaLink(shared.phone, tenant.data!.name, shared.code) : e164 ? waMeUrl(e164) : null;
  const storeQr = useQr(storeUrl);
  const standQr = useQr(standUrl);
  const waQr = useQr(waUrl);

  useEffect(() => {
    if (!printTarget) return;
    const t = window.setTimeout(() => {
      window.print();
      setPrintTarget(null);
    }, 50);
    return () => window.clearTimeout(t);
  }, [printTarget]);

  if (tenant.isPending) return <SettingsLoading />;
  if (tenant.isError) return <SettingsError error={tenant.error} onRetry={() => void tenant.refetch()} />;
  const t = tenant.data;
  const palette = brandPalette(t.brandColor);
  const kvkk = shared
    ? `Sohbette “${SHARED_WA_DISPLAY_NAME}” adı görünür; numaranızı yalnız ${t.name} siparişiniz için kullanır.`
    : `WhatsApp'tan yazdığınızda numaranız yalnız ${t.name} tarafından siparişiniz için kullanılır.`;

  async function copy(text: string | null) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Kopyalandı.');
    } catch {
      toast.error('Kopyalanamadı.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #print-poster, #print-poster *, #print-card, #print-card * { visibility: visible !important; }
        #print-poster, #print-card { position: absolute !important; inset: 0 auto auto 0 !important; margin: 0 !important; box-shadow: none !important; border: 0 !important; }
        #print-poster { width: 148mm !important; height: 210mm !important; max-width: none !important; }
        #print-card { width: 85mm !important; height: 55mm !important; max-width: none !important; }
        ${printTarget === 'card' ? '#print-poster { display: none !important; } @page { size: 85mm 55mm; margin: 0; }' : '#print-card { display: none !important; } @page { size: A5; margin: 0; }'}
      }`}</style>

      <Section title="Bağlantılar ve QR kodlar" description="QR kodları PNG olarak indirip matbaaya verebilir ya da hazır şablonları yazdırabilirsiniz.">
        <div className="grid gap-4 md:grid-cols-2">
          <QrCard title="Mağaza (menü) bağlantısı" url={storeUrl} qr={storeQr} fileName={`${slug}-menu-qr.png`} onCopy={() => void copy(storeUrl)} />
          <div className="flex flex-col gap-3">
            {shared ? (
              <p className="rounded-md bg-info-bg p-3 text-sm text-fg">
                Ortak numara ({SHARED_WA_DISPLAY_NAME}) · {formatPhone(shared.phone)} · Dükkan kodu <strong className="font-mono">#{shared.code}</strong>. Müşteri QR’ı
                okutunca WhatsApp dükkan kodunuzla açılır ve bot dükkanınızın adıyla yanıt verir.
              </p>
            ) : (
              <Field label="WhatsApp numaranız" hint="Müşteri QR'ı okutunca bu numaraya “Merhaba” yazar." error={waNumber && !e164 ? 'Geçerli bir cep numarası girin.' : undefined}>
                <Input value={waNumber ? formatPhone(waNumber) : ''} onChange={(e) => setWaNumber(e.target.value)} inputMode="tel" placeholder="0532 000 00 00" />
              </Field>
            )}
            <QrCard title="WhatsApp sohbet bağlantısı" url={waUrl} qr={waQr} fileName={`${slug}-whatsapp-qr.png`} onCopy={() => void copy(waUrl)} />
          </div>
        </div>
        {standQr ? (
          <p className="text-sm text-fg-muted">
            Kasa standı için kaynak etiketli bağlantı: <span className="break-all font-mono">{standUrl}</span>
          </p>
        ) : null}
      </Section>

      <Section
        title="Afiş ve paket kartı"
        description={
          shared
            ? 'İşletme adınız ve renginiz öne çıkar; platform adı yalnız müşterinin WhatsApp’ta göreceği sohbet adını açıklayan küçük notta geçer.'
            : 'İşletme adınız ve renginiz öne çıkar; basılı materyalde platform adı yer almaz.'
        }
      >
        <RadioGroup legend="Başlık" variant="chips" value={headline} onValueChange={setHeadline} options={HEADLINES.map((h) => ({ value: h, label: h }))} />
        <Field label="Alt satır (isteğe bağlı)" hint="Ör. Bu kartla siparişe ayran bizden.">
          <Input value={subline} onChange={(e) => setSubline(e.target.value)} maxLength={60} />
        </Field>
        {subline ? (
          <p className="flex items-start gap-2 rounded-md bg-warning-bg p-3 text-sm text-fg">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            Bu avantajı siparişte siz uygularsınız; otomatik kural sonraki aşamada gelecek.
          </p>
        ) : null}
        <p className="flex items-start gap-2 rounded-md bg-info-bg p-3 text-sm text-fg">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          Pazaryeri paketlerine kart koymadan önce sözleşmenizi kontrol edin. Baskı rengi ekrandan farklı olabilir.
        </p>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h3 className="text-base font-semibold text-fg">A5 kapı/vitrin afişi</h3>
            <div
              id="print-poster"
              className="mx-auto flex w-full max-w-[148mm] flex-col items-center overflow-hidden border border-border bg-white text-center text-[#111827] shadow-sm"
              style={{ aspectRatio: '148 / 210', containerType: 'inline-size' }}
            >
              <div className="flex w-full flex-col items-center gap-[2cqw] px-[6cqw] py-[6cqw]" style={{ background: palette.brand, color: palette.brandContrast }}>
                {t.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.logoUrl} alt="" className="size-[16cqw] rounded-full bg-white object-cover" />
                ) : null}
                <span className="text-[8cqw] font-extrabold leading-tight">{t.name}</span>
              </div>
              <div className="flex flex-1 flex-col items-center justify-center gap-[3cqw] px-[6cqw]">
                <span className="text-[6cqw] font-bold leading-tight">{headline}</span>
                {subline ? <span className="text-[4cqw]">{subline}</span> : null}
                <div className="grid w-full grid-cols-2 gap-[4cqw]">
                  <PosterQr label="Menüye bak" qr={storeQr} />
                  <PosterQr label="WhatsApp’tan yaz" qr={waQr} />
                </div>
                {e164 ? (
                  <span className="text-[4.5cqw] font-semibold">
                    {formatPhone(e164)}
                    {shared ? ` · #${shared.code}` : ''}
                  </span>
                ) : null}
              </div>
              <p className="px-[6cqw] pb-[4cqw] text-[2.4cqw] leading-snug text-[#374151]">{kvkk}</p>
            </div>
            <Button variant="secondary" onClick={() => setPrintTarget('poster')} disabled={!storeQr}>
              <Printer aria-hidden />
              Afişi yazdır (A5)
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-base font-semibold text-fg">Paket içi kart (85×55 mm)</h3>
            <div
              id="print-card"
              className="mx-auto w-full max-w-[85mm] overflow-hidden border border-border bg-white text-[#111827] shadow-sm"
              style={{ aspectRatio: '85 / 55', containerType: 'inline-size' }}
            >
              <div className="grid size-full grid-cols-[1fr_auto] gap-[3cqw] p-[5cqw]">
                <div className="flex min-w-0 flex-col gap-[1.5cqw]">
                  <span className="text-[6cqw] font-extrabold leading-tight" style={{ color: palette.brandStrong }}>
                    {t.name}
                  </span>
                  <span className="text-[4.8cqw] font-bold leading-tight">{headline}</span>
                  {subline ? <span className="text-[3.8cqw]">{subline}</span> : null}
                  {e164 ? (
                    <span className="text-[4.2cqw] font-semibold">
                      {formatPhone(e164)}
                      {shared ? ` · #${shared.code}` : ''}
                    </span>
                  ) : null}
                  <span className="mt-auto text-[2.6cqw] leading-snug text-[#374151]">{kvkk}</span>
                </div>
                <div className="flex w-[32cqw] items-center">
                  {waQr ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={waQr} alt="WhatsApp QR" className="w-full" />
                  ) : (
                    <span className="text-[3cqw] text-[#6b7280]">Numara girin</span>
                  )}
                </div>
              </div>
            </div>
            <Button variant="secondary" onClick={() => setPrintTarget('card')} disabled={!waQr}>
              <Printer aria-hidden />
              Kartı yazdır
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}

function PosterQr({ label, qr }: { label: string; qr: string | null }) {
  return (
    <div className="flex flex-col items-center gap-[1.5cqw]">
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt={`${label} QR`} className="w-full" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-[#f3f4f6] text-[3cqw] text-[#6b7280]">QR</div>
      )}
      <span className="text-[4cqw] font-bold">{label}</span>
    </div>
  );
}

function QrCard({ title, url, qr, fileName, onCopy }: { title: string; url: string | null; qr: string | null; fileName: string; onCopy: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <span className="font-semibold text-fg">{title}</span>
      <div className="flex flex-wrap items-center gap-3">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt={`${title} QR kodu`} width={128} height={128} className="size-32 rounded-md border border-border bg-white" />
        ) : (
          <div className="flex size-32 items-center justify-center rounded-md border border-dashed border-border text-sm text-fg-muted">QR yok</div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="break-all font-mono text-xs text-fg-muted">{url ?? '—'}</span>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={onCopy} disabled={!url}>
              <Copy aria-hidden />
              Kopyala
            </Button>
            {qr ? (
              <a href={qr} download={fileName} className="inline-flex min-h-hit items-center gap-2 rounded-md border border-border-strong px-3 text-sm font-semibold text-fg hover:bg-accent">
                <Download aria-hidden className="size-4" />
                PNG indir
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
