'use client';

// Takip sayfası (S-07/S-08, 03 §7): durum çizelgesi (renk + ikon + kelime), tahmini saat, onay gecikmesi satırı,
// kalemler ve toplam, işletmeyi ara / WhatsApp'tan yaz, iptal (new) / iptal talebi (accepted+), teslimden sonra
// 3 butonlu değerlendirme. 15 sn'de bir yenilenir (doğrulama beklerken 3 sn). Süresi dolmuş link: kişisel veri yok.

import { useEffect, useState } from 'react';
import { Check, Circle, Frown, Meh, MessageCircle, Phone, Smile, TimerOff } from 'lucide-react';
import type { TrackExpiredDetails, TrackResponseExt } from '@siparis/core/orders/contracts';
import type { OrderStatus } from '@siparis/core/enums';
import { Alert, Button, ConfirmDialog, Field, ORDER_STATUS_ICONS, RadioGroup, Spinner, Textarea, statusClasses } from '@/components/ui';
import { apiFetch, errorMessage, isApiError, useApiQuery } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney, formatTime } from '@/lib/format';
import { storefrontHref } from '@/lib/storefront-url';
import { VerificationScreen } from '@/components/storefront/checkout/verification-screen';
import { changeText, paymentShort, telHref } from './labels';

const trackKey = (token: string) => ['store', 'track', token] as const;

export function TrackingPage({ token }: { token: string }) {
  const [fast, setFast] = useState(false);
  const q = useApiQuery<TrackResponseExt>(trackKey(token), `/store/track/${token}`, {
    refetchInterval: (query) => (query.state.error && isApiError(query.state.error) && query.state.error.status === 410 ? false : fast ? 3_000 : 15_000),
    staleTime: 0,
    retry: (n, err) => !(isApiError(err) && err.status >= 400 && err.status < 500) && n < 3,
  });
  const data = q.data;
  useEffect(() => {
    setFast(data?.order.status === 'awaiting_customer');
  }, [data?.order.status]);

  if (q.isPending) return <Spinner label="Sipariş yükleniyor" />;
  if (q.error && isApiError(q.error) && q.error.status === 410) {
    const details = q.error.details as TrackExpiredDetails | undefined;
    return <ExpiredView business={details?.business ?? null} />;
  }
  if (q.error && !data) {
    return (
      <Alert variant="danger" title="Sipariş bulunamadı" className="mt-6">
        {isApiError(q.error) && q.error.status === 404 ? 'Takip bağlantısı geçersiz.' : errorMessage(q.error)}
      </Alert>
    );
  }
  if (!data) return null;
  if (data.order.status === 'awaiting_customer') {
    return <VerificationScreen token={token} track={data} onChanged={() => void q.refetch()} />;
  }
  return <TrackingView token={token} data={data} refetch={() => void q.refetch()} />;
}

function ExpiredView({ business }: { business: TrackExpiredDetails['business'] | null }) {
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <TimerOff aria-hidden className="size-12 text-fg-muted" />
      <h1 className="text-xl font-bold">Bu takip bağlantısının süresi doldu.</h1>
      {business ? <p className="text-fg-muted">{business.name}</p> : null}
      <div className="flex flex-wrap justify-center gap-3">
        {business ? (
          <a href={storefrontHref(business.slug)} className="inline-flex min-h-hit items-center rounded-md bg-primary px-4 font-semibold text-primary-fg">
            Menüyü aç
          </a>
        ) : null}
        {business?.phone ? (
          <a href={telHref(business.phone)} className="inline-flex min-h-hit items-center gap-2 rounded-md border border-border-strong px-4 font-semibold">
            <Phone aria-hidden className="size-5" /> İşletmeyi ara
          </a>
        ) : null}
      </div>
      <a href="/yasal/mesafeli-satis-sablonu" className="text-sm underline underline-offset-4">
        Ön bilgilendirme ve sözleşme metni
      </a>
    </div>
  );
}

const CANCEL_REASONS = [
  { value: 'Yanlış sipariş verdim', label: 'Yanlış sipariş verdim' },
  { value: 'Çok gecikti', label: 'Çok gecikti' },
  { value: 'Diğer', label: 'Diğer' },
];

const BAD_CHIPS = ['Geç geldi', 'Soğuk geldi', 'Eksik/yanlış ürün', 'Lezzet', 'Kurye', 'Diğer'];

function TrackingView({ token, data, refetch }: { token: string; data: TrackResponseExt; refetch: () => void }) {
  const o = data.order;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [reqReason, setReqReason] = useState<string | null>(null);
  const [reqNote, setReqNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const Icon = ORDER_STATUS_ICONS[o.status as OrderStatus];

  const noticeAt = o.approvalDelay ? new Date(o.approvalDelay.noticeAt).getTime() : null;
  const autoCancelAt = o.approvalDelay ? new Date(o.approvalDelay.autoCancelAt).getTime() : null;
  const showDelay = o.status === 'new' && noticeAt != null && now >= noticeAt;
  const leftMin = autoCancelAt ? Math.max(1, Math.ceil((autoCancelAt - now) / 60_000)) : null;
  const overdue = o.etaAt && !['delivered', 'rejected', 'cancelled'].includes(o.status) && now > new Date(o.etaAt).getTime() + 10 * 60_000;
  const waHref = data.business.waPhone
    ? `https://wa.me/${data.business.waPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`Sipariş #${o.number} hakkında`)}`
    : null;

  const cancel = async (reason?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await apiFetch<{ result: 'cancelled' | 'requested' }>(`/store/track/${token}/cancel`, {
        method: 'POST',
        body: reason ? { reason } : {},
      });
      setMessage(r.result === 'requested' ? 'İptal talebiniz işletmeye iletildi.' : 'Siparişiniz iptal edildi.');
      setCancelOpen(false);
      setRequestOpen(false);
      refetch();
    } catch (e) {
      setMessage(errorMessage(e, 'İşlem yapılamadı.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 py-2">
      <header className="flex flex-col gap-1">
        <p className="text-base text-fg-muted">
          {data.business.name} · Sipariş #{o.number}
        </p>
        <h1 className={cn('inline-flex items-center gap-2 self-start rounded-lg border px-3 py-2 text-xl font-bold', statusClasses(o.status as OrderStatus))} aria-live="polite">
          <Icon aria-hidden className="size-6" /> {o.etaAt ? o.statusLabel.replace(/ · Tahmini \d\d\.\d\d$/, '') : o.statusLabel}
        </h1>
        {o.etaAt && !['delivered', 'rejected', 'cancelled'].includes(o.status) ? (
          <p className="text-3xl font-extrabold tabular-nums">Tahmini {formatTime(o.etaAt)}</p>
        ) : null}
      </header>

      <ol className="flex flex-col gap-2" aria-label="Sipariş adımları">
        {o.timeline.map((t, i) => {
          const done = Boolean(t.at);
          const negative = t.status === 'rejected' || t.status === 'cancelled';
          return (
            <li key={`${t.status}-${i}`} className="flex items-center gap-3">
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border-2',
                  done ? (negative ? 'border-status-rejected-fg bg-status-rejected-bg text-status-rejected-fg' : 'border-status-ready-fg bg-status-ready-bg text-status-ready-fg') : 'border-border text-fg-muted',
                )}
              >
                {done ? <Check aria-hidden className="size-5" /> : <Circle aria-hidden className="size-3" />}
              </span>
              <span className={cn('flex-1 text-base', done ? 'font-semibold' : 'text-fg-muted')}>
                {t.label}
                {t.status === 'on_the_way' && o.courierName && done ? ` · Kurye: ${o.courierName}` : ''}
                {t.status === 'accepted' && o.fulfillmentType === 'delivery' && o.readyAt && o.status === 'ready' ? ' · Hazır, kurye bekleniyor' : ''}
              </span>
              <span className="tabular-nums text-fg-muted">{t.at ? formatTime(t.at) : ''}</span>
            </li>
          );
        })}
      </ol>

      {showDelay ? (
        <Alert
          variant="warning"
          title="İşletme siparişinizi henüz onaylamadı"
          action={
            <>
              {o.canCancel ? (
                <Button variant="secondary" onClick={() => setCancelOpen(true)}>
                  İptal et
                </Button>
              ) : null}
              {data.business.phone ? (
                <a href={telHref(data.business.phone)} className="inline-flex min-h-hit items-center gap-2 rounded-md border border-border-strong px-4 font-semibold">
                  <Phone aria-hidden className="size-5" /> İşletmeyi ara
                </a>
              ) : null}
            </>
          }
        >
          {leftMin} dakika içinde onaylanmazsa sipariş otomatik olarak iptal edilecek.
        </Alert>
      ) : null}
      {overdue ? (
        <Alert variant="info">Siparişiniz biraz gecikti. Bir sorun olduğunu düşünüyorsanız işletmeyi arayabilirsiniz.</Alert>
      ) : null}
      {o.status === 'cancelled' && o.reasonText?.includes('zamanında') && data.business.phone ? (
        <Alert variant="danger">
          Sizi beklettiğimiz için özür dileriz. Telefonla sipariş için:{' '}
          <a href={telHref(data.business.phone)} className="font-bold underline">
            {data.business.phone}
          </a>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {data.business.phone ? (
          <a href={telHref(data.business.phone)} className="inline-flex min-h-hit flex-1 items-center justify-center gap-2 rounded-md border border-border-strong px-4 font-semibold">
            <Phone aria-hidden className="size-5" /> İşletmeyi ara
          </a>
        ) : null}
        {waHref ? (
          <a href={waHref} target="_blank" rel="noreferrer" className="inline-flex min-h-hit flex-1 items-center justify-center gap-2 rounded-md border border-border-strong px-4 font-semibold">
            <MessageCircle aria-hidden className="size-5" /> WhatsApp&apos;tan yaz
          </a>
        ) : null}
      </div>

      {o.canCancel ? (
        <Button variant="secondary" size="lg" onClick={() => setCancelOpen(true)}>
          İptal et
        </Button>
      ) : null}
      {o.canRequestCancel ? (
        <Button variant="secondary" size="lg" onClick={() => setRequestOpen((v) => !v)} aria-expanded={requestOpen}>
          İptal talebi gönder
        </Button>
      ) : null}
      {requestOpen ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <RadioGroup legend="Gerekçe (isteğe bağlı)" variant="chips" options={CANCEL_REASONS} value={reqReason} onValueChange={setReqReason} />
          {reqReason === 'Diğer' ? (
            <Field label="Kısa açıklama">
              <Textarea rows={2} maxLength={200} value={reqNote} onChange={(e) => setReqNote(e.target.value)} />
            </Field>
          ) : null}
          <Button size="lg" loading={busy} onClick={() => cancel(reqReason === 'Diğer' ? reqNote.trim() || 'Diğer' : (reqReason ?? undefined))}>
            Talebi gönder
          </Button>
        </div>
      ) : null}
      {o.cancelRequestStatus === 'pending' ? <Alert variant="info">İptal talebiniz işletmeye iletildi. Yanıt bekleniyor.</Alert> : null}
      {o.cancelRequestStatus === 'rejected' && o.status !== 'cancelled' ? (
        <Alert variant="info">İşletme siparişinizi hazırlamaya devam ediyor.</Alert>
      ) : null}
      {message ? <Alert variant="info">{message}</Alert> : null}

      {o.status === 'delivered' ? <ReviewBox token={token} review={o.review} onDone={refetch} /> : null}

      <section aria-labelledby="ozet-baslik" className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4">
        <h2 id="ozet-baslik" className="text-base font-bold">
          Sipariş özeti
        </h2>
        <ul className="flex flex-col gap-1">
          {o.items.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-3">
              <span className="min-w-0">
                {i.quantity}× {i.name}
                {i.options.length ? <span className="block text-sm text-fg-muted">{i.options.join(', ')}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums">{formatMoney(i.lineTotalKurus)}</span>
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-border pt-2">
          {o.totals.deliveryFeeKurus ? (
            <>
              <dt className="text-fg-muted">Teslimat ücreti</dt>
              <dd className="text-end tabular-nums">{formatMoney(o.totals.deliveryFeeKurus)}</dd>
            </>
          ) : null}
          <dt className="font-bold">Toplam (KDV dahil)</dt>
          <dd className="text-end font-bold tabular-nums">{formatMoney(o.totals.totalKurus)}</dd>
        </dl>
        {o.paymentMethod ? (
          <p className="text-sm">
            Ödeme: {paymentShort(o.paymentMethod, o.mealCardBrand)}
            {changeText(o.totals.totalKurus, o.changeForKurus) ? ` · ${changeText(o.totals.totalKurus, o.changeForKurus)}` : ''}
          </p>
        ) : null}
        {o.addressMasked ? <p className="text-sm">Adres: {o.addressMasked}</p> : null}
        {o.note ? <p className="text-sm">Not: {o.note}</p> : null}
      </section>

      <p className="flex flex-wrap gap-x-3 text-sm">
        Belgeler:
        <a href="/yasal/mesafeli-satis-sablonu" className="underline underline-offset-4">
          Ön bilgilendirme · Mesafeli satış sözleşmesi
        </a>
        <a href="/yasal/kvkk-aydinlatma" className="underline underline-offset-4">
          Aydınlatma metni
        </a>
      </p>
      {(o.channel === 'web' || o.channel === 'manual') && waHref ? (
        <p className="text-sm text-fg-muted">
          Bir dahaki siparişinizi WhatsApp&apos;tan verebilirsiniz.{' '}
          <a href={`https://wa.me/${data.business.waPhone!.replace(/\D/g, '')}`} className="font-semibold underline underline-offset-4" target="_blank" rel="noreferrer">
            WhatsApp&apos;ı aç
          </a>
        </p>
      ) : null}

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Siparişi iptal etmek istediğinize emin misiniz?"
        description="Bu işlem geri alınamaz."
        confirmLabel="Evet, iptal et"
        onConfirm={() => cancel()}
        loading={busy}
      />
    </div>
  );
}

function ReviewBox({ token, review, onDone }: { token: string; review: TrackResponseExt['order']['review']; onDone: () => void }) {
  const [rating, setRating] = useState<'good' | 'ok' | 'bad' | null>(null);
  const [comment, setComment] = useState('');
  const [chips, setChips] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (review) {
    return (
      <Alert variant="success" title="Teşekkür ederiz">
        Değerlendirmeniz: {review.rating === 'good' ? 'Harika' : review.rating === 'ok' ? 'İdare eder' : 'Beğenmedim'}
        {review.comment ? ` · "${review.comment}"` : ''}
      </Alert>
    );
  }
  const options = [
    { value: 'good' as const, label: 'Harika', icon: Smile },
    { value: 'ok' as const, label: 'İdare eder', icon: Meh },
    { value: 'bad' as const, label: 'Beğenmedim', icon: Frown },
  ];
  const submit = async () => {
    if (!rating) return;
    setBusy(true);
    setError(null);
    const text = [chips.length ? chips.join(', ') : null, comment.trim() || null].filter(Boolean).join(' · ');
    try {
      await apiFetch(`/store/track/${token}/review`, { method: 'POST', body: { rating, ...(text ? { comment: text.slice(0, 280) } : {}) } });
      onDone();
    } catch (e) {
      setError(errorMessage(e, 'Değerlendirme gönderilemedi.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="degerlendir" className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
      <h2 id="degerlendir" className="text-base font-bold">
        Siparişinizi değerlendirin
      </h2>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Puan">
        {options.map((opt) => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={rating === opt.value}
              onClick={() => setRating(opt.value)}
              className={cn(
                'flex min-h-hit-primary flex-col items-center justify-center gap-1 rounded-md border-2 px-2 py-2 text-sm font-semibold',
                rating === opt.value ? 'border-primary bg-accent' : 'border-border',
              )}
            >
              <Icon aria-hidden className="size-7" />
              {opt.label}
            </button>
          );
        })}
      </div>
      {rating === 'bad' ? (
        <div className="flex flex-wrap gap-2" aria-label="Sorun">
          {BAD_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={chips.includes(c)}
              onClick={() => setChips((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}
              className={cn('min-h-hit rounded-full border px-3 text-sm font-semibold', chips.includes(c) ? 'border-primary bg-accent' : 'border-border')}
            >
              {c}
            </button>
          ))}
        </div>
      ) : null}
      {rating ? (
        <>
          <Field label="Kısa yorum (isteğe bağlı)" hint={`${comment.length}/280`}>
            <Textarea rows={2} maxLength={280} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <Button size="lg" onClick={submit} loading={busy}>
            Gönder
          </Button>
        </>
      ) : null}
      {error ? <Alert variant="danger">{error}</Alert> : null}
    </section>
  );
}
