// Raporlar (04 §11): gün sonu kasa özeti, dönem özeti (seri, kanal, saat×gün ısı haritası), tasarruf raporu.
// Test siparişleri (test_kind) her raporda hariç; gün sınırları Europe/Istanbul.

import { DEFAULT_TIMEZONE, formatTL, localDateString, zonedTimeToUtc, type OrderChannel, type PaymentMethod } from '@siparis/core';
import { OWN_CHANNELS, type DailyReport, type SavingsReport, type SummaryReport } from '@siparis/core/settings/contracts';
import { isValidDateString } from '@siparis/core/settings/validation';
import { tenants, type Database } from '@siparis/db';
import { eq, sql, type SQL } from 'drizzle-orm';
import { notFound } from '../../lib/errors';
import { validationError } from '../settings/common';

const TZ = DEFAULT_TIMEZONE;
/** Doğrulanmış (awaiting_customer değil, doğrulama süresi dolup iptal olmamış) sipariş. */
const RECEIVED = sql.raw(`(o.status <> 'awaiting_customer' and not (o.status = 'cancelled' and o.cancel_reason = 'customer_timeout'))`);
const SOLD_STATUSES = sql.raw(`o.status in ('accepted','preparing','ready','on_the_way','delivered')`);
/** 04 §11.1: 2 dk'yı aşan onay. */
export const SLOW_ACK_SECONDS = 120;

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function dayRange(date: string): { from: Date; to: Date } {
  return { from: zonedTimeToUtc(date, '00:00', TZ), to: zonedTimeToUtc(addDays(date, 1), '00:00', TZ) };
}

export function todayIstanbul(now = new Date()): string {
  return localDateString(now, TZ);
}

const num = (v: unknown) => Number(v ?? 0);

interface Scope {
  tenantId: string;
  branchId?: string | null;
}

function scopeSql(s: Scope, from: Date, to: Date): SQL {
  const parts = [
    sql`o.tenant_id = ${s.tenantId}`,
    sql`o.test_kind is null`,
    sql`o.placed_at >= ${from.toISOString()}::timestamptz`,
    sql`o.placed_at < ${to.toISOString()}::timestamptz`,
  ];
  if (s.branchId) parts.push(sql`o.branch_id = ${s.branchId}`);
  return sql.join(parts, sql` and `);
}

async function rows<T>(db: Database, q: SQL): Promise<T[]> {
  return (await db.execute(q)) as unknown as T[];
}

async function topProducts(db: Database, where: SQL, limit: number) {
  const r = await rows<{ name: string; quantity: string | number; revenue: string | number }>(
    db,
    sql`select i.name, sum(i.quantity) as quantity, sum(i.line_total_kurus) as revenue
          from order_items i join orders o on o.id = i.order_id
         where ${where} and ${SOLD_STATUSES}
         group by i.name
         order by sum(i.quantity) desc, sum(i.line_total_kurus) desc, i.name
         limit ${limit}`,
  );
  return r.map((x) => ({ name: x.name, quantity: num(x.quantity), revenueKurus: num(x.revenue) }));
}

async function channelBreakdown(db: Database, where: SQL) {
  const r = await rows<{ channel: OrderChannel; count: string | number; revenue: string | number }>(
    db,
    sql`select o.channel, count(*) as count, coalesce(sum(o.total_kurus) filter (where o.status = 'delivered'), 0) as revenue
          from orders o where ${where} and ${RECEIVED}
         group by o.channel order by count(*) desc`,
  );
  return r.map((x) => ({ channel: x.channel, count: num(x.count), revenueKurus: num(x.revenue) }));
}

export async function dailyReport(db: Database, scope: Scope, date: string): Promise<DailyReport> {
  if (!isValidDateString(date)) throw validationError('Geçerli bir tarih seçin (YYYY-AA-GG).', 'date');
  const { from, to } = dayRange(date);
  const where = scopeSql(scope, from, to);

  const statusRows = await rows<{ status: string; count: string | number }>(
    db,
    sql`select o.status, count(*) as count from orders o where ${where} group by o.status`,
  );
  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = num(r.count);

  const [agg] = await rows<Record<string, string | number | null>>(
    db,
    sql`select
          count(*) filter (where ${RECEIVED}) as received,
          count(*) filter (where o.status = 'delivered') as delivered,
          coalesce(sum(o.total_kurus) filter (where o.status = 'delivered'), 0) as revenue,
          coalesce(sum(o.delivery_fee_kurus) filter (where o.status = 'delivered'), 0) as delivery_fee,
          count(*) filter (where o.status = 'rejected') as rejected,
          coalesce(sum(o.total_kurus) filter (where o.status = 'rejected'), 0) as rejected_kurus,
          count(*) filter (where o.status = 'cancelled' and o.cancel_reason is distinct from 'customer_timeout') as cancelled,
          coalesce(sum(o.total_kurus) filter (where o.status = 'cancelled' and o.cancel_reason is distinct from 'customer_timeout'), 0) as cancelled_kurus,
          count(*) filter (where o.status = 'cancelled' and o.cancel_reason = 'tenant_no_response') as missed,
          avg(extract(epoch from (coalesce(o.first_acked_at, o.accepted_at) - coalesce(o.verified_at, o.created_at))))
            filter (where coalesce(o.first_acked_at, o.accepted_at) is not null) as avg_ack,
          count(*) filter (where coalesce(o.first_acked_at, o.accepted_at) is not null
            and extract(epoch from (coalesce(o.first_acked_at, o.accepted_at) - coalesce(o.verified_at, o.created_at))) > ${SLOW_ACK_SECONDS}) as slow_ack
        from orders o where ${where}`,
  );

  const rejectionReasons = await rows<{ reason: string; count: string | number }>(
    db,
    sql`select o.rejection_reason as reason, count(*) as count from orders o
         where ${where} and o.status = 'rejected' group by o.rejection_reason order by count(*) desc`,
  );
  const cancelReasons = await rows<{ reason: string; count: string | number }>(
    db,
    sql`select o.cancel_reason as reason, count(*) as count from orders o
         where ${where} and o.status = 'cancelled' and o.cancel_reason is distinct from 'customer_timeout'
         group by o.cancel_reason order by count(*) desc`,
  );
  const byPayment = await rows<{ payment_method: PaymentMethod; meal_card_brand: string | null; count: string | number; total: string | number }>(
    db,
    sql`select o.payment_method, o.meal_card_brand, count(*) as count, sum(o.total_kurus) as total
          from orders o where ${where} and o.status = 'delivered'
         group by o.payment_method, o.meal_card_brand order by sum(o.total_kurus) desc`,
  );
  const byCourier = await rows<Record<string, string | number | null>>(
    db,
    sql`select o.courier_user_id, u.name,
               count(*) as delivered,
               coalesce(sum(o.total_kurus) filter (where o.payment_method = 'cash_on_delivery'), 0) as cash,
               coalesce(sum(o.total_kurus) filter (where o.payment_method = 'card_on_delivery'), 0) as card,
               coalesce(sum(o.total_kurus) filter (where o.payment_method = 'meal_card_on_delivery'), 0) as meal
          from orders o left join users u on u.id = o.courier_user_id
         where ${where} and o.status = 'delivered' and o.fulfillment_type = 'delivery'
         group by o.courier_user_id, u.name order by count(*) desc`,
  );

  const delivered = num(agg?.delivered);
  const revenue = num(agg?.revenue);
  return {
    date,
    from: from.toISOString(),
    to: to.toISOString(),
    byStatus,
    receivedCount: num(agg?.received),
    deliveredCount: delivered,
    revenueKurus: revenue,
    deliveryFeeKurus: num(agg?.delivery_fee),
    avgBasketKurus: delivered ? Math.round(revenue / delivered) : 0,
    rejectedCount: num(agg?.rejected),
    rejectedKurus: num(agg?.rejected_kurus),
    cancelledCount: num(agg?.cancelled),
    cancelledKurus: num(agg?.cancelled_kurus),
    missedCount: num(agg?.missed),
    rejectionReasons: rejectionReasons.map((r) => ({ reason: r.reason ?? 'other', count: num(r.count) })),
    cancelReasons: cancelReasons.map((r) => ({ reason: r.reason ?? 'other', count: num(r.count) })),
    byPaymentMethod: byPayment.map((r) => ({ paymentMethod: r.payment_method, mealCardBrand: r.meal_card_brand, count: num(r.count), totalKurus: num(r.total) })),
    byChannel: await channelBreakdown(db, where),
    byCourier: byCourier.map((r) => ({
      courierUserId: (r.courier_user_id as string | null) ?? null,
      name: (r.name as string | null) ?? null,
      deliveredCount: num(r.delivered),
      cashKurus: num(r.cash),
      cardKurus: num(r.card),
      mealCardKurus: num(r.meal),
    })),
    topProducts: await topProducts(db, where, 10),
    avgAckSeconds: agg?.avg_ack == null ? null : Math.round(num(agg.avg_ack)),
    slowAckCount: num(agg?.slow_ack),
  };
}

export const MAX_SUMMARY_DAYS = 92;

export async function summaryReport(db: Database, scope: Scope, fromDate: string, toDate: string): Promise<SummaryReport> {
  if (!isValidDateString(fromDate)) throw validationError('Geçerli bir başlangıç tarihi seçin.', 'from');
  if (!isValidDateString(toDate)) throw validationError('Geçerli bir bitiş tarihi seçin.', 'to');
  if (toDate < fromDate) throw validationError('Bitiş tarihi başlangıçtan önce olamaz.', 'to');
  const days = Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000) + 1;
  if (days > MAX_SUMMARY_DAYS) throw validationError(`En fazla ${MAX_SUMMARY_DAYS} günlük dönem seçilebilir.`, 'to');

  const from = zonedTimeToUtc(fromDate, '00:00', TZ);
  const to = zonedTimeToUtc(addDays(toDate, 1), '00:00', TZ);
  const where = scopeSql(scope, from, to);
  const localDay = sql.raw(`(o.placed_at at time zone '${TZ}')`);

  const seriesRows = await rows<{ day: string; received: string | number; delivered: string | number; revenue: string | number }>(
    db,
    sql`select to_char(${localDay}::date, 'YYYY-MM-DD') as day,
               count(*) filter (where ${RECEIVED}) as received,
               count(*) filter (where o.status = 'delivered') as delivered,
               coalesce(sum(o.total_kurus) filter (where o.status = 'delivered'), 0) as revenue
          from orders o where ${where}
         group by 1 order by 1`,
  );
  const byDay = new Map(seriesRows.map((r) => [r.day, r]));
  const series: SummaryReport['series'] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(fromDate, i);
    const r = byDay.get(d);
    series.push({ date: d, receivedCount: num(r?.received), deliveredCount: num(r?.delivered), revenueKurus: num(r?.revenue) });
  }
  const totals = series.reduce(
    (a, s) => ({ receivedCount: a.receivedCount + s.receivedCount, deliveredCount: a.deliveredCount + s.deliveredCount, revenueKurus: a.revenueKurus + s.revenueKurus }),
    { receivedCount: 0, deliveredCount: 0, revenueKurus: 0 },
  );

  const prevFrom = zonedTimeToUtc(addDays(fromDate, -days), '00:00', TZ);
  const [prev] = await rows<Record<string, string | number | null>>(
    db,
    sql`select count(*) filter (where ${RECEIVED}) as received,
               count(*) filter (where o.status = 'delivered') as delivered,
               coalesce(sum(o.total_kurus) filter (where o.status = 'delivered'), 0) as revenue
          from orders o where ${scopeSql(scope, prevFrom, from)}`,
  );

  const heatRows = await rows<{ dow: string | number; hour: string | number; count: string | number }>(
    db,
    sql`select extract(dow from ${localDay})::int as dow, extract(hour from ${localDay})::int as hour, count(*) as count
          from orders o where ${where} and ${RECEIVED} group by 1, 2`,
  );
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const h of heatRows) heatmap[num(h.dow)]![num(h.hour)] = num(h.count);

  return {
    from: fromDate,
    to: toDate,
    totals: { ...totals, avgBasketKurus: totals.deliveredCount ? Math.round(totals.revenueKurus / totals.deliveredCount) : 0 },
    previous: { receivedCount: num(prev?.received), deliveredCount: num(prev?.delivered), revenueKurus: num(prev?.revenue) },
    series,
    byChannel: await channelBreakdown(db, where),
    heatmap,
    topProducts: await topProducts(db, where, 10),
  };
}

const MONTH_NAMES_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export const SAVINGS_NOTE =
  'Tahmindir. Bu siparişlerin tamamının pazaryerinden geleceği varsayılır; gerçek tasarruf daha düşük olabilir. Oranı sözleşmenize göre güncelleyin.';

/** 04 §11.3: kendi kanaldan teslim edilen siparişlerin sepet tutarı × pazaryeri kesinti oranı. */
export async function savingsReport(db: Database, scope: Scope, month: string, opts: { includePhone?: boolean; now?: Date } = {}): Promise<SavingsReport> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw validationError('Geçerli bir ay seçin (YYYY-AA).', 'month');
  const [tenant] = await db.select({ bp: tenants.marketplaceCommissionBp }).from(tenants).where(eq(tenants.id, scope.tenantId));
  if (!tenant) throw notFound('İşletme bulunamadı.');
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const from = zonedTimeToUtc(`${month}-01`, '00:00', TZ);
  const to = zonedTimeToUtc(`${next}-01`, '00:00', TZ);
  const channels: string[] = [...OWN_CHANNELS, ...(opts.includePhone ? ['manual'] : [])];
  const r = await rows<{ channel: OrderChannel; count: string | number; basket: string | number }>(
    db,
    sql`select o.channel, count(*) as count, coalesce(sum(o.subtotal_kurus - o.discount_kurus), 0) as basket
          from orders o
         where ${scopeSql(scope, from, to)} and o.status = 'delivered'
           and o.channel in (${sql.join(channels.map((c) => sql`${c}`), sql`, `)})
         group by o.channel order by count(*) desc`,
  );
  const byChannel = r.map((x) => ({ channel: x.channel, count: num(x.count), basketKurus: num(x.basket) }));
  const orderCount = byChannel.reduce((s, x) => s + x.count, 0);
  const basket = byChannel.reduce((s, x) => s + x.basketKurus, 0);
  const avoided = Math.round((basket * tenant.bp) / 10_000);
  const isCurrent = todayIstanbul(opts.now).slice(0, 7) === month;
  const period = isCurrent ? 'Bu ay' : `${MONTH_NAMES_TR[m - 1]} ${y} ayında`;
  return {
    month,
    orderCount,
    basketTotalKurus: basket,
    commissionBp: tenant.bp,
    avoidedCommissionKurus: avoided,
    avoidedCommissionWithVatKurus: Math.round(avoided * 1.2),
    byChannel,
    includesPhoneOrders: Boolean(opts.includePhone),
    headline: `${period} kendi kanalından ${orderCount} sipariş, ${formatTL(avoided)} tasarruf`,
    note: SAVINGS_NOTE,
  };
}
