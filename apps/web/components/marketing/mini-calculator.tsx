'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { RadioGroup } from '@/components/ui/radio-group';
import { DEFAULT_CALCULATOR_INPUT, calculateSavings, encodeCalculatorInput } from '@/lib/calculator';
import { formatLira } from '@/lib/format';
import { NumberField } from './number-field';

/** Ana sayfa mini hesaplayıcı: 3 girdi → aylık kesinti + başa baş (05 C.3.1). */
export function MiniCalculator() {
  const [dailyOrders, setDailyOrders] = useState(DEFAULT_CALCULATOR_INPUT.dailyOrders);
  const [avgBasketTl, setAvgBasketTl] = useState(DEFAULT_CALCULATOR_INPUT.avgBasketTl);
  const [commissionRate, setCommissionRate] = useState(DEFAULT_CALCULATOR_INPUT.commissionRate);

  const input = useMemo(
    () => ({ ...DEFAULT_CALCULATOR_INPUT, dailyOrders, avgBasketTl, commissionRate }),
    [dailyOrders, avgBasketTl, commissionRate],
  );
  const r = useMemo(() => calculateSavings(input), [input]);

  return (
    <div className="grid gap-6 rounded-xl border border-border bg-surface-raised p-5 shadow-sm sm:p-8 md:grid-cols-2">
      <div className="flex flex-col gap-5">
        <NumberField label="Günlük pazaryeri siparişin" value={dailyOrders} onChange={(v) => setDailyOrders(Math.round(v))} min={1} max={500} suffix="adet" />
        <NumberField label="Ortalama sepet" value={avgBasketTl} onChange={setAvgBasketTl} min={50} max={5000} suffix="TL" />
        <RadioGroup
          legend="Pazaryeri kesintisi"
          variant="chips"
          value={['0.15', '0.25', '0.35'].find((v) => Number(v) === commissionRate) ?? null}
          onValueChange={(v) => setCommissionRate(Number(v))}
          options={[
            { value: '0.15', label: '%15' },
            { value: '0.25', label: '%25' },
            { value: '0.35', label: '%35' },
          ]}
        />
      </div>
      <div className="flex flex-col justify-between gap-5 rounded-lg bg-surface p-5" aria-live="polite">
        <div>
          <p className="text-sm font-semibold text-fg-muted">Pazaryerine aylık kesinti (KDV hariç)</p>
          <p className="text-3xl font-bold tabular-nums text-fg">{formatLira(r.monthlyCut)}</p>
          <p className="text-sm text-fg-muted tabular-nums">KDV dahil nakit çıkışı {formatLira(r.monthlyCash)}</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-fg-muted">Pro paketin başa baş noktası</p>
          <p className="text-lg text-fg">
            {r.breakEven ? (
              <>
                Ayda <strong className="tabular-nums">{r.breakEven.ordersPerMonth} sipariş</strong> kendi kanalına geçerse kendini amorti eder.
              </>
            ) : (
              'Bu varsayımlarla kendi kanal kendini amorti etmez.'
            )}
          </p>
          <p className="mt-1 text-xs text-fg-muted">Varsayım: %20 geçiş, %10 teşvik, kendi kuryen. Oranlar sözleşmene göre değişir.</p>
        </div>
        <Link href={`/hesaplayici?${encodeCalculatorInput(input)}`} className={buttonVariants({ variant: 'primary', size: 'lg', block: true })}>
          Ayrıntılı hesapla
          <ArrowRight aria-hidden />
        </Link>
      </div>
    </div>
  );
}
