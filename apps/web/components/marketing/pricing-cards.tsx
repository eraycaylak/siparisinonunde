'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Check, MessageSquareText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatLira } from '@/lib/format';
import {
  FOUNDER_DISCOUNT,
  FOUNDER_MONTHS,
  PLANS,
  TRIAL_DAYS,
  YEARLY_DISCOUNT,
  founderMonthly,
  withVat,
  yearlyMonthly,
  yearlyTotal,
  type Plan,
} from '@/lib/plans';

type Billing = 'monthly' | 'yearly';

function PlanCard({ plan, billing }: { plan: Plan; billing: Billing }) {
  const monthly = billing === 'monthly' ? plan.monthlyTl : yearlyMonthly(plan);
  const unit = plan.perBranch ? '/ay · şube başı' : '/ay';
  const founder = founderMonthly(plan);
  return (
    <article
      aria-labelledby={`plan-${plan.code}`}
      className={cn(
        'relative flex flex-col gap-5 rounded-xl border bg-surface-raised p-6 shadow-sm',
        plan.recommended ? 'border-2 border-primary' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`plan-${plan.code}`} className="text-2xl font-bold text-fg">
          {plan.name}
        </h3>
        {plan.recommended ? <Badge variant="brand">Önerilen</Badge> : null}
        {!plan.availableNow ? <Badge variant="outline">Yakında</Badge> : null}
      </div>
      <p className="text-base text-fg-muted">{plan.audience}</p>
      <div className="flex flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-4xl font-bold tracking-tight text-fg tabular-nums">{formatLira(monthly)}</span>
          <span className="text-base text-fg-muted">
            {unit} + KDV
          </span>
        </p>
        <p className="text-sm text-fg-muted tabular-nums">KDV dahil {formatLira(withVat(monthly))}</p>
        {billing === 'yearly' ? (
          <p className="text-sm text-fg-muted tabular-nums">
            Yıllık peşin {formatLira(yearlyTotal(plan))} + KDV (KDV dahil {formatLira(withVat(yearlyTotal(plan)))})
            {plan.perBranch ? ' · şube başı' : ''}
          </p>
        ) : null}
      </div>
      <div className="rounded-md bg-surface p-3 text-sm text-fg">
        <p className="font-semibold">
          Kurucu üye: {formatLira(founder)} {unit} + KDV
        </p>
        <p className="text-fg-muted tabular-nums">
          KDV dahil {formatLira(withVat(founder))} · {FOUNDER_MONTHS} ay boyunca %{FOUNDER_DISCOUNT * 100} indirim
        </p>
      </div>
      <ul className="flex flex-col gap-2 text-base text-fg">
        {plan.highlights.map((h) => (
          <li key={h} className="flex items-start gap-2">
            <Check aria-hidden className="mt-1 size-4 shrink-0 text-status-ready-fg" />
            <span>{h}</span>
          </li>
        ))}
        <li className="flex items-start gap-2">
          <MessageSquareText aria-hidden className="mt-1 size-4 shrink-0 text-fg-muted" />
          <span>{plan.smsQuota} (doğrulama ve kritik durum SMS’leri)</span>
        </li>
      </ul>
      <div className="mt-auto pt-2">
        {plan.availableNow ? (
          <Link
            href={`/panel/kayit?paket=${plan.code}`}
            className={buttonVariants({ variant: plan.recommended ? 'primary' : 'secondary', size: 'lg', block: true })}
          >
            {TRIAL_DAYS} gün ücretsiz dene
          </Link>
        ) : (
          <Link href="/demo" className={buttonVariants({ variant: 'secondary', size: 'lg', block: true })}>
            Bize ulaş
          </Link>
        )}
      </div>
    </article>
  );
}

/** Paket kartları + aylık/yıllık anahtarı. Büyük rakam KDV hariç, altında KDV dahil (05 C.3.3). */
export function PricingCards({ plans = PLANS }: { plans?: readonly Plan[] }) {
  const [billing, setBilling] = useState<Billing>('monthly');
  return (
    <div className="flex flex-col gap-8">
      <div role="radiogroup" aria-label="Ödeme dönemi" className="mx-auto inline-flex rounded-lg border border-border bg-surface p-1">
        {(
          [
            ['monthly', 'Aylık'],
            ['yearly', `Yıllık peşin · %${YEARLY_DISCOUNT * 100} indirim`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={billing === value}
            onClick={() => setBilling(value)}
            className={cn(
              'min-h-hit rounded-md px-4 text-sm font-semibold transition-colors sm:text-base',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              billing === value ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {plans.map((p) => (
          <PlanCard key={p.code} plan={p} billing={billing} />
        ))}
      </div>
    </div>
  );
}
