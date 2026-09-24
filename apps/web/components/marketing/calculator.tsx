'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Copy, Printer, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { RadioGroup } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/cn';
import {
  DEFAULT_CALCULATOR_INPUT,
  calculateSavings,
  commissionRateFromBreakdown,
  compareSwitchRates,
  decodeCalculatorInput,
  encodeCalculatorInput,
  hasCalculatorParams,
  suggestPlan,
  type BreakdownItems,
  type CalculatorInput,
} from '@/lib/calculator';
import { formatLira, formatNumber, formatPercent } from '@/lib/format';
import { FOUNDER_DISCOUNT, getPlan } from '@/lib/plans';
import { NumberField } from './number-field';

type Mode = 'quick' | 'breakdown';
type PlanChoice = 'esnaf' | 'pro';

const EMPTY_BREAKDOWN: BreakdownItems = {
  commission: 0,
  advertising: 0,
  campaign: 0,
  delivery: 0,
  paymentService: 0,
  other: 0,
};

const K_CHIPS = [
  { value: '0.15', label: '%15', description: 'Kendi kuryemle, iyi sözleşme' },
  { value: '0.25', label: '%25', description: 'Kendi kuryemle, tipik' },
  { value: '0.35', label: '%35', description: 'Platform kuryesiyle' },
];

function tl(v: number) {
  return formatLira(v);
}

function Row({ label, value, sign, strong }: { label: string; value: number; sign?: '+' | '−'; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-2', strong && 'border-t border-border pt-3 font-bold')}>
      <dt className={cn('text-sm', strong ? 'text-fg' : 'text-fg-muted')}>{label}</dt>
      <dd className={cn('tabular-nums', strong ? 'text-lg' : 'text-base text-fg')}>
        {sign && value !== 0 ? `${sign} ` : ''}
        {tl(Math.abs(value))}
      </dd>
    </div>
  );
}

/**
 * Komisyon hesaplayıcı (05 C.4). Varsayılanlar B senaryosunu üretir (6.872,50 TL/ay).
 * Sonuç e-posta/telefon duvarının arkasında değildir; paylaşım linkinde kişisel veri yoktur.
 */
export function Calculator() {
  const [input, setInput] = useState<CalculatorInput>(DEFAULT_CALCULATOR_INPUT);
  const [mode, setMode] = useState<Mode>('quick');
  const [breakdown, setBreakdown] = useState<BreakdownItems>(EMPTY_BREAKDOWN);
  const [breakdownRevenue, setBreakdownRevenue] = useState(0);
  const [breakdownVatIncluded, setBreakdownVatIncluded] = useState(true);
  const [plan, setPlan] = useState<PlanChoice>('pro');
  const [founder, setFounder] = useState(false);
  const [totalDaily, setTotalDaily] = useState<number | null>(null);
  const [branches, setBranches] = useState(1);
  const [announce, setAnnounce] = useState('');

  // Paylaşım linkinden gelen girdiler (ilk yüklemede).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (hasCalculatorParams(sp)) {
      const decoded = decodeCalculatorInput(sp);
      setInput(decoded);
      const esnaf = getPlan('esnaf').monthlyTl;
      if (decoded.subscriptionTl === esnaf || decoded.subscriptionTl === Math.round(esnaf * (1 - FOUNDER_DISCOUNT))) {
        setPlan('esnaf');
      }
    }
  }, []);

  // Abonelik: seçili paket × (kurucu üye ise 0,70).
  useEffect(() => {
    const list = getPlan(plan).monthlyTl;
    const u = founder ? Math.round(list * (1 - FOUNDER_DISCOUNT) * 100) / 100 : list;
    setInput((prev) => (prev.subscriptionTl === u ? prev : { ...prev, subscriptionTl: u }));
  }, [plan, founder]);

  // Kesinti dökümü modu: k = kalemler (KDV hariç) ÷ ciro.
  const breakdownRate = useMemo(
    () => commissionRateFromBreakdown(breakdownRevenue, breakdown, breakdownVatIncluded),
    [breakdownRevenue, breakdown, breakdownVatIncluded],
  );
  const effectiveInput: CalculatorInput = useMemo(
    () =>
      mode === 'breakdown' && breakdownRevenue > 0
        ? { ...input, commissionRate: breakdownRate, monthlyRevenueOverrideTl: breakdownRevenue }
        : { ...input, monthlyRevenueOverrideTl: null },
    [mode, input, breakdownRate, breakdownRevenue],
  );

  const result = useMemo(() => calculateSavings(effectiveInput), [effectiveInput]);
  const strip = useMemo(() => compareSwitchRates(effectiveInput), [effectiveInput]);
  const suggestion = suggestPlan(totalDaily ?? input.dailyOrders, branches);
  const shareQuery = useMemo(() => encodeCalculatorInput(effectiveInput), [effectiveInput]);

  // Ekran okuyucu özeti (gecikmeli, her tuşta değil).
  useEffect(() => {
    const t = setTimeout(() => {
      setAnnounce(
        `Net aylık kazanç ${tl(result.net)}. ${
          result.breakEven ? `Başa baş ayda ${result.breakEven.ordersPerMonth} sipariş.` : 'Bu varsayımlarla başa baş yok.'
        }`,
      );
    }, 900);
    return () => clearTimeout(t);
  }, [result.net, result.breakEven]);

  const set = <K extends keyof CalculatorInput>(key: K, value: CalculatorInput[K]) =>
    setInput((prev) => ({ ...prev, [key]: value }));

  const copyLink = async () => {
    const url = `${window.location.origin}/hesaplayici?${shareQuery}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link kopyalandı. Linkte kişisel bilgi yok.');
    } catch {
      toast.message('Linki kopyalayın', { description: url });
    }
  };

  const positive = result.net >= 0;
  const planLabel =
    suggestion === 'custom' ? 'Özel teklif (5+ şube)' : suggestion === 'zincir' ? 'Zincir (bize ulaş)' : getPlan(suggestion).name;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
      {/* Girdiler */}
      <form
        aria-label="Hesaplayıcı girdileri"
        className="flex min-w-0 flex-col gap-6 rounded-xl border border-border bg-surface-raised p-5 sm:p-6"
        onSubmit={(e) => e.preventDefault()}
        data-print-hide
      >
        <RadioGroup<Mode>
          legend="Nasıl hesaplayalım?"
          variant="chips"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'quick', label: 'Hızlı hesap' },
            { value: 'breakdown', label: 'Kesinti dökümümü gir' },
          ]}
        />

        <NumberField
          label="Günlük pazaryeri siparişin"
          value={input.dailyOrders}
          onChange={(v) => set('dailyOrders', Math.round(v))}
          min={1}
          max={500}
          suffix="adet"
          slider
        />
        <NumberField
          label="Ortalama sepet tutarı"
          value={input.avgBasketTl}
          onChange={(v) => set('avgBasketTl', v)}
          min={50}
          max={5000}
          step={10}
          suffix="TL"
          slider
        />

        {mode === 'quick' ? (
          <div className="flex flex-col gap-3">
            <RadioGroup
              legend="Pazaryerinin senden kestiği oran (KDV hariç)"
              variant="chips"
              value={K_CHIPS.find((c) => Number(c.value) === input.commissionRate)?.value ?? null}
              onValueChange={(v) => set('commissionRate', Number(v))}
              options={K_CHIPS}
            />
            <NumberField
              label="Ya da oranı kendin yaz"
              value={input.commissionRate}
              onChange={(v) => set('commissionRate', v)}
              min={0}
              max={60}
              step={0.5}
              scale={100}
              suffix="%"
            />
          </div>
        ) : (
          <fieldset className="flex min-w-0 flex-col gap-4 rounded-lg border border-border p-4">
            <legend className="px-1 text-sm font-semibold text-fg">Pazaryeri kesinti dökümü (aylık)</legend>
            <p className="text-sm text-fg-muted">
              Kalemleri pazaryeri panelindeki aylık dökümden kopyalayabilirsin. Oran, kalemlerin toplamının ciroya bölünmesiyle bulunur.
            </p>
            <NumberField label="Aylık pazaryeri cirosu" value={breakdownRevenue} onChange={setBreakdownRevenue} min={0} suffix="TL" />
            {(
              [
                ['commission', 'Komisyon'],
                ['advertising', 'Reklam / görünürlük'],
                ['campaign', 'Kampanya katılımı'],
                ['delivery', 'Teslimat / kurye bedeli'],
                ['paymentService', 'Ödeme hizmeti'],
                ['other', 'Diğer'],
              ] as const
            ).map(([key, label]) => (
              <NumberField
                key={key}
                label={label}
                value={breakdown[key]}
                onChange={(v) => setBreakdown((b) => ({ ...b, [key]: v }))}
                min={0}
                suffix="TL"
              />
            ))}
            <Switch
              label="Tutarlar KDV dahil"
              checked={breakdownVatIncluded}
              onCheckedChange={setBreakdownVatIncluded}
            />
            <p className="text-sm font-semibold text-fg" aria-live="polite">
              {breakdownRevenue > 0 ? `Hesaplanan kesinti oranı: ${formatPercent(breakdownRate)}` : 'Önce aylık ciroyu yaz.'}
            </p>
          </fieldset>
        )}

        <RadioGroup
          legend="Kurye"
          variant="chips"
          value={input.courierModel}
          onValueChange={(v) => set('courierModel', v)}
          options={[
            { value: 'own', label: 'Kendi kuryem' },
            { value: 'platform', label: 'Platform kuryesi' },
          ]}
        />
        {input.courierModel === 'platform' ? (
          <NumberField
            label="Kendi kanalında sipariş başı ek kurye maliyeti"
            value={input.extraCourierCostTl}
            onChange={(v) => set('extraCourierCostTl', v)}
            min={0}
            max={200}
            suffix="TL"
            hint="Kurye sağlamıyoruz; kendi kurye maliyetini ekliyoruz. Tipik bant 25–45 TL."
          />
        ) : null}

        <div className="flex flex-col gap-3">
          <RadioGroup
            legend="Siparişlerin ne kadarı kendi kanalına geçer?"
            variant="chips"
            value={['0.1', '0.2', '0.3'].find((v) => Number(v) === input.switchRate) ?? null}
            onValueChange={(v) => set('switchRate', Number(v))}
            options={[
              { value: '0.1', label: '%10' },
              { value: '0.2', label: '%20' },
              { value: '0.3', label: '%30' },
            ]}
          />
          <NumberField
            label="Geçiş oranı"
            value={input.switchRate}
            onChange={(v) => set('switchRate', v)}
            min={0}
            max={100}
            scale={100}
            suffix="%"
          />
        </div>

        <RadioGroup
          legend="Kendi kanalına özel teşvik (sepetin yüzdesi)"
          variant="chips"
          value={['0', '0.05', '0.1'].find((v) => Number(v) === input.incentiveRate) ?? null}
          onValueChange={(v) => set('incentiveRate', Number(v))}
          options={[
            { value: '0', label: '%0' },
            { value: '0.05', label: '%5' },
            { value: '0.1', label: '%10' },
          ]}
        />

        <div className="flex flex-col gap-2">
          <RadioGroup<PlanChoice>
            legend="Paket"
            variant="chips"
            value={plan}
            onValueChange={setPlan}
            options={[
              { value: 'esnaf', label: `Esnaf · ${formatLira(getPlan('esnaf').monthlyTl)}` },
              { value: 'pro', label: `Pro · ${formatLira(getPlan('pro').monthlyTl)}` },
            ]}
          />
          <Switch
            label="Kurucu üye indirimi"
            description="İlk 100 işletme: 12 ay boyunca liste fiyatından %30 indirim"
            checked={founder}
            onCheckedChange={setFounder}
          />
        </div>

        <details className="group rounded-lg border border-border">
          <summary className="flex min-h-hit cursor-pointer list-none items-center px-4 font-semibold text-fg [&::-webkit-details-marker]:hidden">
            Gelişmiş ayarlar
          </summary>
          <div className="flex flex-col gap-4 border-t border-border p-4">
            <NumberField label="Aylık çalışma günü" value={input.daysPerMonth} onChange={(v) => set('daysPerMonth', Math.round(v))} min={20} max={31} suffix="gün" />
            <NumberField label="Kartla ödenen sipariş payı" value={input.cardShare} onChange={(v) => set('cardShare', v)} min={0} max={100} scale={100} suffix="%" />
            <NumberField label="Kart / POS komisyonu" value={input.cardFeeRate} onChange={(v) => set('cardFeeRate', v)} min={0} max={5} step={0.1} scale={100} suffix="%" />
            <Switch
              label="KDV indirebiliyorum"
              description="Kapalıysa (basit usul) kaçınılan komisyon ve abonelik KDV dahil hesaplanır."
              checked={input.vatDeductible}
              onCheckedChange={(v) => set('vatDeductible', v)}
            />
            <NumberField
              label="Toplam günlük paket siparişin (pazaryeri + telefon + WhatsApp)"
              value={totalDaily ?? input.dailyOrders}
              onChange={(v) => setTotalDaily(Math.round(v))}
              min={0}
              max={2000}
              suffix="adet"
              hint="Paket önerisi için."
            />
            <NumberField label="Şube sayısı" value={branches} onChange={(v) => setBranches(Math.max(1, Math.round(v)))} min={1} max={50} />
          </div>
        </details>
      </form>

      {/* Sonuçlar */}
      <section aria-labelledby="sonuc-baslik" className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-20">
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
        <div className="rounded-xl border border-border bg-surface-raised p-5 sm:p-6">
          <h2 id="sonuc-baslik" className="text-sm font-bold uppercase tracking-wider text-fg-muted">
            Bugün pazaryerine ödediğin
          </h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-fg-muted">Aylık gerçek maliyet (KDV hariç)</dt>
              <dd className="text-2xl font-bold tabular-nums text-fg">{tl(result.monthlyCut)}</dd>
              <dd className="text-sm text-fg-muted tabular-nums">Yıllık {tl(result.yearlyCut)}</dd>
            </div>
            <div>
              <dt className="text-sm text-fg-muted">Aylık nakit çıkışı (KDV dahil)</dt>
              <dd className="text-2xl font-bold tabular-nums text-fg">{tl(result.monthlyCash)}</dd>
              <dd className="text-sm text-fg-muted tabular-nums">Yıllık {tl(result.yearlyCash)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-fg-muted tabular-nums">Aylık pazaryeri cirosu: {tl(result.monthlyRevenue)}</p>
        </div>

        <div
          className={cn(
            'rounded-xl border-2 p-5 sm:p-6',
            positive ? 'border-status-ready-fg/50 bg-status-ready-bg' : 'border-status-new-fg/50 bg-status-new-bg',
          )}
        >
          <p className="text-sm font-bold uppercase tracking-wider text-fg-muted">
            Siparişlerin {formatPercent(input.switchRate)}’i kendi kanalına geçerse
          </p>
          <p className={cn('mt-2 flex items-center gap-2 text-4xl font-bold tabular-nums', positive ? 'text-status-ready-fg' : 'text-status-new-fg')}>
            {positive ? <TrendingUp aria-hidden className="size-8" /> : <TrendingDown aria-hidden className="size-8" />}
            {result.net < 0 ? '−' : '+'}
            {tl(Math.abs(result.net))}
            <span className="text-base font-semibold text-fg-muted">/ay</span>
          </p>
          <p className="mt-1 text-base text-fg tabular-nums">
            Yıllık {result.yearlyNet < 0 ? '−' : ''}
            {tl(Math.abs(result.yearlyNet))} net kazanç
          </p>
          {!positive ? (
            <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-status-new-fg">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              Bu varsayımlarla net kazanç negatif. Teşviki %5’e ya da ücretsiz içeceğe düşür.
            </p>
          ) : null}
          <dl className="mt-4 rounded-lg bg-surface-raised px-4 py-2">
            <Row label={`Kaçınılan komisyon (${formatNumber(result.movedOrders, 1)} sipariş)`} value={result.avoidedCommission} sign="+" />
            <Row label="Kendi kanalına teşvik" value={result.incentiveCost} sign="−" />
            <Row label="Kartla tahsilat maliyeti" value={result.cardCost} sign="−" />
            {input.courierModel === 'platform' ? <Row label="Ek kurye maliyeti" value={result.courierCost} sign="−" /> : null}
            <Row label={`Siparişin Önünde ${getPlan(plan).name}${founder ? ' (kurucu üye)' : ''}`} value={result.subscription} sign="−" />
            <Row label="Meta’ya tahmini mesaj ücreti" value={result.metaCost} sign="−" />
            <Row label="Net aylık kazanç" value={result.net} sign={result.net < 0 ? '−' : '+'} strong />
          </dl>
        </div>

        <div className="rounded-xl border border-border bg-surface-raised p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-fg-muted">Geçiş oranına göre net kazanç</h3>
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {strip.map((s) => (
              <li
                key={s.rate}
                className={cn(
                  'flex flex-col items-center rounded-md border p-3 text-center',
                  Math.abs(s.rate - input.switchRate) < 1e-9 ? 'border-2 border-primary' : 'border-border',
                )}
              >
                <span className="text-sm font-semibold text-fg-muted">{formatPercent(s.rate)} geçiş</span>
                <span className={cn('text-base font-bold tabular-nums', s.net < 0 ? 'text-status-new-fg' : 'text-fg')}>
                  {s.net < 0 ? '−' : ''}
                  {tl(Math.abs(s.net))}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-surface-raised p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-fg-muted">Başa baş</h3>
          {result.breakEven ? (
            <p className="mt-2 text-lg text-fg">
              Ayda <strong className="tabular-nums">{result.breakEven.ordersPerMonth} sipariş</strong> kendi kanalına geçerse Siparişin
              Önünde kendini amorti eder; yani günde yaklaşık{' '}
              <strong className="tabular-nums">{formatNumber(result.breakEven.ordersPerDay, 1)}</strong> sipariş.
            </p>
          ) : (
            <p className="mt-2 flex items-start gap-2 text-base font-semibold text-status-new-fg">
              <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
              Bu varsayımlarla kendi kanal kendini amorti etmez. Teşviki düşürmeyi dene.
            </p>
          )}
          <p className="mt-3 flex flex-wrap items-center gap-2 text-base text-fg">
            Önerilen paket: <Badge variant="ink">{planLabel}</Badge>
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" data-print-hide>
          <Link href={`/demo?kaynak=hesaplayici&${shareQuery}`} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            Bu hesapla demo iste
          </Link>
          <Link href="/panel/kayit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            Ücretsiz dene
          </Link>
          <Button variant="ghost" size="lg" onClick={copyLink}>
            <Copy aria-hidden />
            Linki kopyala
          </Button>
          <Button variant="ghost" size="lg" onClick={() => window.print()}>
            <Printer aria-hidden />
            Yazdır / PDF
          </Button>
        </div>

        <aside aria-label="Hesap uyarıları" className="rounded-xl border border-border bg-surface p-5 text-sm leading-6 text-fg-muted">
          <ul className="flex list-disc flex-col gap-1.5 ps-5">
            <li>
              Oranlar sözleşmene, şehrine ve kurye modeline göre değişir. Hazır oranlar kamuya açık kaynaklardaki bantlardır; resmi bir tarife
              yoktur.
            </li>
            <li>Kesinti dökümünü pazaryeri panelinden alabilirsin: kalemler ayrı gösteriliyor.</li>
            <li>Geçiş oranı bir tahmindir, garanti değildir. Müşteri paket içi kart, QR ve doğrudan kanala özel avantajla taşınır.</li>
            <li>KDV mükellefiysen gerçek maliyetin KDV hariç kesintidir; basit usuldeysen KDV dahil tutardır.</li>
            <li>WhatsApp (Meta) mesaj ücreti abonelik dışındadır; tahmini tutarı ayrı satırda gösterdik.</li>
            {input.courierModel === 'platform' ? <li>Kurye sağlamıyoruz; kendi kurye maliyetini ekledik.</li> : null}
            <li>Paketine kart koymadan önce pazaryeri sözleşmendeki yönlendirme maddelerini kontrol et.</li>
          </ul>
        </aside>
      </section>
    </div>
  );
}
