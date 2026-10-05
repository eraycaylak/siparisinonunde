'use client';

// S-06C (03 §4.5): telefon → 6 haneli kod (inputmode numeric, one-time-code), 60 sn sonra yeniden gönder.
// Numara girişinin altında işletmenin aydınlatma satırı ve metnine bağlantı (08 §2.4-B).
// Erişilebilirlik: hata ve "kod gönderildi" bilgisi canlı bölgede duyurulur, kod alanına odak kendiliğinden gider.

import { useEffect, useRef, useState } from 'react';
import type { SmsOtpResponse } from '@siparis/core/orders/contracts';
import { Alert, Button, Field, Input } from '@/components/ui';
import { apiFetch, errorMessage, isApiError } from '@/lib/api';
import { formatElapsed } from '@/lib/format';
import { storeLegalHref } from '@/components/storefront/legal/store-legal';
import { cartChangeFromError, type CartChangeView } from './cart-change';

export interface SmsVerifyPanelProps {
  orderId: string;
  defaultPhone?: string;
  /**
   * Siparişte verilen telefonun MASKELİ hali (takip yanıtındaki `order.phoneMasked`): müşteri hangi numarayı
   * yazacağını bilir. Kalıcı adreste açık numara taşınmaz — PII ne URL'de ne istemci deposunda gezer (kural 7).
   */
  maskedPhone?: string | null;
  slug?: string;
  businessName?: string;
  /** Müşteri yöntemi burada değiştirdiyse odak bölüm başlığına taşınır (açılışta odak çalınmaz). */
  focusOnMount?: boolean;
  onVerified: () => void;
  /** Doğrulama anında sepet değiştiyse (409 `cart_changed`): ekran fark listesine geçer. */
  onCartChanged?: (view: CartChangeView) => void;
}

export function SmsVerifyPanel({
  orderId,
  defaultPhone = '',
  maskedPhone,
  slug,
  businessName,
  focusOnMount = false,
  onVerified,
  onCartChanged,
}: SmsVerifyPanelProps) {
  const [phone, setPhone] = useState(defaultPhone);
  const [sent, setSent] = useState<SmsOtpResponse | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const codeRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Kod gönderildiğinde odak kod alanına: akış klavyeyle kesintisiz tamamlanır.
  useEffect(() => {
    if (sent) codeRef.current?.focus();
  }, [sent]);
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
      const changed = cartChangeFromError(e);
      if (changed && onCartChanged) {
        onCartChanged(changed);
        return;
      }
      setError(isApiError(e) && e.code === 'code_expired' ? 'Kodun süresi doldu. Yeni kod isteyin.' : errorMessage(e, 'Kod doğrulanamadı.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        SMS ile doğrulayın
      </h1>
      {!sent ? (
        <>
          <Field
            label="Cep telefonu"
            hint={maskedPhone ? `Siparişte verdiğiniz numara: ${maskedPhone}` : '0 (5xx) xxx xx xx'}
          >
            <Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Button size="lg" block onClick={send} loading={busy === 'send'} disabled={phone.replace(/\D/g, '').length < 10}>
            Kod gönder
          </Button>
          <p className="text-sm text-fg-muted">
            Kişisel verileriniz siparişinizi almak ve teslim etmek amacıyla {businessName ?? 'işletme'} tarafından işlenir.
            {slug ? (
              <>
                {' '}
                <a
                  href={storeLegalHref(slug, 'aydinlatma')}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex min-h-hit items-center font-semibold text-fg underline underline-offset-4"
                >
                  Aydınlatma metni
                </a>
              </>
            ) : null}
          </p>
        </>
      ) : (
        <>
          <p className="text-base" role="status">
            {sent.phoneMasked} numarasına 6 haneli kod gönderdik.
          </p>
          <Field label="Doğrulama kodu">
            <Input
              ref={codeRef}
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
            <button
              type="button"
              disabled={resendLeft > 0 || busy !== null}
              onClick={send}
              className="min-h-hit font-semibold underline underline-offset-4 disabled:no-underline disabled:opacity-60"
            >
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
