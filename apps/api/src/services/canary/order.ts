// Sentetik canary — sipariş üretimi ve temizliği (06 §7.10 "[Faz 1 uygulaması]"). Zamanlama, ack kontrolü ve
// uyarı akışı `./index.ts` içindedir; açma/kapama ve sözleşme notları da orada toplanmıştır.

import { acceptsOrders } from '@siparis/core';
import { branches, categories, orderItems, orders, products, tenants, type Database } from '@siparis/db';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { cancelJobs, enqueueJob } from '../../lib/jobs';
import { quoteForBranch } from '../orders/pricing-context';
import { computeBranchOrderingState, tenantOrderingBlocked, type BranchRow, type TenantRow } from '../orders/store-context';
import { recordOrderCreated } from '../orders/transition';

/** Şube başına canary aralığı (06 §7.10: açık saatlerde 15 dk, sapmalı). */
export const CANARY_INTERVAL_MS = 15 * 60_000;
/** Bu süre içinde cihaz ack'i gelmezse "bayat panel" (06 §7.10). */
export const CANARY_ACK_TIMEOUT_MS = 60_000;
/** Canary kaydı en geç bu yaşta kalıcı silinir (06 §7.10 "Temizlik"; doküman `sys_purge_canary()` adını kullanır). */
export const CANARY_MAX_AGE_MS = 10 * 60_000;
/** Kaç ARDIŞIK başarısızlıkta uyarı gider (06 §7.10). */
export const CANARY_STALE_STREAK = 2;
/**
 * Dilimin ilk bu kadarlık penceresinde kuyruğa atılır. Pencere olmasaydı ilk cron turunda TÜM şubeler aynı anda
 * sipariş alırdı (sapma anlamsızlaşır); bir tur kaçarsa (worker yeniden başlıyordu) ikinci tur hâlâ yakalar.
 */
export const CANARY_DUE_WINDOW_MS = 2 * 60_000;
/** Operasyonun deploy'suz acil durdurma anahtarı (`feature_flags`; kayıt yoksa açık). */
export const CANARY_FLAG_KEY = 'canary';
/** Sentetik siparişin `source_meta.src` değeri (panel/denetim için kaynağı okunur kılar). */
export const CANARY_SOURCE = 'canary';
/** Sentetik siparişin müşteri adı: kişisel veri değil, sabit etiket. */
export const CANARY_CUSTOMER_NAME = 'Sistem testi';
/** Canary dilimi işinin türü (şube başına bir sipariş üretir). */
export const CANARY_RUN_JOB = 'canary.run';
/** Ack kontrolü işinin türü (siparişten CANARY_ACK_TIMEOUT_MS sonra çalışır). */
export const CANARY_VERIFY_JOB = 'canary.verify';
/** Dilim tekilliği: aynı şube + dilim için iş bir kez eklenir (`jobs_dedupe_key_uk`). */
export function canaryRunKey(branchId: string, slot: number): string {
  return `canary:${branchId}:${slot}`;
}

/** Ack kontrolü tekilliği: sipariş başına bir kontrol işi. */
export function canaryVerifyKey(orderId: string): string {
  return `canary_verify:${orderId}`;
}

/** Fiyat hesabında kabul edilen tek problem: minimum sepet (06 §7.10 "min sepet kuralları canary'de atlanır"). */
const ALLOWED_QUOTE_PROBLEMS = new Set(['min_basket_not_met']);

function envTrue(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Canary hiç çalışsın mı (ortam değişkeni; varsayılan KAPALI). */
export function canaryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return envTrue(env.CANARY_ENABLED);
}

/** "Bayat panel" uyarısı gönderilsin mi (varsayılan KAPALI; panel sessiz ack'i gelene kadar). */
export function canaryStaleAlertEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return envTrue(env.CANARY_STALE_ALERT);
}

/** Şube çalışma saatinde mi (duraklatma yok sayılır). */
export async function branchOpenNow(db: Database, branch: BranchRow, now: Date): Promise<boolean> {
  const state = await computeBranchOrderingState(db, { ...branch, pausedUntil: null }, now);
  return acceptsOrders(state.state);
}

/** Sipariş neden üretilmedi (hepsi normal durum; arıza değil — arıza işin kendisini başarısız yapar). */
export type CanarySkipReason = 'not_found' | 'not_eligible' | 'closed' | 'menu_empty' | 'quote_problem';

export type CanaryCreateResult =
  | { created: true; orderId: string; placedAt: Date; totalKurus: number }
  | { created: false; reason: CanarySkipReason; detail?: string };

/**
 * Menüden sentetik sepetin ürünü: aktif, tükenmemiş, WhatsApp kısıtlı olmayan ve ZORUNLU SEÇENEĞİ OLMAYAN ilk
 * ürün. Zorunlu seçenek şartı kritik: `quoteCart` seçim yapılmamış zorunlu grup için `option_rule_violation`
 * üretir, yani "Lahmacun (zorunlu: boy)" menünün ilk ürünüyse canary her turda fiyatlanamaz ve sessizce susardı.
 */
async function pickCanaryProduct(db: Database, tenantId: string, now: Date) {
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.isActive, true),
        isNull(products.deletedAt),
        eq(categories.isActive, true),
        isNull(categories.deletedAt),
        eq(products.waRestricted, false),
        or(isNull(products.soldOutUntil), lt(products.soldOutUntil, now)),
        sql`not exists (
          select 1 from product_option_groups pog
            join option_groups og on og.id = pog.group_id
           where pog.product_id = ${products.id} and og.deleted_at is null and og.min_select > 0)`,
      ),
    )
    .orderBy(asc(categories.sort), asc(products.sort), asc(products.createdAt))
    .limit(1);
  return p ?? null;
}

/**
 * Sentetik siparişi gerçek yoldan oluşturur ve `canary.verify` kontrolünü 60 sn sonraya kurar.
 *
 * Fiyat SUNUCUDA hesaplanır (`quoteForBranch` — storefront ve telefon siparişiyle aynı fonksiyon). Gel-al
 * kabul etmeyen şubede teslimat dalı kullanılır ve bölge dışı istisnası 0 ₺ ücretle açılır: amaç bölge/minimum
 * kurallarını sınamak değil, fiyat + yazma + olay + SSE yolunun ÇALIŞTIĞINI görmektir (06 §7.10 "Güvenlik").
 */
export async function createCanaryOrder(
  db: Database,
  input: { tenantId: string; branchId: string },
  now: Date = new Date(),
): Promise<CanaryCreateResult> {
  const [row] = await db
    .select({ branch: branches, tenant: tenants })
    .from(branches)
    .innerJoin(tenants, eq(tenants.id, branches.tenantId))
    .where(and(eq(branches.id, input.branchId), eq(branches.tenantId, input.tenantId)));
  if (!row) return { created: false, reason: 'not_found' };
  const branch: BranchRow = row.branch;
  const tenant: TenantRow = row.tenant;
  if (tenantOrderingBlocked(tenant) || tenant.isDemo) return { created: false, reason: 'not_eligible' };
  // İş kuyrukta beklerken şube kapanmış olabilir: yanlış alarm üretmemek için yürütme anında yeniden bakılır
  if (!(await branchOpenNow(db, branch, now))) return { created: false, reason: 'closed' };

  const product = await pickCanaryProduct(db, tenant.id, now);
  if (!product) return { created: false, reason: 'menu_empty' };

  const pickup = branch.acceptsPickup;
  const { quote } = await quoteForBranch(db, {
    tenantId: tenant.id,
    branch,
    request: { items: [{ productId: product.id, quantity: 1, optionIds: [] }], fulfillmentType: pickup ? 'pickup' : 'delivery' },
    now,
    outOfZoneOverride: pickup ? null : { feeKurus: 0 },
  });
  const blocking = quote.problems.filter((p) => !ALLOWED_QUOTE_PROBLEMS.has(p.code));
  if (blocking.length || !quote.lines.length) {
    return { created: false, reason: 'quote_problem', detail: blocking[0]?.code ?? 'empty_lines' };
  }

  const order = await db.transaction(async (tx) => {
    const [o] = await tx
      .insert(orders)
      .values({
        tenantId: tenant.id,
        branchId: branch.id,
        // İşletmenin sipariş numarası sayacını tüketmez (06 §7.10, 07 §7)
        number: 0,
        status: 'new',
        channel: 'web',
        fulfillmentType: pickup ? 'pickup' : 'delivery',
        testKind: 'canary',
        verificationMethod: 'staff',
        verifiedAt: now,
        // Dış bildirim yollarına ikinci emniyet: durum mesajı kanalı kapalı, müşteri kaydı yok
        statusNotifyChannel: 'none',
        customerId: null,
        customerName: CANARY_CUSTOMER_NAME,
        customerPhone: null,
        subtotalKurus: quote.subtotalKurus,
        deliveryFeeKurus: quote.deliveryFeeKurus,
        totalKurus: quote.totalKurus,
        minOrderKurus: quote.minOrderKurus,
        outOfZoneOverride: !pickup,
        paymentMethod: 'pay_at_counter',
        placedAt: now,
        sourceMeta: { src: CANARY_SOURCE },
      })
      .returning();
    const created = o!;
    let sort = 0;
    for (const line of quote.lines) {
      await tx.insert(orderItems).values({
        tenantId: tenant.id,
        orderId: created.id,
        productId: line.productId,
        name: line.name,
        categoryName: line.categoryName,
        unitPriceKurus: line.unitPriceKurus,
        optionsUnitKurus: line.optionsUnitKurus,
        quantity: line.quantity,
        lineTotalKurus: line.lineTotalKurus,
        sort: sort++,
      });
    }
    // Gerçek yol: order_events 'created' + branch_events 'order.created' (+ NOTIFY) + onOrderCreated kancaları
    await recordOrderCreated(tx, { order: created, actor: { type: 'system' }, now });
    // Alarm zinciri HİÇ kurulmaz (06 §7.6 "Test siparişlerinde alarm", §7.10): kancanın planladığı adımlar
    // aynı transaction'da silinir; emniyet ağı da canary'yi taramaz (jobs/cron/index.ts watchNewOrders)
    await cancelJobs(tx, { type: 'order.alarm_step', orderId: created.id });
    await enqueueJob(tx, {
      queue: 'cron',
      type: CANARY_VERIFY_JOB,
      tenantId: tenant.id,
      runAt: new Date(now.getTime() + CANARY_ACK_TIMEOUT_MS),
      dedupeKey: canaryVerifyKey(created.id),
      payload: { tenantId: tenant.id, branchId: branch.id, orderId: created.id, placedAt: now.toISOString() },
      maxAttempts: 3,
    });
    return created;
  });

  return { created: true, orderId: order.id, placedAt: now, totalKurus: order.totalKurus };
}

/** Canary kaydını KALICI siler (FSM'de iptal geçişi kullanılmaz); kalemler/olaylar/ack'ler cascade ile gider. */
export async function purgeCanaryOrder(db: Database, orderId: string): Promise<boolean> {
  const gone = await db
    .delete(orders)
    .where(and(eq(orders.id, orderId), eq(orders.testKind, 'canary')))
    .returning({ id: orders.id });
  return gone.length > 0;
}

/**
 * Süresi geçmiş canary kayıtlarını siler (06 §7.10 "en geç 10 dk"). Normalde `canary.verify` kaydı kendisi siler;
 * bu süpürme worker çöktüğünde ya da iş kalıcı başarısız olduğunda sentetik siparişin panelde/raporda birikmesini
 * engelleyen emniyet ağıdır.
 */
export async function purgeExpiredCanaryOrders(db: Database, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CANARY_MAX_AGE_MS);
  const gone = await db
    .delete(orders)
    .where(and(eq(orders.testKind, 'canary'), lt(orders.placedAt, cutoff)))
    .returning({ id: orders.id });
  return gone.length;
}

