'use client';

// Telefon siparişi (Akış E, P-06, 04 §4.13): telefonla müşteri bul/oluştur, "Aynısını ekle", menüden ürün,
// bölge/mahalle (bölge dışı istisna uyarıyla), ödeme, not, süre ve "Onaylı olarak kaydet". Toplamı sunucu hesaplar;
// ekrandaki tutar POST /store/:slug/quote önizlemesidir.

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Minus, Plus, Search, Trash2, UserRound } from 'lucide-react';
import type { QuoteResponse } from '@siparis/core/contracts/store';
import type { CustomerLookupResponse, ManualMenuResponse, OrderCardResponse } from '@siparis/core/orders/contracts';
import { MEAL_CARD_BRAND_LABELS, PAYMENT_METHOD_LABELS, type MealCardBrand, type PaymentMethod } from '@siparis/core/enums';
import { allNeighborhoods } from '@siparis/core/zones';
import { Alert, Badge, Button, Checkbox, EmptyState, Field, IconButton, Input, PageHeader, RadioGroup, Select, Sheet, Spinner, Switch, Textarea } from '@/components/ui';
import { apiFetch, errorMessage, fieldErrorsOf, isApiError, newIdempotencyKey, useApiQuery } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatMoney, formatRelative, searchKey } from '@/lib/format';
import { ETA_CHIPS } from './labels';

type Product = ManualMenuResponse['categories'][number]['products'][number];

interface Line {
  key: string;
  productId: string;
  name: string;
  quantity: number;
  optionIds: string[];
  optionLabels: string[];
  unitPriceKurus: number;
}

const lineKey = (productId: string, optionIds: string[]) => `${productId}|${[...optionIds].sort().join(',')}`;

export function PhoneOrder() {
  const router = useRouter();
  const me = useMe();
  const slug = me.data?.tenant?.slug ?? '';
  const menu = useApiQuery<ManualMenuResponse>(['panel', 'orders', 'manual-menu'], '/panel/orders/manual/menu', { staleTime: 60_000 });

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>('delivery');
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('');
  const [picking, setPicking] = useState<Product | null>(null);
  const [neighborhood, setNeighborhood] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [directions, setDirections] = useState('');
  const [override, setOverride] = useState(false);
  const [overrideFee, setOverrideFee] = useState('');
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [mealBrand, setMealBrand] = useState('');
  const [changeFor, setChangeFor] = useState('');
  const [note, setNote] = useState('');
  const [acceptNow, setAcceptNow] = useState(true);
  const [eta, setEta] = useState<number | null>(null);
  const [notifyWa, setNotifyWa] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const idem = useRef(newIdempotencyKey());

  const digits = phone.replace(/\D/g, '');
  const lookup = useApiQuery<CustomerLookupResponse>(['panel', 'orders', 'lookup', digits], digits.length >= 4 ? '/panel/orders/manual/customers' : null, {
    query: { phone: digits },
    staleTime: 10_000,
  });

  const m = menu.data;
  const neighborhoods = useMemo(() => (m ? allNeighborhoods(m.zones.map((z) => ({ ...z, isActive: true }))) : []), [m]);
  useEffect(() => {
    if (m && !m.branch.acceptsDelivery) setFulfillment('pickup');
  }, [m]);

  const products = useMemo(() => {
    if (!m) return [];
    const all = m.categories.flatMap((c) => c.products.map((p) => ({ ...p, categoryId: c.id })));
    const key = searchKey(search);
    return all.filter((p) => (key ? searchKey(p.name).includes(key) : !category || p.categoryId === category));
  }, [m, search, category]);

  // Önizleme fiyatı (sunucu)
  const itemsKey = JSON.stringify(lines.map((l) => [l.productId, l.quantity, l.optionIds]));
  useEffect(() => {
    if (!slug || !lines.length) {
      setQuote(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      apiFetch<QuoteResponse>(`/store/${encodeURIComponent(slug)}/quote`, {
        method: 'POST',
        signal: ctrl.signal,
        body: {
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, optionIds: l.optionIds })),
          fulfillmentType: fulfillment,
          ...(fulfillment === 'delivery' && neighborhood ? { neighborhood } : {}),
        },
      })
        .then(setQuote)
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, itemsKey, fulfillment, neighborhood]);

  const outOfZone = fulfillment === 'delivery' && Boolean(quote?.problems.some((p) => p.code === 'out_of_delivery_area'));
  const overrideKurus = Math.round(Number(overrideFee.replace(',', '.') || '0') * 100);
  const previewTotal = (quote?.subtotalKurus ?? lines.reduce((n, l) => n + l.unitPriceKurus * l.quantity, 0)) + (outOfZone ? (override ? overrideKurus : 0) : (quote?.deliveryFeeKurus ?? 0));
  const suggestedEta = m ? Math.max(5, Math.ceil(((fulfillment === 'delivery' ? (quote?.zone?.etaMinutes ?? 0) : 0) + m.branch.prepMinutes + m.branch.busyExtraMinutes) / 5) * 5) : 20;
  const payOptions: PaymentMethod[] = m
    ? [
        ...(fulfillment === 'pickup' ? (['pay_at_counter'] as PaymentMethod[]) : []),
        ...(m.branch.paymentMethods as PaymentMethod[]).filter((p) => p !== 'online_card' && p !== 'pay_at_counter'),
      ]
    : [];

  const addLine = (p: Product, optionIds: string[], optionLabels: string[], unit: number) => {
    const key = lineKey(p.id, optionIds);
    setLines((ls) => {
      const ex = ls.find((l) => l.key === key);
      if (ex) return ls.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, l.quantity + 1) } : l));
      return [...ls, { key, productId: p.id, name: p.name, quantity: 1, optionIds, optionLabels, unitPriceKurus: unit }];
    });
  };

  const pickProduct = (p: Product) => {
    if (p.soldOut) return;
    if (p.optionGroups.length) setPicking(p);
    else addLine(p, [], [], p.priceKurus);
  };

  const chooseCustomer = (c: CustomerLookupResponse['items'][number]) => {
    setCustomerId(c.id);
    if (c.name) setName(c.name);
    if (c.phoneE164) setPhone(`0${c.phoneE164.slice(3)}`);
    const a = c.addresses[0];
    if (a) {
      if (a.neighborhood) setNeighborhood(neighborhoods.find((n) => searchKey(n) === searchKey(a.neighborhood!)) ?? a.neighborhood);
      setAddressLine(a.addressLine ?? '');
      setDirections(a.directions ?? '');
    }
  };

  const addSame = (items: CustomerLookupResponse['items'][number]['lastOrders'][number]['items']) => {
    if (!m) return;
    const byId = new Map(m.categories.flatMap((c) => c.products).map((p) => [p.id, p]));
    let skipped = 0;
    for (const it of items) {
      const p = it.productId ? byId.get(it.productId) : undefined;
      if (!p || p.soldOut) {
        skipped++;
        continue;
      }
      const opts = p.optionGroups.flatMap((g) => g.options).filter((o) => it.optionIds.includes(o.id));
      const unit = p.priceKurus + opts.reduce((n, o) => n + o.priceDeltaKurus, 0);
      const key = lineKey(p.id, opts.map((o) => o.id));
      setLines((ls) => {
        const ex = ls.find((l) => l.key === key);
        if (ex) return ls.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, l.quantity + it.quantity) } : l));
        return [...ls, { key, productId: p.id, name: p.name, quantity: it.quantity, optionIds: opts.map((o) => o.id), optionLabels: opts.map((o) => o.name), unitPriceKurus: unit }];
      });
    }
    if (skipped) toast.warning(`${skipped} ürün artık satışta değil, eklenmedi.`);
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (digits.length < 10) e.customerPhone = 'Telefon numarası 10 haneli olmalı.';
    if (name.trim().length < 2) e.customerName = 'Müşterinin adını yazın.';
    if (!lines.length) e.items = 'En az bir ürün ekleyin.';
    if (fulfillment === 'delivery' && addressLine.trim().length < 3) e.addressLine = 'Adresi yazın.';
    if (outOfZone && !override) e.override = 'Bölge dışı: "Yine de kaydet" kutusunu işaretleyin ya da gel-al seçin.';
    if (!payment) e.paymentMethod = 'Ödeme yöntemini seçin.';
    if (payment === 'meal_card_on_delivery' && !mealBrand) e.mealCardBrand = 'Markayı seçin.';
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const changeKurus = payment === 'cash_on_delivery' && changeFor ? Math.round(Number(changeFor.replace(',', '.')) * 100) : undefined;
      const res = await apiFetch<OrderCardResponse>('/panel/orders/manual', {
        method: 'POST',
        body: {
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, optionIds: l.optionIds })),
          fulfillmentType: fulfillment,
          ...(fulfillment === 'delivery' ? { neighborhood: neighborhood || undefined, addressLine: addressLine.trim(), directions: directions.trim() || undefined } : {}),
          ...(outOfZone && override ? { outOfZoneFeeKurus: overrideKurus } : {}),
          customerName: name.trim(),
          customerPhone: phone,
          paymentMethod: payment,
          ...(payment === 'meal_card_on_delivery' ? { mealCardBrand: mealBrand } : {}),
          ...(changeKurus ? { changeForKurus: changeKurus } : {}),
          note: note.trim() || undefined,
          acceptNow,
          ...(acceptNow ? { etaMinutes: eta ?? suggestedEta } : {}),
          notifyWhatsapp: notifyWa,
          idempotencyKey: idem.current,
        },
      });
      toast.success(`#${res.order.number} kaydedildi${acceptNow ? ' ve onaylandı' : ''}.`);
      router.push('/panel');
    } catch (err) {
      if (isApiError(err) && err.status >= 400 && err.status < 500) idem.current = newIdempotencyKey();
      setErrors(fieldErrorsOf(err));
      const problems = isApiError(err) ? ((err.details as { problems?: { message: string }[] })?.problems ?? []) : [];
      setFormError(problems.length ? problems.map((p) => p.message).join(' ') : errorMessage(err, 'Sipariş kaydedilemedi.'));
    } finally {
      setSaving(false);
    }
  };

  if (menu.isPending) return <Spinner label="Menü yükleniyor" />;
  if (menu.isError || !m) return <Alert variant="danger">{errorMessage(menu.error, 'Menü yüklenemedi.')}</Alert>;

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Telefon siparişi" description="Telefonla gelen siparişi kaydedin. Toplamı sistem hesaplar." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* 1 Müşteri */}
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
            <h2 className="text-base font-bold">1 · Müşteri</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Telefon" required hint="0 (5xx) xxx xx xx" error={errors.customerPhone}>
                <Input type="tel" inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setCustomerId(null); }} />
              </Field>
              <Field label="Ad" required error={errors.customerName}>
                <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
            {lookup.data?.items.length ? (
              <ul className="flex flex-col gap-2">
                {lookup.data.items.map((c) => (
                  <li key={c.id} className={cn('flex flex-col gap-2 rounded-md border p-3', customerId === c.id ? 'border-primary' : 'border-border')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <UserRound aria-hidden className="size-5" />
                      <span className="font-semibold">{c.name ?? 'Müşteri'}</span>
                      <Badge size="sm" variant={c.orderCount > 1 ? 'info' : 'neutral'}>
                        {c.orderCount > 0 ? `${c.orderCount} sipariş` : 'Yeni'}
                      </Badge>
                      {c.isBlocked ? <Badge size="sm" variant="danger">Kara listede</Badge> : null}
                      <Button variant="secondary" size="sm" className="ms-auto" onClick={() => chooseCustomer(c)}>
                        Seç
                      </Button>
                    </div>
                    {c.addresses[0] ? (
                      <p className="text-sm text-fg-muted">
                        {c.addresses[0].neighborhood ? `${c.addresses[0].neighborhood} · ` : ''}
                        {c.addresses[0].addressLine}
                      </p>
                    ) : null}
                    {c.lastOrders.map((o) => (
                      <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-fg-muted">
                          #{o.number} · {formatRelative(o.placedAt)} · {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => { chooseCustomer(c); addSame(o.items); }}>
                          <Plus aria-hidden /> Aynısını ekle
                        </Button>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* 2 Ürünler */}
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
            <h2 className="text-base font-bold">2 · Ürünler</h2>
            <Field label="Ürün ara" hideLabel>
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
                <Input className="ps-10" placeholder="Ürün ara (lahmacun, pide…)" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </Field>
            {!search ? (
              <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Kategoriler">
                <Button size="sm" variant={category === '' ? 'primary' : 'secondary'} onClick={() => setCategory('')}>
                  Tümü
                </Button>
                {m.categories.map((c) => (
                  <Button key={c.id} size="sm" variant={category === c.id ? 'primary' : 'secondary'} onClick={() => setCategory(c.id)}>
                    {c.name}
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={p.soldOut}
                  onClick={() => pickProduct(p)}
                  className="flex min-h-hit-primary flex-col items-start justify-center rounded-md border border-border bg-surface px-3 py-2 text-start disabled:opacity-50"
                >
                  <span className="font-semibold leading-tight">{p.name}</span>
                  <span className="text-sm text-fg-muted">{p.soldOut ? 'Tükendi' : formatMoney(p.priceKurus)}</span>
                </button>
              ))}
            </div>
            {products.length === 0 ? <EmptyState title="Ürün bulunamadı" /> : null}
          </section>

          {/* 3 Teslimat */}
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
            <h2 className="text-base font-bold">3 · Teslimat</h2>
            <RadioGroup
              legend="Teslim türü"
              hideLegend
              variant="chips"
              value={fulfillment}
              onValueChange={(v) => setFulfillment(v)}
              options={[
                { value: 'delivery', label: 'Paket', disabled: !m.branch.acceptsDelivery },
                { value: 'pickup', label: 'Gel-al', disabled: !m.branch.acceptsPickup },
              ]}
            />
            {fulfillment === 'delivery' ? (
              <>
                <Field label="Mahalle">
                  <Select value={neighborhood} placeholder="Mahalle seçin" onChange={(e) => setNeighborhood(e.target.value)} options={neighborhoods.map((n) => ({ value: n, label: n }))} />
                </Field>
                <Field label="Adres" required error={errors.addressLine}>
                  <Textarea rows={2} value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
                </Field>
                <Field label="Adres tarifi">
                  <Input value={directions} onChange={(e) => setDirections(e.target.value)} />
                </Field>
                {quote?.zone ? (
                  <p className="text-sm font-semibold text-status-ready-fg">
                    Bölge: {quote.zone.name} · {formatMoney(quote.zone.feeKurus)} · Min. {formatMoney(quote.zone.minOrderKurus)}
                  </p>
                ) : null}
                {outOfZone ? (
                  <Alert variant="warning" title="Bu adres teslimat bölgesi dışında">
                    <Checkbox label="Yine de kaydet (özel ücret)" checked={override} onChange={(e) => setOverride(e.target.checked)} error={errors.override} />
                    {override ? (
                      <Field label="Özel teslimat ücreti (TL)">
                        <Input inputMode="decimal" value={overrideFee} onChange={(e) => setOverrideFee(e.target.value)} />
                      </Field>
                    ) : null}
                    <p className="mt-1 text-xs">İstisna denetim kaydına yazılır.</p>
                  </Alert>
                ) : null}
              </>
            ) : null}
          </section>

          {/* 4 Ödeme ve not */}
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
            <h2 className="text-base font-bold">4 · Ödeme</h2>
            <RadioGroup
              legend="Ödeme yöntemi"
              hideLegend
              variant="chips"
              value={payment}
              onValueChange={(v) => setPayment(v)}
              error={errors.paymentMethod}
              options={payOptions.map((p) => ({ value: p, label: p === 'pay_at_counter' ? 'Kasada öde' : PAYMENT_METHOD_LABELS[p] }))}
            />
            {payment === 'meal_card_on_delivery' ? (
              <Field label="Yemek kartı markası" error={errors.mealCardBrand}>
                <Select
                  value={mealBrand}
                  placeholder="Marka seçin"
                  onChange={(e) => setMealBrand(e.target.value)}
                  options={m.branch.mealCardBrands.map((b) => ({ value: b, label: MEAL_CARD_BRAND_LABELS[b as MealCardBrand] ?? b }))}
                />
              </Field>
            ) : null}
            {payment === 'cash_on_delivery' ? (
              <Field label="Kaç TL ile ödeyecek? (isteğe bağlı)">
                <Input inputMode="decimal" value={changeFor} onChange={(e) => setChangeFor(e.target.value)} />
              </Field>
            ) : null}
            <Field label="Sipariş notu" hint={`${note.length}/140`}>
              <Textarea rows={2} maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </section>
        </div>

        {/* Sepet ve kaydet */}
        <aside className="flex flex-col gap-3 self-start rounded-lg border border-border bg-surface-raised p-4 lg:sticky lg:top-24">
          <h2 className="text-base font-bold">Sipariş</h2>
          {errors.items ? <Alert variant="warning">{errors.items}</Alert> : null}
          {lines.length === 0 ? <p className="text-sm text-fg-muted">Henüz ürün eklenmedi.</p> : null}
          <ul className="flex flex-col gap-2">
            {lines.map((l) => (
              <li key={l.key} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{l.name}</span>
                  {l.optionLabels.length ? <span className="block text-sm text-fg-muted">{l.optionLabels.join(', ')}</span> : null}
                </span>
                <IconButton label="Azalt" size="sm" icon={l.quantity > 1 ? <Minus /> : <Trash2 />} onClick={() => setLines((ls) => ls.flatMap((x) => (x.key === l.key ? (x.quantity > 1 ? [{ ...x, quantity: x.quantity - 1 }] : []) : [x])))} />
                <span className="w-6 text-center font-bold tabular-nums">{l.quantity}</span>
                <IconButton label="Artır" size="sm" icon={<Plus />} onClick={() => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantity: Math.min(50, x.quantity + 1) } : x)))} />
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-border pt-2 text-base">
            <dt className="text-fg-muted">Ara toplam</dt>
            <dd className="text-end tabular-nums">{formatMoney(quote?.subtotalKurus ?? 0)}</dd>
            {fulfillment === 'delivery' ? (
              <>
                <dt className="text-fg-muted">Teslimat</dt>
                <dd className="text-end tabular-nums">{formatMoney(outOfZone ? (override ? overrideKurus : 0) : (quote?.deliveryFeeKurus ?? 0))}</dd>
              </>
            ) : null}
            <dt className="font-bold">Toplam (önizleme)</dt>
            <dd className="text-end font-bold tabular-nums">{formatMoney(previewTotal)}</dd>
          </dl>
          {quote?.problems.filter((p) => p.code !== 'out_of_delivery_area').map((p, i) => (
            <p key={i} className="text-sm text-warning">
              {p.message}
            </p>
          ))}
          <Switch checked={acceptNow} onCheckedChange={setAcceptNow} label="Onaylı olarak kaydet" description="Sipariş doğrudan hazırlığa düşer, alarm çalmaz." />
          {acceptNow ? (
            <RadioGroup
              legend="Hazırlık süresi"
              variant="chips"
              value={String(eta ?? suggestedEta)}
              onValueChange={(v) => setEta(Number(v))}
              options={[...new Set([suggestedEta, ...ETA_CHIPS])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: `${n} dk` }))}
            />
          ) : null}
          <Checkbox
            label="Müşteri WhatsApp'tan bilgilendirilmeyi kabul etti"
            description={'Sorun: "Siparişinizin durumunu WhatsApp\'tan bildirelim mi?"'}
            checked={notifyWa}
            onChange={(e) => setNotifyWa(e.target.checked)}
          />
          {formError ? <Alert variant="danger">{formError}</Alert> : null}
          <Button size="xl" block onClick={save} loading={saving}>
            Siparişi kaydet · {formatMoney(previewTotal)}
          </Button>
        </aside>
      </div>

      <OptionSheet
        product={picking}
        onClose={() => setPicking(null)}
        onAdd={(p, ids, labels, unit) => {
          addLine(p, ids, labels, unit);
          setPicking(null);
        }}
      />
    </div>
  );
}

function OptionSheet({ product: current, onClose, onAdd }: { product: Product | null; onClose: () => void; onAdd: (p: Product, ids: string[], labels: string[], unit: number) => void }) {
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [last, setLast] = useState<Product | null>(current);
  if (current && current !== last) setLast(current);
  const product = current ?? last;
  useEffect(() => setSel({}), [current?.id]);
  const groups = product?.optionGroups ?? [];
  const errors = groups.filter((g) => (sel[g.id]?.length ?? 0) < g.minSelect);
  const chosen = groups.flatMap((g) => g.options.filter((o) => sel[g.id]?.includes(o.id)));
  const unit = (product?.priceKurus ?? 0) + chosen.reduce((n, o) => n + o.priceDeltaKurus, 0);
  return (
    <Sheet
      open={Boolean(current)}
      onOpenChange={(o) => !o && onClose()}
      title={product?.name ?? 'Ürün'}
      footer={
        <Button size="lg" block disabled={!product || errors.length > 0} onClick={() => product && onAdd(product, chosen.map((o) => o.id), chosen.map((o) => o.name), unit)}>
          Ekle · {formatMoney(unit)}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {groups.map((g) => {
          const single = g.maxSelect === 1;
          const current = sel[g.id] ?? [];
          return (
            <fieldset key={g.id} className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">
                {g.name} {g.minSelect > 0 ? <span className="text-destructive">(zorunlu)</span> : null}
                {g.maxSelect && g.maxSelect > 1 ? <span className="text-fg-muted"> · en çok {g.maxSelect}</span> : null}
              </legend>
              <div className="flex flex-wrap gap-2">
                {g.options.map((o) => {
                  const on = current.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setSel((s) => {
                          const cur = s[g.id] ?? [];
                          if (single) return { ...s, [g.id]: on ? [] : [o.id] };
                          if (on) return { ...s, [g.id]: cur.filter((x) => x !== o.id) };
                          if (g.maxSelect != null && cur.length >= g.maxSelect) return s;
                          return { ...s, [g.id]: [...cur, o.id] };
                        })
                      }
                      className={cn('min-h-hit rounded-full border px-3 text-sm font-semibold', on ? 'border-primary bg-accent' : 'border-border')}
                    >
                      {o.name}
                      {o.priceDeltaKurus ? ` +${formatMoney(o.priceDeltaKurus)}` : ''}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
    </Sheet>
  );
}
