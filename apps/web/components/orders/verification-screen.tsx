'use client';

// Akış B doğrulama ekranı (S-06B / S-06C, 03 §4.5). KALICI ADRES: yalnız takip sayfası (/t/<token>) üzerinden
// gösterilir (denetim 2026-10-04 madde 3.1 / H6). Checkout artık ekranı yerinde çizmez; sipariş
// `awaiting_customer` doğduğunda /t/<token> adresine geçilir, böylece sekme yenilenince kod, kalan süre ve
// sipariş kaybolmaz. Durum yoklaması ve `awaiting_customer → new` geçişi takip sayfasının işidir.
//
// Sepet değişikliği (K10/K12): sunucu doğrulama anında 409 `cart_changed` döndürürse ya da takip yanıtı bekleyen
// bir değişiklik taşıyorsa ekran fark listesine geçer; müşteri güncel toplamı onaylamadan doğrulama ilerlemez.

import { useEffect, useRef, useState } from 'react';
import { Copy, MessageCircle, Phone, Smartphone, TimerOff } from 'lucide-react';
import type { TrackResponseExt } from '@siparis/core/orders/contracts';
import { Alert, Button, ConfirmDialog } from '@/components/ui';
import { apiFetch, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatElapsed, formatMoney } from '@/lib/format';
import { storefrontHref } from '@/lib/storefront-url';
import { CartChangeNotice } from './cart-change-notice';
import { cartChangeActionError, cartChangeFromError, pendingCartChange, type CartChangeView } from './cart-change';
import { telHref } from './labels';
import { SmsVerifyPanel } from './sms-verify-panel';

export interface VerificationScreenProps {
  token: string;
  /** Takip sayfasının çektiği veri — ekranın tek veri kaynağı. */
  track: TrackResponseExt;
  /** Sunucuda bir şey değiştiğinde takip sorgusunu yenilet. */
  onChanged?: () => void;
}

export function VerificationScreen({ token, track, onChanged }: VerificationScreenProps) {
  const order = track.order;
  const business = track.business;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const [copied, setCopied] = useState(false);
  // "Kopyalandı" geçici: hem buton etiketi hem canlı bölge sıfırlanır, ikinci kopyalama yeniden duyurulur.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [smsMode, setSmsMode] = useState(order.verification?.method === 'sms_otp');
  /** Yöntemi müşteri mi değiştirdi: odak yönetimi yalnız kullanıcı eylemiyle yapılır (açılışta odak çalınmaz). */
  const [switched, setSwitched] = useState(false);
  const waHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // SMS'ten WhatsApp'a dönüşte odak yeni bölümün başlığına gider; aksi halde odak gövdeye düşerdi.
    if (switched && !smsMode) waHeadingRef.current?.focus();
  }, [switched, smsMode]);
  /** Doğrulama anında 409 ile gelen sepet değişikliği (takip yanıtı henüz taşımıyorsa). */
  const [changeFromError, setChangeFromError] = useState<CartChangeView | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const v = order.verification;
  const method = v?.method ?? null;
  const code = v?.code ?? '';
  useEffect(() => {
    if (method === 'sms_otp') setSmsMode(true);
  }, [method]);

  const expiresAt = v?.expiresAt ? new Date(v.expiresAt).getTime() : null;
  const left = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : null;
  const expired = left === 0 || (order.status === 'cancelled' && order.reasonText?.includes('onay'));

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await apiFetch(`/store/track/${token}/cancel`, { method: 'POST', body: {} });
      setCancelOpen(false);
      onChanged?.();
    } catch (e) {
      // İptal SESSİZCE yutulmaz: dialog kapanıp hiçbir şey yazılmazsa müşteri siparişin iptal edildiğini sanır,
      // sipariş ilerler ve kapıya gelir. Gerekçe yazılır, takip verisi yenilenir (gerçek durum ekrana düşsün).
      setCancelOpen(false);
      setCancelError(errorMessage(e, 'Siparişiniz iptal edilemedi. Lütfen işletmeyi arayın.'));
      onChanged?.();
    } finally {
      setCancelling(false);
    }
  };

  if (expired) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <TimerOff aria-hidden className="size-12 text-fg-muted" />
        <h1 className="text-xl font-bold">Süre doldu, sipariş iptal edildi</h1>
        <p className="text-fg-muted">Siparişiniz 30 dakika içinde onaylanmadığı için iptal edildi.</p>
        <a href={storefrontHref(business.slug)} className="font-semibold underline underline-offset-4">
          Menüye dön
        </a>
      </div>
    );
  }

  const openCancel = () => {
    setCancelError(null);
    setCancelOpen(true);
  };

  // İptal başarısızsa gerekçe + işletmeyi arama yolu; iki dalda da (sepet değişikliği / doğrulama) gösterilir.
  const cancelDialog = (
    <>
      {cancelError ? (
        <Alert variant="danger" title="Sipariş iptal edilemedi">
          {cancelError}
          {business.phone ? (
            <a
              href={telHref(business.phone)}
              className="mt-2 inline-flex min-h-hit items-center gap-2 font-bold underline underline-offset-4"
            >
              <Phone aria-hidden className="size-5" /> İşletmeyi ara
            </a>
          ) : null}
        </Alert>
      ) : null}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Siparişi iptal etmek istediğinize emin misiniz?"
        description="Bu işlem geri alınamaz."
        confirmLabel="Evet, iptal et"
        onConfirm={cancel}
        loading={cancelling}
      />
    </>
  );

  // K10/K12: güncel sepet onaylanmadan doğrulama gösterilmez.
  const change = changeFromError ?? pendingCartChange(order);
  if (change) {
    const accept = async () => {
      setAccepting(true);
      setAcceptError(null);
      try {
        await apiFetch(`/store/track/${token}/accept-changes`, {
          method: 'POST',
          body: change.totalKurus != null ? { expectedTotalKurus: change.totalKurus } : {},
        });
        setChangeFromError(null);
        onChanged?.();
      } catch (e) {
        const next = cartChangeFromError(e);
        if (next) {
          setChangeFromError(next);
          setAcceptError('Sepetiniz bu arada yeniden değişti. Güncel listeyi onaylayın.');
        } else {
          setAcceptError(cartChangeActionError(e));
        }
      } finally {
        setAccepting(false);
      }
    };
    return (
      <div className="flex flex-col gap-5 py-2">
        <CartChangeNotice
          view={change}
          busy={accepting}
          error={acceptError}
          onConfirm={() => void accept()}
          onReject={openCancel}
        />
        <p className="text-base text-fg-muted">
          {business.name} · Sipariş #{order.number}
        </p>
        {business.phone ? (
          <a
            href={telHref(business.phone)}
            className="inline-flex min-h-hit items-center justify-center gap-2 self-start rounded-md border border-border-strong px-4 font-semibold"
          >
            <Phone aria-hidden className="size-5" /> İşletmeyi ara
          </a>
        ) : null}
        {cancelDialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 py-2">
      {method === 'wa_code' && !smsMode ? (
        <>
          <h1
            ref={waHeadingRef}
            tabIndex={-1}
            className="text-2xl font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Son adım: WhatsApp&apos;ta onaylayın
          </h1>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-raised p-4">
            <span className="text-base text-fg-muted">Sipariş kodunuz:</span>
            {/* Kod harf harf okunur: ekran okuyucu "K7M2Q9"yu tek kelime gibi söylemesin. */}
            <span className="font-mono text-3xl font-extrabold tracking-[0.2em]" aria-label={`Sipariş kodu ${code.split('').join(' ')}`}>
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
            {/* Buton etiketi değişimi her ekran okuyucuda duyurulmaz; ayrı canlı bölge duyurur. */}
            <span className="sr-only" role="status">
              {copied ? 'Sipariş kodu kopyalandı' : ''}
            </span>
          </div>
          {v?.waLink ? (
            <a
              href={v.waLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-hit-primary w-full items-center justify-center gap-2 rounded-md bg-success px-4 text-lg font-bold text-success-fg hover:opacity-95"
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

      {smsMode ? (
        <SmsVerifyPanel
          orderId={order.id}
          focusOnMount={switched}
          maskedPhone={order.phoneMasked}
          slug={business.slug}
          businessName={business.name}
          onVerified={() => onChanged?.()}
          onCartChanged={setChangeFromError}
        />
      ) : null}

      {!method && !smsMode ? (
        <Alert variant="warning" title="Siparişinizi doğrulatın">
          Online doğrulama şu an kullanılamıyor. Siparişinizin hazırlanması için lütfen {business.name} işletmesini
          arayın; sipariş numaranız #{order.number}.
          {business.phone ? (
            <a href={telHref(business.phone)} className="mt-2 inline-flex min-h-hit items-center gap-2 font-bold underline underline-offset-4">
              <Phone aria-hidden className="size-5" /> İşletmeyi ara
            </a>
          ) : null}
        </Alert>
      ) : null}

      <p
        className={cn('text-base font-semibold tabular-nums', left != null && left < 300 ? 'text-status-new-fg' : 'text-fg-muted')}
        aria-live="off"
      >
        Kalan süre: {left != null ? formatElapsed(left) : '30:00'}
      </p>

      {method === 'wa_code' && v?.smsAvailable && !smsMode ? (
        <button
          type="button"
          className="inline-flex min-h-hit items-center gap-2 self-start font-semibold underline underline-offset-4"
          onClick={() => {
            setSwitched(true);
            setSmsMode(true);
          }}
        >
          <Smartphone aria-hidden className="size-5" /> WhatsApp&apos;ım yok · SMS ile doğrula
        </button>
      ) : null}
      {smsMode && method === 'wa_code' ? (
        <button
          type="button"
          className="inline-flex min-h-hit items-center gap-2 self-start font-semibold underline underline-offset-4"
          onClick={() => {
            setSwitched(true);
            setSmsMode(false);
          }}
        >
          <MessageCircle aria-hidden className="size-5" /> WhatsApp ile onaylamaya dön
        </button>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border pt-4 text-base">
        <p>
          Siparişiniz: {order.items.reduce((n, i) => n + i.quantity, 0)} ürün · {formatMoney(order.totals.totalKurus)}
        </p>
        {/* Kalıcı adres: müşteri sekmeyi kapatsa da bu bağlantıdan dönebilir (03 §4.5). */}
        <p className="text-sm text-fg-muted">
          Sipariş #{order.number} · Bu sayfayı yenileyebilir, daha sonra aynı bağlantıdan geri dönebilirsiniz.
        </p>
        <button
          type="button"
          className="min-h-hit self-start text-sm font-semibold text-fg-muted underline underline-offset-4"
          onClick={openCancel}
        >
          Vazgeçtim, siparişi iptal et
        </button>
      </div>

      {cancelDialog}
    </div>
  );
}
