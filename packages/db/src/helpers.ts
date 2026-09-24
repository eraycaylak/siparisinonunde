// Sorgu yardımcıları (api ve seed ortak).

import { sql } from 'drizzle-orm';
import type { Database } from './client';

/** tenants.order_seq kilitli artışı (aynı transaction içinde çağrılmalı). */
export async function nextOrderNumber(tx: Database, tenantId: string): Promise<number> {
  const rows = await tx.execute<{ n: number | string }>(sql`select next_order_number(${tenantId}) as n`);
  const n = (rows as unknown as { n: number | string }[])[0]?.n;
  if (n == null) throw new Error(`Tenant bulunamadı: ${tenantId}`);
  return Number(n);
}

/** Ham execute sonucunu satır dizisine çevirir (postgres-js RowList). */
export function rowsOf<T>(result: unknown): T[] {
  return result as T[];
}
