// Sipariş başına mesaj bütçesi (00 §6.5, 02 §4.3, 03 §9.6): en çok 4 otomatik durum mesajı.
// Sayaç orders.wa_status_msg_count; ret/iptal (terminal), M13, M34 ve müşteri tetikli yanıtlar bütçe dışıdır.

import { orders, type Database } from '@siparis/db';
import { and, eq, gt, lt, sql } from 'drizzle-orm';

export const STATUS_MESSAGE_BUDGET = 4;

/** Bütçeden 1 mesaj ayırır (atomik). Bütçe dolduysa false. */
export async function reserveStatusBudget(tx: Database, orderId: string): Promise<boolean> {
  const rows = await tx
    .update(orders)
    .set({ waStatusMsgCount: sql`${orders.waStatusMsgCount} + 1` })
    .where(and(eq(orders.id, orderId), lt(orders.waStatusMsgCount, STATUS_MESSAGE_BUDGET)))
    .returning({ id: orders.id });
  return rows.length > 0;
}

/** Ayrılan bütçeyi geri verir (mesaj gönderilmeyecekse). */
export async function releaseStatusBudget(tx: Database, orderId: string): Promise<void> {
  await tx
    .update(orders)
    .set({ waStatusMsgCount: sql`${orders.waStatusMsgCount} - 1` })
    .where(and(eq(orders.id, orderId), gt(orders.waStatusMsgCount, 0)));
}
