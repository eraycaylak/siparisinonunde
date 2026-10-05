// Toplu sipariş dışa aktarması (açık soru 10). Ortak çerçeve ve kararlar: export.ts başlığı.
// Satır başına bir sipariş; kalemler tek sütunda ("2× Lahmacun | 1× Kıymalı Pide") — yan sorgu yok (lateral).

import { maskPhone } from '@siparis/core';
import type { Database } from '@siparis/db';
import { sql, type SQL } from 'drizzle-orm';
import { csvPrice } from '../menu/csv';
import {
  EXPORT_BATCH_SIZE,
  EXPORT_MAX_ROWS,
  paginateExport,
  toIso,
  toNumber,
  tsText,
  type ExportCursor,
  type ExportOptions,
  type ExportRange,
  type ExportRows,
  type ExportScope,
} from './export';

export interface OrderExportRow {
  number: number;
  status: string;
  channel: string;
  fulfillmentType: string;
  placedAt: string;
  acceptedAt: string | null;
  deliveredAt: string | null;
  paymentMethod: string;
  paymentStatus: string;
  mealCardBrand: string | null;
  subtotalKurus: number;
  deliveryFeeKurus: number;
  discountKurus: number;
  totalKurus: number;
  currency: string;
  branchName: string | null;
  zoneName: string | null;
  neighborhood: string | null;
  customerName: string | null;
  /** `includePersonal` yoksa maskeli. */
  customerPhone: string | null;
  /** Yalnız `includePersonal` ile dolu. */
  addressLine: string | null;
  directions: string | null;
  lat: number | null;
  lng: number | null;
  note: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  items: string;
}

interface OrderDbRow {
  cursor_at: string;
  id: string;
  number: string | number;
  status: string;
  channel: string;
  fulfillment_type: string;
  placed_at: Date | string;
  accepted_at: Date | string | null;
  delivered_at: Date | string | null;
  payment_method: string;
  payment_status: string;
  meal_card_brand: string | null;
  subtotal_kurus: string | number;
  delivery_fee_kurus: string | number;
  discount_kurus: string | number;
  total_kurus: string | number;
  currency: string;
  branch_name: string | null;
  zone_name: string | null;
  neighborhood: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  address_line: string | null;
  directions: string | null;
  lat: number | null;
  lng: number | null;
  note: string | null;
  rejection_reason: string | null;
  cancel_reason: string | null;
  items: string | null;
}

/** Her sorguda tenant_id; şube verilmişse branch_id. Kapsamsız sorgu üretilemez (CLAUDE.md kural 2). */
function orderScopeSql(scope: ExportScope, range: ExportRange): SQL {
  const parts = [
    sql`o.tenant_id = ${scope.tenantId}`,
    sql`o.test_kind is null`,
    sql`o.placed_at >= ${range.from.toISOString()}::timestamptz`,
    sql`o.placed_at < ${range.to.toISOString()}::timestamptz`,
  ];
  if (scope.branchId) parts.push(sql`o.branch_id = ${scope.branchId}`);
  return sql.join(parts, sql` and `);
}

export function exportOrders(db: Database, scope: ExportScope, range: ExportRange, opts: ExportOptions = {}): ExportRows<OrderExportRow> {
  const personal = opts.includePersonal === true;
  const where = orderScopeSql(scope, range);
  const build = (cursor: ExportCursor | null, limit: number): SQL => {
    const conds = [where];
    if (cursor) conds.push(sql`(o.placed_at, o.id) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`);
    return sql`
      select ${tsText('o.placed_at')} as cursor_at, o.id, o.number, o.status, o.channel, o.fulfillment_type,
             o.placed_at, o.accepted_at, o.delivered_at,
             o.payment_method, o.payment_status, o.meal_card_brand,
             o.subtotal_kurus, o.delivery_fee_kurus, o.discount_kurus, o.total_kurus, o.currency,
             b.name as branch_name, o.zone_name, o.neighborhood,
             o.customer_name, o.customer_phone, o.address_line, o.directions, o.lat, o.lng,
             o.note, o.rejection_reason, o.cancel_reason, it.items
        from orders o
        left join branches b on b.id = o.branch_id
        left join lateral (
          select string_agg(i.quantity || '× ' || i.name, ' | ' order by i.sort, i.id) as items
            from order_items i where i.order_id = o.id
        ) it on true
       where ${sql.join(conds, sql` and `)}
       order by o.placed_at, o.id
       limit ${limit}`;
  };
  return (async function* () {
    const pages = paginateExport<OrderDbRow>(db, build, {
      batchSize: opts.batchSize ?? EXPORT_BATCH_SIZE,
      maxRows: opts.maxRows ?? EXPORT_MAX_ROWS,
    });
    for (;;) {
      const next = await pages.next();
      if (next.done) return next.value;
      const r = next.value;
      yield {
        number: toNumber(r.number),
        status: r.status,
        channel: r.channel,
        fulfillmentType: r.fulfillment_type,
        placedAt: toIso(r.placed_at)!,
        acceptedAt: toIso(r.accepted_at),
        deliveredAt: toIso(r.delivered_at),
        paymentMethod: r.payment_method,
        paymentStatus: r.payment_status,
        mealCardBrand: r.meal_card_brand,
        subtotalKurus: toNumber(r.subtotal_kurus),
        deliveryFeeKurus: toNumber(r.delivery_fee_kurus),
        discountKurus: toNumber(r.discount_kurus),
        totalKurus: toNumber(r.total_kurus),
        currency: r.currency,
        branchName: r.branch_name,
        zoneName: r.zone_name,
        neighborhood: r.neighborhood,
        customerName: r.customer_name,
        customerPhone: r.customer_phone == null ? null : personal ? r.customer_phone : maskPhone(r.customer_phone),
        addressLine: personal ? r.address_line : null,
        directions: personal ? r.directions : null,
        lat: personal ? r.lat : null,
        lng: personal ? r.lng : null,
        note: r.note,
        rejectionReason: r.rejection_reason,
        cancelReason: r.cancel_reason,
        items: r.items ?? '',
      };
    }
  })();
}

export const ORDER_CSV_HEADER = [
  'siparis_no',
  'durum',
  'kanal',
  'teslim_sekli',
  'olusturuldu',
  'onaylandi',
  'teslim_edildi',
  'odeme_yontemi',
  'odeme_durumu',
  'yemek_karti',
  'ara_toplam',
  'teslimat_ucreti',
  'indirim',
  'toplam',
  'para_birimi',
  'sube',
  'bolge',
  'mahalle',
  'musteri_adi',
  'musteri_telefon',
  'adres',
  'yol_tarifi',
  'enlem',
  'boylam',
  'musteri_notu',
  'ret_nedeni',
  'iptal_nedeni',
  'urunler',
] as const;

export function orderCsvCells(r: OrderExportRow): string[] {
  return [
    String(r.number),
    r.status,
    r.channel,
    r.fulfillmentType,
    r.placedAt,
    r.acceptedAt ?? '',
    r.deliveredAt ?? '',
    r.paymentMethod,
    r.paymentStatus,
    r.mealCardBrand ?? '',
    csvPrice(r.subtotalKurus),
    csvPrice(r.deliveryFeeKurus),
    csvPrice(r.discountKurus),
    csvPrice(r.totalKurus),
    r.currency,
    r.branchName ?? '',
    r.zoneName ?? '',
    r.neighborhood ?? '',
    r.customerName ?? '',
    r.customerPhone ?? '',
    r.addressLine ?? '',
    r.directions ?? '',
    r.lat == null ? '' : String(r.lat),
    r.lng == null ? '' : String(r.lng),
    r.note ?? '',
    r.rejectionReason ?? '',
    r.cancelReason ?? '',
    r.items,
  ];
}
