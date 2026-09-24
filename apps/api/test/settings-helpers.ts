// Dilim 4 test yardımcıları: menü ürünü, müşteri, sipariş (zaman/kanal/durum ayarlı) ve basit SSE okuyucu.

import {
  categories,
  customerAddresses,
  customers,
  nextOrderNumber,
  orderItems,
  orders,
  products,
  type Database,
} from '@siparis/db';
import { expect } from 'vitest';

export async function createProduct(db: Database, tenantId: string, opts: { name?: string; priceKurus?: number; isActive?: boolean } = {}) {
  const [cat] = await db.insert(categories).values({ tenantId, name: 'Pideler', sort: 0 }).returning();
  const [p] = await db
    .insert(products)
    .values({ tenantId, categoryId: cat!.id, name: opts.name ?? 'Kıymalı Pide', priceKurus: opts.priceKurus ?? 18000, isActive: opts.isActive ?? true })
    .returning();
  return p!;
}

export async function createCustomer(
  db: Database,
  tenantId: string,
  opts: { name?: string; phone?: string | null; bsuid?: string | null; notes?: string | null; withAddress?: boolean } = {},
) {
  const [c] = await db
    .insert(customers)
    .values({
      tenantId,
      name: opts.name ?? 'Ayşe Yılmaz',
      phoneE164: opts.phone === undefined ? '+905321112233' : opts.phone,
      waBsuid: opts.bsuid ?? null,
      notes: opts.notes ?? null,
      orderCount: 0,
    })
    .returning();
  if (opts.withAddress) {
    await db.insert(customerAddresses).values({
      tenantId,
      customerId: c!.id,
      neighborhood: 'Aşağınohutlu',
      addressLine: 'Lise Cad. No: 12 D: 3',
      directions: 'Eczanenin üstü',
      lastUsedAt: new Date(),
    });
  }
  return c!;
}

export interface OrderSpec {
  tenantId: string;
  branchId: string;
  status?: (typeof orders.$inferInsert)['status'];
  placedAt?: Date;
  totalKurus?: number;
  deliveryFeeKurus?: number;
  channel?: (typeof orders.$inferInsert)['channel'];
  paymentMethod?: (typeof orders.$inferInsert)['paymentMethod'];
  testKind?: (typeof orders.$inferInsert)['testKind'];
  customerId?: string | null;
  itemName?: string;
  quantity?: number;
  extra?: Partial<typeof orders.$inferInsert>;
}

/** Kalemli sipariş; toplam = kalem toplamı + teslimat ücreti. */
export async function insertOrder(db: Database, s: OrderSpec) {
  return db.transaction(async (tx) => {
    const number = await nextOrderNumber(tx, s.tenantId);
    const fee = s.deliveryFeeKurus ?? 0;
    const subtotal = (s.totalKurus ?? 20000) - fee;
    const status = s.status ?? 'delivered';
    const placedAt = s.placedAt ?? new Date();
    const extra: Partial<typeof orders.$inferInsert> = {};
    if (status === 'rejected') extra.rejectionReason = 'too_busy';
    if (status === 'cancelled') {
      extra.cancelledBy = 'system';
      extra.cancelReason = 'tenant_no_response';
    }
    if (status === 'delivered') extra.deliveredAt = new Date(placedAt.getTime() + 30 * 60_000);
    const [o] = await tx
      .insert(orders)
      .values({
        tenantId: s.tenantId,
        branchId: s.branchId,
        number,
        status,
        channel: s.channel ?? 'web',
        fulfillmentType: fee ? 'delivery' : 'pickup',
        paymentMethod: s.paymentMethod ?? 'cash_on_delivery',
        subtotalKurus: subtotal,
        deliveryFeeKurus: fee,
        totalKurus: subtotal + fee,
        customerName: 'Mehmet Kaya',
        customerPhone: '+905329998877',
        addressLine: 'Cumhuriyet Mah. 5. Sokak No 3',
        customerId: s.customerId ?? null,
        testKind: s.testKind ?? null,
        placedAt,
        createdAt: placedAt,
        ...extra,
        ...s.extra,
      })
      .returning();
    const qty = s.quantity ?? 1;
    await tx.insert(orderItems).values({
      tenantId: s.tenantId,
      orderId: o!.id,
      name: s.itemName ?? 'Kıymalı Pide',
      unitPriceKurus: Math.round(subtotal / qty),
      quantity: qty,
      lineTotalKurus: subtotal,
    });
    return o!;
  });
}

// ---------------------------------------------------------------------------
// Basit SSE okuyucu (gerçek HTTP; app.listen gerekli)

export interface SseEvent {
  id?: string;
  event: string;
  data: unknown;
}

export async function readSseUntil(
  url: string,
  cookie: string,
  predicate: (e: SseEvent) => boolean,
  timeoutMs = 4000,
): Promise<SseEvent | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { cookie, accept: 'text/event-stream' }, signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev: Partial<SseEvent> = {};
        let data = '';
        for (const line of raw.split('\n')) {
          if (line.startsWith('id: ')) ev.id = line.slice(4);
          else if (line.startsWith('event: ')) ev.event = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (!ev.event) continue;
        const e = { id: ev.id, event: ev.event, data: data ? JSON.parse(data) : null };
        if (predicate(e)) return e;
      }
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
