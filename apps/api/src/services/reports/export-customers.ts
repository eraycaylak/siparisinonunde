// Toplu müşteri dışa aktarması (açık soru 10). Ortak çerçeve ve kararlar: export.ts başlığı.
//
// İki özel kural:
//   - KVKK silmesi yapılmış müşteri (customer_erasures) dosyada GÖRÜNMEZ; aksi halde silinen kayıt toplu
//     dosyayla geri gelir (08 §2.10).
//   - `customers` tablosunda branch_id yoktur. Şube kısıtlı üyelik (auth.branchId) tüm işletmenin müşteri
//     listesini alamaz: yalnız o şubede test dışı siparişi olan müşteriler döner.

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

export interface CustomerExportRow {
  name: string | null;
  /** `includePersonal` yoksa maskeli. */
  phone: string | null;
  whatsappUsername: string | null;
  whatsappLinked: boolean;
  isBlocked: boolean;
  notes: string | null;
  orderCount: number;
  deliveredCount: number;
  deliveredTotalKurus: number;
  firstSeenAt: string;
  lastOrderAt: string | null;
}

interface CustomerDbRow {
  cursor_at: string;
  id: string;
  name: string | null;
  phone_e164: string | null;
  wa_username: string | null;
  wa_bsuid: string | null;
  is_blocked: boolean;
  notes: string | null;
  order_count: string | number;
  delivered_count: string | number;
  delivered_total: string | number;
  created_at: Date | string;
  last_order_at: Date | string | null;
}

export function exportCustomers(
  db: Database,
  scope: ExportScope,
  range: ExportRange | null,
  opts: ExportOptions = {},
): ExportRows<CustomerExportRow> {
  const personal = opts.includePersonal === true;
  const branchOnly = scope.branchId ? sql`and o.branch_id = ${scope.branchId}` : sql``;
  const build = (cursor: ExportCursor | null, limit: number): SQL => {
    const conds = [
      sql`c.tenant_id = ${scope.tenantId}`,
      sql`not exists (select 1 from customer_erasures e where e.customer_id = c.id)`,
    ];
    if (range) {
      conds.push(sql`c.created_at >= ${range.from.toISOString()}::timestamptz`);
      conds.push(sql`c.created_at < ${range.to.toISOString()}::timestamptz`);
    }
    if (scope.branchId) {
      conds.push(sql`exists (
        select 1 from orders o
         where o.customer_id = c.id and o.tenant_id = c.tenant_id and o.test_kind is null ${branchOnly})`);
    }
    if (cursor) conds.push(sql`(c.created_at, c.id) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`);
    return sql`
      select ${tsText('c.created_at')} as cursor_at, c.id, c.name, c.phone_e164, c.wa_username, c.wa_bsuid,
             c.is_blocked, c.notes, c.order_count, c.created_at, c.last_order_at,
             coalesce(s.delivered_count, 0) as delivered_count, coalesce(s.delivered_total, 0) as delivered_total
        from customers c
        left join lateral (
          select count(*) as delivered_count, sum(o.total_kurus) as delivered_total
            from orders o
           where o.customer_id = c.id and o.tenant_id = c.tenant_id
             and o.status = 'delivered' and o.test_kind is null ${branchOnly}
        ) s on true
       where ${sql.join(conds, sql` and `)}
       order by c.created_at, c.id
       limit ${limit}`;
  };
  return (async function* () {
    const pages = paginateExport<CustomerDbRow>(db, build, {
      batchSize: opts.batchSize ?? EXPORT_BATCH_SIZE,
      maxRows: opts.maxRows ?? EXPORT_MAX_ROWS,
    });
    for (;;) {
      const next = await pages.next();
      if (next.done) return next.value;
      const r = next.value;
      yield {
        name: r.name,
        phone: r.phone_e164 == null ? null : personal ? r.phone_e164 : maskPhone(r.phone_e164),
        whatsappUsername: r.wa_username,
        whatsappLinked: Boolean(r.wa_bsuid),
        isBlocked: r.is_blocked,
        notes: r.notes,
        orderCount: toNumber(r.order_count),
        deliveredCount: toNumber(r.delivered_count),
        deliveredTotalKurus: toNumber(r.delivered_total),
        firstSeenAt: toIso(r.created_at)!,
        lastOrderAt: toIso(r.last_order_at),
      };
    }
  })();
}

export const CUSTOMER_CSV_HEADER = [
  'ad',
  'telefon',
  'whatsapp_kullanici_adi',
  'whatsapp_bagli',
  'kara_listede',
  'not',
  'siparis_sayisi',
  'teslim_edilen',
  'teslim_edilen_toplam',
  'ilk_gorulme',
  'son_siparis',
] as const;

export function customerCsvCells(r: CustomerExportRow): string[] {
  return [
    r.name ?? '',
    r.phone ?? '',
    r.whatsappUsername ?? '',
    r.whatsappLinked ? 'evet' : 'hayir',
    r.isBlocked ? 'evet' : 'hayir',
    r.notes ?? '',
    String(r.orderCount),
    String(r.deliveredCount),
    csvPrice(r.deliveredTotalKurus),
    r.firstSeenAt,
    r.lastOrderAt ?? '',
  ];
}
