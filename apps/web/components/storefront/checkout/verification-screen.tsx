'use client';

// Akış B sonuç ekranı (S-06B / S-06C, 03 §4.5): WhatsApp kodu + "WhatsApp ile onayla", SMS OTP yedeği,
// 3 sn'de bir durum yoklaması (takip uç noktası) → `new` olunca takip sayfasına geçer; 30 dk süre sayacı.

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Copy, MessageCircle, Phone, Smartphone, TimerOff } from 'lucide-react';
import type { CreateOrderResponse } from '@siparis/core/contracts/store';
import type { SmsOtpResponse, TrackResponseExt } from '@siparis/core/orders/contracts';
import { Alert, Button, ConfirmDialog, Field, Input, Spinner } from '@/components/ui';
import { apiFetch, errorMessage, isApiError, useApiQuery } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatElapsed, formatMoney } from '@/lib/format';
import { storefrontHref } from '@/lib/storefront-url';

const trackKey = (token: string) => ['store', 'track', token] as const;

export function VerificationScreen({
  token,
  initial,
  track,
  phone,
  slug,
  businessName,
  businessPhone,
  onChanged,
}: {
  token: string;
  initial?: CreateOrderResponse;
  /** Takip sayfasından açılırsa mevcut takip verisi. */
  track?: TrackResponseExt;
  phone?: string;
  slug?: string;
  businessName?: string;
  businessPhone?: string | null;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const q = useApiQuery<TrackResponseExt>(trackKey(token), track ? null : `/store/track/${token}`, { refetchInterval: 3_000, staleTime: 0 });
  const data = track ?? q.data;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const status = data?.order.status ?? initial?.status;
  useEffect(() => {
    if (status && status !== 'awaiting_customer' && !track) router.replace(`/t/${token}`);
  }, [status, token, router, track]);

  const v = data?.order.verification;
  const method = v?.method ?? initial?.verification.method ?? null;
  const code = v?.code ?? initial?.verification.code ?? null;
  const waLink = v?.waLink ?? initial?.verification.waLink ?? null;
  const smsAvailable = v?.smsAvailable ?? initial?.verification.smsAvailable ?? false;
  const expiresAt = v?.expiresAt ? new Date(v.expiresAt).getTime() : null;
  const left = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : null;
  const expired = left === 0 || (data?.order.status === 'cancelled' && data.order.reasonText?.includes('onay'));
  const [smsMode, setSmsMode] = useState(method === 'sms_otp');
  useEffect(() => {
    if (method === 'sms_otp') setSmsMode(true);
  }, [method]);
  const [copied, setCopied] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const orderId = data?.order.id ?? initial?.orderId;
  const number = data?.order.number ?? initial?.number;
  const name = data?.business.name ?? businessName;
  const tel = data?.business.phone ?? businessPhone ?? null;
  const storeSlug = data?.business.slug ?? slug;

  if (status && status !== 'awaiting_customer' && !track) {
    return <Spinner label="Takip sayfası açılıyor" />;
  }

  if (expired) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <TimerOff aria-hidden className="size-12 text-fg-muted" />
        <h1 className="text-xl font-bold">Süre doldu, sipariş iptal edildi</h1>
        <p className="text-fg-muted">Siparişiniz 30 dakika içinde onaylanmadığı için iptal edildi.</p>
        {storeSlug ? (
          <a href={storefrontHref(storeSlug)} className="font-semibold underline underline-offset-4">
            Menüye dön
          </a>
        ) : null}
      </div>
    );
  }

  const cancel = async () => {
    setCancelling(true);
    try {
      await apiFetch(`/store/track/${token}/cancel`, { method: 'POST', body: {} });
      setCancelOpen(false);
      onChanged?.();
      void q.refetch();
      router.replace(`/t/${token}`);
    } catch {
      setCancelOpen(false);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 py-2">
      {method === 'wa_code' && !smsMode ? (
        <>
          <h1 className="text-2xl font-bold">Son adım: WhatsApp&apos;ta onaylayın</h1>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-raised p-4">
            <span className="text-base text-fg-muted">Sipariş kodunuz:</span>
            <span className="font-mono text-3xl font-extrabold tracking-[0.2em]" aria-label={`Sipariş kodu ${code?.split('').join(' ')}`}>
              {code}
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="ms-auto"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`Sipariş kodu: ${code}`);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              <Copy aria-hidden /> {copied ? 'Kopyalandı' : 'Kopyala'}
            </Button>
          </div>
          {waLink ? (
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-hit-primary w-full items-center justify-center gap-2 rounded-md bg-[#1f9d55] px-4 text-lg font-bold text-white hover:opacity-95"
            >
              <MessageCircle aria-hidden className="size-6" /> WhatsApp ile onayla
            </a>
          ) : null}
          <ol className="flex list-decimal flex-col gap-1 ps-6 text-base">
            <li>WhatsApp açılacak</li>
            <li>Hazır mesajda yalnızca Gönder&apos;e basın</li>
            <li>Bu sayfa kendiliğinden güncellenir</li>
          </ol>
        </>
      ) : null}

      {smsMode && orderId ? <SmsPanel orderId={orderId} defaultPhone={phone ?? ''} onVerified={() => router.replace(`/t/${token}`)} /> : null}

      {!method && !smsMode ? (
        <Alert variant="warning" title="Siparişinizi doğrulatın">
          Online doğrulama şu an kullanılamıyor. Siparişinizin hazırlanması için lütfen {name ?? 'işletmeyi'} arayın; sipariş numaranız #{number}.
          {tel ? (
            <a href={`tel:${tel.replace(/[^\d+]/g, '')}`} className="mt-2 inline-flex min-h-hit items-center gap-2 font-bold underline underline-offset-4">
              <Phone aria-hidden className="size-5" /> İşletmeyi ara
            </a>
          ) : null}
        </Alert>
      ) : null}

      <p className={cn('text-base font-semibold tabular-nums', left != null && left < 300 ? 'text-status-new-fg' : 'text-fg-muted')} aria-live="off">
        Kalan süre: {left != null ? formatElapsed(left) : '30:00'}
      </p>

      {method === 'wa_code' && smsAvailable && !smsMode ? (
        <button type="button" className="inline-flex min-h-hit items-center gap-2 self-start font-semibold underline underline-offset-4" onClick={() => setSmsMode(true)}>
          <Smartphone aria-hidden className="size-5" /> WhatsApp&apos;ım yok · SMS ile doğrula
        </button>
      ) : null}
      {smsMode && method === 'wa_code' ? (
        <button type="button" className="inline-flex min-h-hit items-center gap-2 self-start font-semibold underline underline-offset-4" onClick={() => setSmsMode(false)}>
          <MessageCircle aria-hidden className="size-5" /> WhatsApp ile onaylamaya dön
        </button>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border pt-4 text-base">
        {data ? (
          <p>
            Siparişiniz: {data.order.items.reduce((n, i) => n + i.quantity, 0)} ürün · {formatMoney(data.order.totals.totalKurus)}
          </p>
        ) : number ? (
          <p>Sipariş #{number}</p>
        ) : null}
        <button type="button" className="min-h-hit self-start text-sm font-semibold text-fg-muted underline underline-offset-4" onClick={() => setCancelOpen(true)}>
          Vazgeçtim, siparişi iptal et
        </button>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Siparişi iptal etmek istediğinize emin misiniz?"
        description="Bu işlem geri alınamaz."
        confirmLabel="Evet, iptal et"
        onConfirm={cancel}
        loading={cancelling}
      />
    </div>
  );
}

/** S-06C: telefon → 6 haneli kod (inputmode numeric, one-time-code), 60 sn sonra yeniden gönder. */
function SmsPanel({ orderId, defaultPhone, onVerified }: { orderId: string; defaultPhone: string; onVerified: () => void }) {
  const [phone, setPhone] = useState(defaultPhone);
  const [sent, setSent] = useState<SmsOtpResponse | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const resendLeft = sent ? Math.max(0, Math.ceil((sentAt + sent.resendAfterSec * 1000 - now) / 1000)) : 0;

  const send = async () => {
    setBusy('send');
    setError(null);
    try {
      const r = await apiFetch<SmsOtpResponse>(`/store/orders/${orderId}/sms-otp`, { method: 'POST', body: { phone } });
      setSent(r);
      setSentAt(Date.now());
      setCode('');
    } catch (e) {
      setError(errorMessage(e, 'Kod gönderilemedi.'));
    } finally {
      setBusy(null);
    }
  };

  const verify = async (value = code) => {
    if (!/^\d{6}$/.test(value)) return;
    setBusy('verify');
    setError(null);
    try {
      await apiFetch(`/store/orders/${orderId}/sms-verify`, { method: 'POST', body: { code: value } });
      onVerified();
    } catch (e) {
      setError(isApiError(e) && e.code === 'code_expired' ? 'Kodun süresi doldu. Yeni kod isteyin.' : errorMessage(e, 'Kod doğrulanamadı.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">SMS ile doğrulayın</h1>
      {!sent ? (
        <>
          <Field label="Cep telefonu" hint="0 (5xx) xxx xx xx">
            <Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Button size="lg" block onClick={send} loading={busy === 'send'} disabled={phone.replace(/\D/g, '').length < 10}>
            Kod gönder
          </Button>
        </>
      ) : (
        <>
          <p className="text-base">{sent.phoneMasked} numarasına 6 haneli kod gönderdik.</p>
          <Field label="Doğrulama kodu">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              className="text-center font-mono text-2xl tracking-[0.5em]"
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(v);
                if (v.length === 6) void verify(v);
              }}
            />
          </Field>
          <Button size="lg" block onClick={() => void verify()} loading={busy === 'verify'} disabled={code.length !== 6}>
            Doğrula
          </Button>
          <div className="flex flex-wrap gap-4 text-sm">
            <button type="button" disabled={resendLeft > 0 || busy !== null} onClick={send} className="min-h-hit font-semibold underline underline-offset-4 disabled:no-underline disabled:opacity-60">
              Kodu tekrar gönder{resendLeft > 0 ? ` (${formatElapsed(resendLeft)})` : ''}
            </button>
            <button type="button" onClick={() => setSent(null)} className="min-h-hit font-semibold underline underline-offset-4">
              Numarayı düzelt
            </button>
          </div>
        </>
      )}
      {error ? <Alert variant="danger">{error}</Alert> : null}
    </div>
  );
}
