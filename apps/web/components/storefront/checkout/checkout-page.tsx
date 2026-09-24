'use client';

// Checkout (S-04/S-05, 03 §4.4): tek kaydırılan sayfa — teslimat, iletişim, ödeme, özet + ön bilgilendirme onayı,
// "Siparişi onayla · N TL" ve altında ödeme yükümlülüğü/cayma istisnası metni. Tutarı sunucu hesaplar (POST /quote).
// Gönderim idempotency anahtarıyla; ağ kopmasında aynı anahtarla tekrar denenir (03 K13, K23).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bike, CircleAlert, FileText, MapPin, MessageCircle, ShoppingBag, Store } from 'lucide-react';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import type { CreateOrderResponse, QuoteResponse } from '@siparis/core/contracts/store';
import { MEAL_CARD_BRAND_LABELS, PAYMENT_METHOD_LABELS, type MealCardBrand, type PaymentMethod } from '@siparis/core/enums';
import { allNeighborhoods } from '@siparis/core/zones';
import { etaRange } from '@siparis/core/pricing';
import { Alert, Button, Checkbox, Dialog, EmptyState, Field, Input, RadioGroup, Select, Spinner, Textarea } from '@/components/ui';
import { ApiError, apiFetch, errorMessage, fieldErrorsOf, isApiError, newIdempotencyKey } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { storefrontHref } from '@/lib/storefront-url';
import { brandButtonClass } from '@/components/storefront/brand';
import { useStoreSession } from '@/components/storefront/use-store-session';
import { VerificationScreen } from './verification-screen';

/** 03 §4.4 kilitli metin. */
const REMEMBER_DEVICE_TEXT = 'Adımı, telefonumu ve adresimi bu cihazda sonraki siparişlerim için hatırla.';
const OBLIGATION_TEXT =
  '"Siparişi onayla"ya bastığınızda siparişiniz kesinleşir ve ödeme yükümlülüğü doğar. Gıda siparişleri çabuk bozulabilen ürünler olduğundan cayma hakkı kapsamı dışındadır.';

type Fulfillment = 'delivery' | 'pickup';

function paymentOptions(store: StorefrontView, f: Fulfillment): PaymentMethod[] {
  const list = store.branch.paymentMethods.filter((m) => m !== 'online_card' && m !== 'pay_at_counter');
  return f === 'pickup' ? ['pay_at_counter', ...list] : list;
}

const PAYMENT_HINTS: Partial<Record<PaymentMethod, string>> = {
  card_on_delivery: 'Kurye POS cihazı getirecek.',
  meal_card_on_delivery: 'Kurye doğru cihazı getirsin diye markayı soruyoruz.',
  pay_at_counter: 'Siparişinizi alırken kasada ödersiniz.',
};

/** Toplamın üstündeki yuvarlak tutarlar (03 §6: "Tam para · 500 · 1.000 · Diğer"). */
function changeChips(totalKurus: number): number[] {
  const tl = totalKurus / 100;
  const out = new Set<number>();
  for (const step of [50, 100, 200, 500, 1000]) {
    const v = Math.ceil((tl + 0.001) / step) * step;
    if (v > tl) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}

export function CheckoutPage({ slug, store }: { slug: string; store: StorefrontView }) {
  const router = useRouter();
  const cart = useCart(slug);
  const session = useStoreSession(slug);
  const zones = store.zones;
  const neighborhoods = useMemo(() => allNeighborhoods(zones.map((z) => ({ ...z, isActive: true }))), [zones]);
  const otherZones = zones.filter((z) => z.kind !== 'neighborhoods');
  const canDeliver = store.branch.acceptsDelivery && zones.length > 0;
  const canPickup = store.branch.acceptsPickup;

  const [fulfillment, setFulfillment] = useState<Fulfillment>(canDeliver ? 'delivery' : 'pickup');
  const [neighborhood, setNeighborhood] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [directions, setDirections] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [mealBrand, setMealBrand] = useState('');
  const [changeFor, setChangeFor] = useState<'exact' | number | 'other' | null>(null);
  const [changeOther, setChangeOther] = useState('');
  const [cutlery, setCutlery] = useState(false);
  const [note, setNote] = useState('');
  const [accept, setAccept] = useState(false);
  // "Bu cihazda hatırla" (03 §4.4): yalnız Akış B'de, varsayılan işaretsiz (opt-in)
  const [remember, setRemember] = useState(false);
  const [preInfoOpen, setPreInfoOpen] = useState(false);

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitNote, setSubmitNote] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ code: string; message: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ res: CreateOrderResponse; token: string } | null>(null);
  const idemKey = useRef<string>('');
  if (!idemKey.current) idemKey.current = newIdempotencyKey();

  const items = cart.toItems();
  const itemsKey = JSON.stringify(items);
  const flowA = session.status === 'ready' && session.data?.linkStatus === 'active';
  const orderingOpen = (store.orderingEnabled ?? true) && (store.branch.orderingState === 'open' || store.branch.orderingState === 'busy');

  // Canlı fiyat: sepet, teslim türü ve adres değişince (400 ms gecikmeli)
  useEffect(() => {
    if (!items.length) {
      setQuote(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setQuoting(true);
      setQuoteError(null);
      try {
        const q = await apiFetch<QuoteResponse>(`/store/${encodeURIComponent(slug)}/quote`, {
          method: 'POST',
          signal: ctrl.signal,
          body: {
            items,
            fulfillmentType: fulfillment,
            ...(fulfillment === 'delivery' && neighborhood ? { neighborhood } : {}),
            ...(fulfillment === 'delivery' && zoneId ? { zoneId } : {}),
          },
        });
        setQuote(q);
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        setQuoteError(errorMessage(e, 'Tutar hesaplanamadı.'));
      } finally {
        setQuoting(false);
      }
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, fulfillment, neighborhood, zoneId, slug]);

  // Teslim türü değişince uygun olmayan ödeme yöntemini sıfırla
  useEffect(() => {
    if (payment && !paymentOptions(store, fulfillment).includes(payment)) setPayment(null);
  }, [fulfillment, payment, store]);

  const total = quote?.totalKurus ?? cart.subtotalKurus;
  const deliveryProblems = (quote?.problems ?? []).filter((p) => p.code === 'out_of_delivery_area');
  const blocking = (quote?.problems ?? []).filter((p) => !(p.code === 'out_of_delivery_area' && fulfillment === 'delivery' && !neighborhood && !zoneId));
  const zoneMatched = fulfillment === 'delivery' && quote?.zone;
  const eta = zoneMatched
    ? etaRange({ zoneEtaMinutes: quote!.zone!.etaMinutes, prepMinutes: store.branch.prepMinutes, busyExtraMinutes: store.branch.busyExtraMinutes ?? 0 })
    : etaRange({ prepMinutes: store.branch.prepMinutes, busyExtraMinutes: store.branch.busyExtraMinutes ?? 0 });

  const changeForKurus =
    payment !== 'cash_on_delivery' || changeFor === null || changeFor === 'exact'
      ? undefined
      : changeFor === 'other'
        ? Math.round(Number(changeOther.replace(',', '.')) * 100) || undefined
        : changeFor * 100;

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (fulfillment === 'delivery') {
      if (!neighborhood && !zoneId) e.neighborhood = 'Mahallenizi seçin.';
      if (addressLine.trim().length < 5) e.addressLine = 'Sokak, bina no ve daire bilgisini yazın.';
    }
    if (name.trim().length < 2) e.customerName = 'Adınızı yazın.';
    if (phone.replace(/\D/g, '').length < 10) e.customerPhone = 'Telefon numarası 10 haneli olmalı (5xx xxx xx xx).';
    if (!payment) e.paymentMethod = 'Ödeme yöntemini seçin.';
    if (payment === 'meal_card_on_delivery' && !mealBrand) e.mealCardBrand = 'Yemek kartı markasını seçin.';
    if (payment === 'cash_on_delivery' && changeFor === 'other' && (!changeForKurus || changeForKurus < total)) {
      e.changeForKurus = 'Tutar sipariş toplamından az olamaz.';
    }
    if (!accept) e.acceptPreInfo = 'Ön bilgilendirmeyi onaylayın.';
    return e;
  };

  const submit = async () => {
    const errs = validate();
    setFieldErrors(errs);
    setFormError(null);
    setProblems([]);
    if (Object.keys(errs).length) {
      const firstKey = Object.keys(errs)[0];
      document.querySelector<HTMLElement>(`[data-field="${firstKey}"] input, [data-field="${firstKey}"] select, [data-field="${firstKey}"] textarea`)?.focus();
      return;
    }
    setSubmitting(true);
    const body = {
      items,
      fulfillmentType: fulfillment,
      ...(fulfillment === 'delivery' && neighborhood ? { neighborhood } : {}),
      ...(fulfillment === 'delivery' && zoneId ? { zoneId } : {}),
      customerName: name.trim(),
      customerPhone: phone.trim(),
      ...(fulfillment === 'delivery' ? { addressLine: addressLine.trim(), ...(directions.trim() ? { directions: directions.trim() } : {}) } : {}),
      paymentMethod: payment,
      ...(payment === 'meal_card_on_delivery' ? { mealCardBrand: mealBrand } : {}),
      ...(changeForKurus ? { changeForKurus } : {}),
      wantsCutlery: cutlery,
      ...(note.trim() ? { note: note.trim() } : {}),
      acceptPreInfo: true,
      idempotencyKey: idemKey.current,
      ...(!flowA && remember ? { rememberDevice: true } : {}),
    };
    try {
      let res: CreateOrderResponse | null = null;
      for (let attempt = 0; attempt < 4 && !res; attempt++) {
        try {
          res = await apiFetch<CreateOrderResponse>(`/store/${encodeURIComponent(slug)}/orders`, { method: 'POST', body });
        } catch (e) {
          if (isApiError(e) && e.status === 0 && attempt < 3) {
            setSubmitNote('Bağlantı koptu, tekrar deneniyor…');
            await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            continue;
          }
          throw e;
        }
      }
      setSubmitNote(null);
      if (!res) throw new ApiError(0, 'network_error', 'Sunucuya ulaşılamadı.');
      const token = new URL(res.trackingUrl, window.location.origin).pathname.split('/t/')[1] ?? '';
      cart.clear();
      if (res.status === 'awaiting_customer') {
        setResult({ res, token });
        window.scrollTo({ top: 0 });
      } else {
        router.push(`/t/${token}`);
      }
    } catch (e) {
      setSubmitNote(null);
      if (isApiError(e)) {
        if (e.status >= 400 && e.status < 500) idemKey.current = newIdempotencyKey();
        if (e.code === 'cart_invalid') {
          setProblems(((e.details as { problems?: { code: string; message: string }[] })?.problems ?? []).slice(0, 5));
          setFormError('Sepetinizde değişiklik gerekiyor.');
        } else if (e.code === 'ordering_closed') {
          setFormError('İşletme şu an sipariş almıyor. Sepetiniz saklandı.');
        } else {
          const fe = fieldErrorsOf(e);
          setFieldErrors(fe);
          setFormError(errorMessage(e));
        }
      } else {
        setFormError('Sipariş gönderilemedi. Tekrar deneyin.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return <VerificationScreen token={result.token} initial={result.res} phone={phone} slug={slug} businessName={store.tenant.name} businessPhone={store.branch.phone ?? store.tenant.phone} />;
  }

  if (!items.length) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="Sepetiniz boş"
        description="Menüden ürün ekleyip siparişinizi burada tamamlayabilirsiniz."
        className="mt-6"
        action={
          <Link href={storefrontHref(slug)} className={cn(brandButtonClass, 'min-h-hit')}>
            Menüye dön
          </Link>
        }
      />
    );
  }

  const payOpts = paymentOptions(store, fulfillment);
  const chipAmounts = changeChips(total);

  return (
    <div className="flex flex-col gap-5 pb-8">
      <div className="flex items-center gap-2">
        <Link href={storefrontHref(slug)} className="inline-flex min-h-hit items-center gap-1 rounded-md pe-2 font-semibold">
          <ArrowLeft aria-hidden className="size-5" /> Menü
        </Link>
        <h1 className="ms-auto text-xl font-bold">Siparişi tamamla</h1>
      </div>

      {!orderingOpen ? (
        <Alert variant="warning" title="İşletme şu an sipariş almıyor">
          Sepetiniz saklandı. Açılınca siparişinizi tamamlayabilirsiniz.
        </Alert>
      ) : null}

      {/* 1 TESLİMAT */}
      <section aria-labelledby="teslimat" className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
        <h2 id="teslimat" className="text-base font-bold">
          1 · Teslimat
        </h2>
        {canDeliver && canPickup ? (
          <RadioGroup
            legend="Teslim türü"
            hideLegend
            variant="chips"
            value={fulfillment}
            onValueChange={(v) => setFulfillment(v as Fulfillment)}
            options={[
              { value: 'delivery', label: 'Paket servis' },
              { value: 'pickup', label: 'Gel-al' },
            ]}
          />
        ) : (
          <p className="inline-flex items-center gap-2 font-semibold">
            {fulfillment === 'delivery' ? <Bike aria-hidden className="size-5" /> : <Store aria-hidden className="size-5" />}
            {fulfillment === 'delivery' ? 'Paket servis' : 'Gel-al'}
          </p>
        )}
        {fulfillment === 'delivery' ? (
          <>
            {neighborhoods.length ? (
              <div data-field="neighborhood">
                <Field label="Mahalle" required error={fieldErrors.neighborhood}>
                  <Select
                    value={neighborhood}
                    placeholder="Mahallenizi seçin"
                    onChange={(e) => {
                      setNeighborhood(e.target.value);
                      if (e.target.value) setZoneId('');
                    }}
                    options={neighborhoods.map((n) => ({ value: n, label: n }))}
                  />
                </Field>
              </div>
            ) : null}
            {otherZones.length ? (
              <Field label={neighborhoods.length ? 'Mahalleniz listede yoksa bölge' : 'Bölge'} error={!neighborhoods.length ? fieldErrors.neighborhood : undefined}>
                <Select
                  value={zoneId}
                  placeholder="Bölge seçin"
                  onChange={(e) => {
                    setZoneId(e.target.value);
                    if (e.target.value) setNeighborhood('');
                  }}
                  options={otherZones.map((z) => ({ value: z.id, label: z.name }))}
                />
              </Field>
            ) : null}
            {zoneMatched ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-status-ready-fg" aria-live="polite">
                <MapPin aria-hidden className="size-4" />
                Teslimat bölgesindesiniz · {quote!.zone!.feeKurus ? formatMoney(quote!.zone!.feeKurus) : 'Ücretsiz teslimat'} · Min. {formatMoney(quote!.zone!.minOrderKurus)} · {eta.label}
              </p>
            ) : (neighborhood || zoneId) && deliveryProblems.length ? (
              <Alert variant="warning">
                Bu adrese teslimat yok.{canPickup ? ' Gel-al ile devam edebilirsiniz.' : ''}
                {canPickup ? (
                  <Button variant="secondary" size="sm" className="ms-2" onClick={() => setFulfillment('pickup')}>
                    Gel-al ile devam
                  </Button>
                ) : null}
              </Alert>
            ) : null}
            <div data-field="addressLine">
              <Field label="Adres" required hint="Sokak, bina no, kat ve daire" error={fieldErrors.addressLine}>
                <Textarea rows={2} value={addressLine} maxLength={300} autoComplete="street-address" onChange={(e) => setAddressLine(e.target.value)} />
              </Field>
            </div>
            <Field label="Adres tarifi" hint="Örn: Eczanenin üstü, zile 2 kez basın">
              <Input value={directions} maxLength={300} onChange={(e) => setDirections(e.target.value)} />
            </Field>
          </>
        ) : (
          <p className="text-base">
            {store.branch.address ? `${store.branch.address} · ` : ''}Tahminen {eta.minMinutes} dk&apos;da hazır.
          </p>
        )}
      </section>

      {/* 2 İLETİŞİM */}
      <section aria-labelledby="iletisim" className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
        <h2 id="iletisim" className="text-base font-bold">
          2 · İletişim
        </h2>
        <div data-field="customerName">
          <Field label="Adınız" required error={fieldErrors.customerName}>
            <Input value={name} autoComplete="name" maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div data-field="customerPhone">
          <Field label="Teslimat telefonu" required hint="0 (5xx) xxx xx xx" error={fieldErrors.customerPhone}>
            <Input value={phone} type="tel" inputMode="tel" autoComplete="tel" maxLength={20} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        {flowA && session.data?.customer ? (
          <p className="flex items-start gap-2 text-sm text-fg-muted">
            <MessageCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              Bu sipariş WhatsApp&apos;ta {session.data.customer.name ?? 'sizin'}
              {session.data.customer.phoneMasked ? ` (${session.data.customer.phoneMasked})` : ''} adına verilecek ·{' '}
              <button type="button" className="font-semibold underline underline-offset-4" onClick={() => void session.forget()}>
                Ben değilim
              </button>
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-2 text-sm text-fg-muted">
            <MessageCircle aria-hidden className="mt-0.5 size-4 shrink-0" /> Sipariş durumunu {store.tenant.name} WhatsApp&apos;tan bildirecek.
          </p>
        )}
      </section>

      {/* 3 ÖDEME */}
      <section aria-labelledby="odeme" className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
        <h2 id="odeme" className="text-base font-bold">
          3 · Ödeme ({fulfillment === 'pickup' ? 'kasada ya da kapıda' : 'kapıda'})
        </h2>
        <div data-field="paymentMethod">
          <RadioGroup
            legend="Ödeme yöntemi"
            hideLegend
            value={payment}
            onValueChange={(v) => setPayment(v)}
            error={fieldErrors.paymentMethod}
            options={payOpts.map((m) => ({ value: m, label: m === 'pay_at_counter' ? 'Kasada öde' : PAYMENT_METHOD_LABELS[m], description: PAYMENT_HINTS[m] }))}
          />
        </div>
        {payment === 'meal_card_on_delivery' ? (
          <div data-field="mealCardBrand">
            <Field label="Yemek kartı markası" required error={fieldErrors.mealCardBrand}>
              <Select
                value={mealBrand}
                placeholder="Marka seçin"
                onChange={(e) => setMealBrand(e.target.value)}
                options={store.branch.mealCardBrands.map((b) => ({ value: b, label: MEAL_CARD_BRAND_LABELS[b as MealCardBrand] ?? b }))}
              />
            </Field>
          </div>
        ) : null}
        {payment === 'cash_on_delivery' ? (
          <div className="flex flex-col gap-2" data-field="changeForKurus">
            <RadioGroup
              legend="Kaç TL ile ödeyeceksiniz?"
              variant="chips"
              value={changeFor === null ? null : String(changeFor)}
              onValueChange={(v) => setChangeFor(v === 'exact' || v === 'other' ? v : Number(v))}
              options={[
                { value: 'exact', label: 'Tam para' },
                ...chipAmounts.map((a) => ({ value: String(a), label: `${a.toLocaleString('tr-TR')} TL` })),
                { value: 'other', label: 'Diğer' },
              ]}
              error={fieldErrors.changeForKurus}
            />
            {changeFor === 'other' ? (
              <Field label="Tutar (TL)">
                <Input inputMode="decimal" value={changeOther} onChange={(e) => setChangeOther(e.target.value)} />
              </Field>
            ) : null}
            {changeForKurus && changeForKurus > total ? (
              <p className="text-sm text-fg-muted">
                {formatMoney(changeForKurus)}&apos;ye para üstü: {formatMoney(changeForKurus - total)}
              </p>
            ) : null}
          </div>
        ) : null}
        <Checkbox label="Çatal-bıçak istiyorum" checked={cutlery} onChange={(e) => setCutlery(e.target.checked)} />
        <Field label="Sipariş notu" hint={`${note.length}/140 · Alerji gibi sağlık bilgisi yazmayın.`}>
          <Textarea rows={2} maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </section>

      {/* 4 ÖZET VE ONAY */}
      <section aria-labelledby="ozet" className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
        <h2 id="ozet" className="flex items-center gap-2 text-base font-bold">
          4 · Özet {quoting ? <Spinner size="sm" label="Tutar hesaplanıyor" /> : null}
        </h2>
        <ul className="flex flex-col gap-1">
          {(quote?.lines ?? []).map((l, i) => (
            <li key={`${l.productId}-${i}`} className="flex justify-between gap-3 text-base">
              <span className="min-w-0">
                {l.quantity}× {l.name}
                {l.options.length ? <span className="block text-sm text-fg-muted">{l.options.map((o) => o.optionName).join(', ')}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums">{formatMoney(l.lineTotalKurus)}</span>
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-border pt-2">
          <dt className="text-fg-muted">Ara toplam</dt>
          <dd className="text-end tabular-nums">{formatMoney(quote?.subtotalKurus ?? cart.subtotalKurus)}</dd>
          {fulfillment === 'delivery' ? (
            <>
              <dt className="text-fg-muted">Teslimat ücreti</dt>
              <dd className="text-end tabular-nums">{quote?.zone ? (quote.deliveryFeeKurus ? formatMoney(quote.deliveryFeeKurus) : 'Ücretsiz') : '—'}</dd>
            </>
          ) : null}
          <dt className="text-lg font-bold">Toplam (KDV dahil)</dt>
          <dd className="text-end text-lg font-bold tabular-nums">{formatMoney(total)}</dd>
        </dl>
        {quoteError ? <Alert variant="warning">{quoteError}</Alert> : null}
        {blocking.filter((p) => p.code !== 'out_of_delivery_area').length ? (
          <Alert variant="warning" title="Sepetinizi kontrol edin">
            <ul className="list-disc ps-5">
              {blocking
                .filter((p) => p.code !== 'out_of_delivery_area')
                .map((p, i) => (
                  <li key={i}>{p.message}</li>
                ))}
            </ul>
          </Alert>
        ) : null}
        <div data-field="acceptPreInfo" className="flex flex-col gap-1">
          <Checkbox
            label="Ön bilgilendirme formunu ve mesafeli satış sözleşmesini okudum, onaylıyorum."
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
            error={fieldErrors.acceptPreInfo}
          />
          <p className="flex flex-wrap gap-x-3 text-sm">
            <button type="button" className="inline-flex min-h-hit-sf items-center gap-1 font-semibold underline underline-offset-4" onClick={() => setPreInfoOpen(true)}>
              <FileText aria-hidden className="size-4" /> Ön bilgilendirme formu
            </button>
            <a href="/yasal/mesafeli-satis-sablonu" target="_blank" rel="noreferrer" className="inline-flex min-h-hit-sf items-center font-semibold underline underline-offset-4">
              Mesafeli satış sözleşmesi
            </a>
            <a href="/yasal/kvkk-aydinlatma" target="_blank" rel="noreferrer" className="inline-flex min-h-hit-sf items-center font-semibold underline underline-offset-4">
              Aydınlatma metni
            </a>
          </p>
        </div>
        {!flowA ? (
          <Checkbox
            label={REMEMBER_DEVICE_TEXT}
            description="90 gün hatırlanır; doğrulama adımı yine istenir. Menüdeki “Bu cihazı unut” ile silebilirsiniz."
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
        ) : null}
      </section>

      {formError ? (
        <Alert variant="danger" title={formError}>
          {problems.length ? (
            <ul className="list-disc ps-5">
              {problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      {submitNote ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted" aria-live="polite">
          <CircleAlert aria-hidden className="size-4" /> {submitNote}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !orderingOpen || quoting}
          aria-busy={submitting || undefined}
          className={cn(brandButtonClass, 'min-h-hit-primary w-full text-lg disabled:opacity-50')}
        >
          {submitting ? <Spinner size="sm" /> : null}
          Siparişi onayla · {formatMoney(total)}
        </button>
        <p className="text-sm leading-6 text-fg-muted">{OBLIGATION_TEXT}</p>
      </div>

      <Dialog open={preInfoOpen} onOpenChange={setPreInfoOpen} title="Ön bilgilendirme formu" description="Taslak — hukuki inceleme bekliyor." size="lg">
        <PreInfo store={store} quote={quote} fulfillment={fulfillment} payment={payment} />
      </Dialog>
    </div>
  );
}

/** Siparişe göre doldurulmuş ön bilgilendirme özeti (03 §4.4, 00 §9). */
function PreInfo({
  store,
  quote,
  fulfillment,
  payment,
}: {
  store: StorefrontView;
  quote: QuoteResponse | null;
  fulfillment: Fulfillment;
  payment: PaymentMethod | null;
}) {
  const l = store.legal;
  return (
    <div className="flex flex-col gap-3 text-sm leading-6">
      <p>
        <strong>Satıcı:</strong> {l.legalName ?? store.tenant.name}
        {l.taxNo ? ` · VKN ${l.taxNo}` : ''}
        {l.address ? ` · ${l.address}` : ''}
        {l.phone ? ` · ${l.phone}` : ''}
        {l.email ? ` · ${l.email}` : ''}
      </p>
      <div>
        <strong>Ürünler:</strong>
        <ul className="list-disc ps-5">
          {(quote?.lines ?? []).map((line, i) => (
            <li key={i}>
              {line.quantity}× {line.name} — {formatMoney(line.lineTotalKurus)}
            </li>
          ))}
        </ul>
      </div>
      <p>
        <strong>Teslimat ücreti:</strong> {quote ? formatMoney(quote.deliveryFeeKurus) : '—'} · <strong>Toplam (KDV dahil):</strong>{' '}
        {quote ? formatMoney(quote.totalKurus) : '—'}
      </p>
      <p>
        <strong>Teslim:</strong> {fulfillment === 'delivery' ? 'Adrese teslim (paket servis)' : 'Gel-al'} ·{' '}
        <strong>Ödeme:</strong> {payment ? (payment === 'pay_at_counter' ? 'Kasada' : PAYMENT_METHOD_LABELS[payment]) : '—'} (kapıda/kasada)
      </p>
      <p>Gıda siparişleri çabuk bozulabilen ürünler olduğundan cayma hakkı kapsamı dışındadır.</p>
      <p className="text-fg-muted">Bu sipariş {store.tenant.name} tarafından hazırlanır ve teslim edilir. Platform yalnız altyapı sağlayıcısıdır.</p>
    </div>
  );
}

