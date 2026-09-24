'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Info, PiggyBank, Table2 } from 'lucide-react';
import {
  CANCEL_REASON_LABELS,
  MEAL_CARD_BRAND_LABELS,
  ORDER_CHANNEL_LABELS,
  PAYMENT_METHOD_LABELS,
  REJECTION_REASON_LABELS,
  labelOf,
  type CancelReason,
  type MealCardBrand,
  type RejectionReason,
} from '@siparis/core';
import type { DailyReport, SavingsReport, SummaryReport } from '@siparis/core/settings/contracts';
import { Section, SettingsError, SettingsLoading } from '@/components/settings/settings-shell';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Switch } from '@/components/ui/switch';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { useApiQuery } from '@/lib/api';
import { currentRole, useMe } from '@/lib/auth';
import { formatDate, formatMoney, formatNumber, toIstanbulDateKey } from '@/lib/format';
import { BarList, ColumnChart, Heatmap, StatTile, VizStyles } from './charts';

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const dayLabel = (date: string) => formatDate(`${date}T12:00:00+03:00`);
const shortTL = (k: number) => formatMoney(k, 'short');

function ackText(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec} sn`;
  return `${Math.floor(sec / 60)} dk ${sec % 60} sn`;
}

/** Raporlar (04 §11): gün sonu kasa özeti, dönem grafiği + ısı haritası, tasarruf kartı. Test siparişleri hariç. */
export function ReportsView() {
  const me = useMe();
  const role = currentRole(me.data);
  const today = toIstanbulDateKey(new Date());
  const [date, setDate] = useState(today);
  const cashier = role === 'cashier';

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <VizStyles />
      <PageHeader title="Raporlar" description="Test siparişleri raporlara dahil edilmez. Günler Türkiye saatine göredir." />
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="secondary" size="icon" aria-label="Önceki gün" onClick={() => setDate(shiftDate(date, -1))} disabled={cashier}>
          <ChevronLeft aria-hidden />
        </Button>
        <label className="flex flex-col gap-1 text-sm font-semibold text-fg">
          Gün
          <input
            type="date"
            value={date}
            max={today}
            disabled={cashier}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="min-h-hit rounded-md border border-border-strong bg-surface-raised px-3 text-base text-fg"
          />
        </label>
        <Button variant="secondary" size="icon" aria-label="Sonraki gün" onClick={() => setDate(shiftDate(date, 1))} disabled={cashier || date >= today}>
          <ChevronRight aria-hidden />
        </Button>
        {date !== today ? (
          <Button variant="ghost" onClick={() => setDate(today)}>
            Bugün
          </Button>
        ) : null}
      </div>
      <DailySection date={date} />
      {!cashier ? (
        <>
          <SummarySection />
          <SavingsSection />
        </>
      ) : null}
    </div>
  );
}

function DailySection({ date }: { date: string }) {
  const q = useApiQuery<DailyReport>(['panel', 'reports', 'daily', date], '/panel/reports/daily', { query: { date } });
  if (q.isPending) return <SettingsLoading rows={2} />;
  if (q.isError) return <SettingsError error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const payments = r.byPaymentMethod.map((p) => ({
    key: `${p.paymentMethod}-${p.mealCardBrand ?? ''}`,
    label: `${PAYMENT_METHOD_LABELS[p.paymentMethod]}${p.mealCardBrand ? ` · ${labelOf(MEAL_CARD_BRAND_LABELS, p.mealCardBrand as MealCardBrand)}` : ''}`,
    value: p.totalKurus,
    valueText: formatMoney(p.totalKurus),
    sub: `${p.count} sip.`,
  }));
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-fg">Gün sonu · {dayLabel(date)}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Teslim edilen" value={formatNumber(r.deliveredCount)} hint={`${r.receivedCount} sipariş alındı`} />
        <StatTile label="Ciro (KDV dahil)" value={formatMoney(r.revenueKurus)} hint={`Teslimat ücreti ${formatMoney(r.deliveryFeeKurus)}`} />
        <StatTile label="Ortalama sepet" value={formatMoney(r.avgBasketKurus)} />
        <StatTile label="Ortalama onay süresi" value={ackText(r.avgAckSeconds)} hint={`${r.slowAckCount} sipariş 2 dk'yı aştı`} />
        <StatTile label="Reddedilen" value={formatNumber(r.rejectedCount)} hint={formatMoney(r.rejectedKurus)} />
        <StatTile label="İptal edilen" value={formatNumber(r.cancelledCount)} hint={formatMoney(r.cancelledKurus)} />
        <StatTile label="Kaçırılan sipariş" value={formatNumber(r.missedCount)} hint="Yanıtsız kalıp otomatik iptal" tone={r.missedCount ? 'danger' : 'success'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Kasa özeti · ödeme yöntemine göre" description="Teslim edilen siparişler.">
          <BarList items={payments} emptyText="Bu gün teslim edilen sipariş yok." />
          {payments.length ? (
            <div className="flex justify-between border-t border-border pt-3 text-base font-bold text-fg">
              <span>Toplam</span>
              <span className="tabular-nums">{formatMoney(r.revenueKurus)}</span>
            </div>
          ) : null}
        </Section>
        <Section title="En çok satanlar" description="Onaylanan ve teslim edilen siparişler, adet.">
          <BarList
            items={r.topProducts.map((p) => ({ key: p.name, label: p.name, value: p.quantity, valueText: `${p.quantity} adet`, sub: formatMoney(p.revenueKurus) }))}
            emptyText="Henüz satış yok."
          />
        </Section>
        {r.byCourier.length ? (
          <Section title="Kurye bazında" description="Kuryenin gün sonu nakit teslimini bu tabloyla kontrol edin.">
            <Table>
              <THead>
                <TR>
                  <TH>Kurye</TH>
                  <TH className="text-end">Teslimat</TH>
                  <TH className="text-end">Nakit</TH>
                  <TH className="text-end">Kart</TH>
                  <TH className="text-end">Yemek kartı</TH>
                </TR>
              </THead>
              <TBody>
                {r.byCourier.map((c) => (
                  <TR key={c.courierUserId ?? 'none'}>
                    <TD>{c.name ?? 'Kuryesiz'}</TD>
                    <TD className="text-end tabular-nums">{c.deliveredCount}</TD>
                    <TD className="text-end tabular-nums">{formatMoney(c.cashKurus)}</TD>
                    <TD className="text-end tabular-nums">{formatMoney(c.cardKurus)}</TD>
                    <TD className="text-end tabular-nums">{formatMoney(c.mealCardKurus)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        ) : null}
        <Section title="Kanal ve ret/iptal sebepleri">
          <BarList
            items={r.byChannel.map((c) => ({ key: c.channel, label: ORDER_CHANNEL_LABELS[c.channel], value: c.count, valueText: `${c.count} sip.`, sub: formatMoney(c.revenueKurus) }))}
            emptyText="Sipariş yok."
          />
          {r.rejectionReasons.length || r.cancelReasons.length ? (
            <ul className="flex flex-col gap-1 border-t border-border pt-3 text-sm text-fg">
              {r.rejectionReasons.map((x) => (
                <li key={`r-${x.reason}`}>
                  Ret · {labelOf(REJECTION_REASON_LABELS, x.reason as RejectionReason) || x.reason}: {x.count}
                </li>
              ))}
              {r.cancelReasons.map((x) => (
                <li key={`c-${x.reason}`}>
                  İptal · {labelOf(CANCEL_REASON_LABELS, x.reason as CancelReason) || x.reason}: {x.count}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      </div>
    </div>
  );
}

function SummarySection() {
  const today = toIstanbulDateKey(new Date());
  const [days, setDays] = useState(30);
  const [asTable, setAsTable] = useState(false);
  const from = shiftDate(today, -(days - 1));
  const q = useApiQuery<SummaryReport>(['panel', 'reports', 'summary', from, today], '/panel/reports/summary', { query: { from, to: today } });
  return (
    <Section title={`Son ${days} gün`} description="Günlük teslim edilen ciro; saat ve güne göre yoğunluk.">
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((d) => (
          <Button key={d} size="sm" variant={d === days ? 'primary' : 'secondary'} aria-pressed={d === days} onClick={() => setDays(d)}>
            {d} gün
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} className="ms-auto">
          <Table2 aria-hidden />
          {asTable ? 'Grafik' : 'Tablo'}
        </Button>
      </div>
      {q.isPending ? (
        <SettingsLoading rows={1} />
      ) : q.isError ? (
        <SettingsError error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <SummaryBody r={q.data} asTable={asTable} />
      )}
    </Section>
  );
}

function pctChange(cur: number, prev: number): string | undefined {
  if (!prev) return undefined;
  const p = Math.round(((cur - prev) / prev) * 100);
  return `Önceki döneme göre ${p >= 0 ? '+' : '−'}%${Math.abs(p)}`;
}

function SummaryBody({ r, asTable }: { r: SummaryReport; asTable: boolean }) {
  const data = r.series.map((s) => ({
    key: s.date,
    label: `${s.date.slice(8, 10)}.${s.date.slice(5, 7)}`,
    value: s.revenueKurus,
    detail: [`${s.deliveredCount} teslim · ${s.receivedCount} sipariş`],
  }));
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Sipariş" value={formatNumber(r.totals.receivedCount)} hint={pctChange(r.totals.receivedCount, r.previous.receivedCount)} />
        <StatTile label="Teslim edilen" value={formatNumber(r.totals.deliveredCount)} />
        <StatTile label="Ciro" value={formatMoney(r.totals.revenueKurus)} hint={pctChange(r.totals.revenueKurus, r.previous.revenueKurus)} />
        <StatTile label="Ortalama sepet" value={formatMoney(r.totals.avgBasketKurus)} />
      </div>
      {asTable ? (
        <Table>
          <THead>
            <TR>
              <TH>Gün</TH>
              <TH className="text-end">Sipariş</TH>
              <TH className="text-end">Teslim</TH>
              <TH className="text-end">Ciro</TH>
            </TR>
          </THead>
          <TBody>
            {r.series.map((s) => (
              <TR key={s.date}>
                <TD>{dayLabel(s.date)}</TD>
                <TD className="text-end tabular-nums">{s.receivedCount}</TD>
                <TD className="text-end tabular-nums">{s.deliveredCount}</TD>
                <TD className="text-end tabular-nums">{formatMoney(s.revenueKurus)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <ColumnChart data={data} formatValue={shortTL} ariaLabel="Günlük teslim edilen ciro" />
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-fg">Saat × gün yoğunluğu</h3>
          <Heatmap matrix={r.heatmap} />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-fg">Kanallar</h3>
          <BarList
            items={r.byChannel.map((c) => ({ key: c.channel, label: ORDER_CHANNEL_LABELS[c.channel], value: c.count, valueText: `${c.count} sip.`, sub: formatMoney(c.revenueKurus) }))}
            emptyText="Sipariş yok."
          />
        </div>
      </div>
    </div>
  );
}

function SavingsSection() {
  const month = toIstanbulDateKey(new Date()).slice(0, 7);
  const [m, setM] = useState(month);
  const [includePhone, setIncludePhone] = useState(false);
  const q = useApiQuery<SavingsReport>(['panel', 'reports', 'savings', m, includePhone], '/panel/reports/savings', { query: { month: m, includePhone: includePhone ? '1' : undefined } });
  return (
    <Section title="Kendi kanalınızın kazancı" description="Pazaryerinden gelseydi ödeyeceğiniz tahmini komisyon.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold text-fg">
          Ay
          <input
            type="month"
            value={m}
            max={month}
            onChange={(e) => e.target.value && setM(e.target.value)}
            className="min-h-hit rounded-md border border-border-strong bg-surface-raised px-3 text-base text-fg"
          />
        </label>
        <Switch checked={includePhone} onCheckedChange={setIncludePhone} label="Telefon siparişlerini dahil et" />
      </div>
      {q.isPending ? (
        <SettingsLoading rows={1} />
      ) : q.isError ? (
        <SettingsError error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-3 rounded-lg bg-surface p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-success text-success-fg">
              <PiggyBank aria-hidden className="size-6" />
            </span>
            <span className="text-5xl font-semibold tabular-nums text-fg">{formatMoney(q.data.avoidedCommissionKurus)}</span>
          </div>
          <p className="text-lg font-semibold text-fg">{q.data.headline}</p>
          <p className="text-sm text-fg">
            {q.data.orderCount} siparişin sepet tutarı {formatMoney(q.data.basketTotalKurus)} × pazaryeri oranı %{formatNumber(q.data.commissionBp / 100)} (KDV dahil nakit
            etkisi {formatMoney(q.data.avoidedCommissionWithVatKurus)}).{' '}
            <Link href="/panel/ayarlar/isletme" className="font-semibold underline">
              Oranı değiştir
            </Link>
          </p>
          <p className="flex items-start gap-2 text-sm text-fg-muted">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            {q.data.note}
          </p>
        </div>
      )}
    </Section>
  );
}
