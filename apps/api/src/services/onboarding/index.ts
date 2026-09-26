// Onboarding sihirbazı (04 §3): adım durumları, "WhatsApp'sız başla", test siparişi ve canlıya geçiş (Kapı 1/2).

import { formatPhone, type OrderSummary } from '@siparis/core';
import { ONBOARDING_STEP_LABELS, type OnboardingStatus, type OnboardingStep, type OnboardingStepCode } from '@siparis/core/settings/contracts';
import {
  branches,
  categories,
  deliveryZones,
  openingHours,
  orderItems,
  orders,
  products,
  subscriptions,
  tenantOnboarding,
  tenants,
  waAccounts,
  type Database,
} from '@siparis/db';
import { and, asc, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { conflict, notFound } from '../../lib/errors';
import { createOrderNumber, recordOrderCreated } from '../orders/transition';
import { loadOrderSummary } from '../orders/summary';
import { isoOrNull } from '../settings/common';
import { imprintMissing } from '../settings/tenant';

const OPEN_STATUSES = ['awaiting_customer', 'new', 'accepted', 'preparing', 'ready', 'on_the_way'] as const;

const STEP_HREF: Record<OnboardingStepCode, string> = {
  business_info: '/panel/ayarlar/isletme',
  menu: '/panel/menu',
  hours: '/panel/ayarlar/saatler',
  zones: '/panel/ayarlar/bolgeler',
  whatsapp: '/panel/ayarlar/whatsapp',
  test_order: '/panel/kurulum',
  go_live: '/panel/kurulum',
};

async function firstBranch(db: Database, tenantId: string) {
  const [b] = await db.select().from(branches).where(eq(branches.tenantId, tenantId)).orderBy(desc(branches.isDefault), asc(branches.createdAt)).limit(1);
  return b ?? null;
}

async function activeProductQuery(db: Database, tenantId: string) {
  return db
    .select({ id: products.id, name: products.name, priceKurus: products.priceKurus, categoryName: categories.name })
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
      ),
    )
    .orderBy(asc(categories.sort), asc(products.sort), asc(products.createdAt));
}

/** 05 §A.2.2 onboarding_step kodu (admin hunisi). */
function stepCode(s: { profile: boolean; menu: boolean; ops: boolean; wa: boolean; test: boolean; webLive: boolean; live: boolean }): string {
  if (s.live) return 'live';
  if (s.webLive) return 'web_live';
  if (s.test) return 'wa_test_done';
  if (s.wa) return 'wa_connected';
  if (s.ops) return 'ops_done';
  if (s.menu) return 'menu_done';
  if (s.profile) return 'profile_done';
  return 'account_created';
}

export async function onboardingStatus(db: Database, tenantId: string): Promise<OnboardingStatus> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw notFound('İşletme bulunamadı.');
  const branch = await firstBranch(db, tenantId);
  const [ob] = await db.select().from(tenantOnboarding).where(eq(tenantOnboarding.tenantId, tenantId));
  const productRows = await activeProductQuery(db, tenantId);
  const [hoursCount] = branch ? await db.select({ n: count() }).from(openingHours).where(eq(openingHours.branchId, branch.id)) : [{ n: 0 }];
  const [zoneCount] = branch
    ? await db
        .select({ n: count() })
        .from(deliveryZones)
        .where(and(eq(deliveryZones.branchId, branch.id), eq(deliveryZones.isActive, true), isNull(deliveryZones.deletedAt)))
    : [{ n: 0 }];
  const wa = await db.select().from(waAccounts).where(eq(waAccounts.tenantId, tenantId));
  const connected = wa.find((a) => a.status === 'connected') ?? null;
  const [testOrder] = await db
    .select({ id: orders.id, number: orders.number, status: orders.status, testKind: orders.testKind })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.testKind, 'onboarding_test')))
    .orderBy(desc(orders.createdAt))
    .limit(1);

  const steps: OnboardingStep[] = [];
  const push = (code: OnboardingStepCode, done: boolean, requiredForWeb: boolean, missing: string[], detail: string | null) =>
    steps.push({ code, label: ONBOARDING_STEP_LABELS[code], done, requiredForWeb, missing: done ? [] : missing, detail, href: STEP_HREF[code] });

  const infoMissing = imprintMissing(tenant, branch?.addressLine ?? null);
  if (branch && !branch.addressLine && !infoMissing.includes('Adres')) infoMissing.push('Şube adresi');
  push('business_info', infoMissing.length === 0, true, infoMissing, infoMissing.length ? `Eksik: ${infoMissing.join(', ')}` : 'Künye tamam');

  const productCount = productRows.length;
  push('menu', productCount >= 1, true, ['En az 1 aktif ürün'], productCount ? `${productCount} aktif ürün` : 'Henüz ürün yok');

  const hours = Number(hoursCount?.n ?? 0);
  push('hours', hours >= 1, true, ['Haftalık çalışma saatleri'], hours ? `${hours} saat aralığı tanımlı` : 'Saat girilmemiş');

  const zones = Number(zoneCount?.n ?? 0);
  const zoneMissing: string[] = [];
  if (!branch) zoneMissing.push('Şube');
  else {
    if (branch.acceptsDelivery && zones === 0 && !branch.acceptsPickup) zoneMissing.push('En az 1 teslimat bölgesi ya da gel-al');
    if (branch.acceptsDelivery && zones === 0 && branch.acceptsPickup) zoneMissing.push('En az 1 teslimat bölgesi (ya da paket servisi kapatın)');
    if (!branch.paymentMethods.length) zoneMissing.push('En az 1 ödeme yöntemi');
  }
  push(
    'zones',
    zoneMissing.length === 0,
    true,
    zoneMissing,
    branch ? `${zones} bölge · ${branch.acceptsPickup ? 'gel-al açık' : 'gel-al kapalı'} · ${branch.paymentMethods.length} ödeme yöntemi` : null,
  );

  const whatsappless = Boolean(ob?.whatsapplessAt);
  push(
    'whatsapp',
    Boolean(connected) || whatsappless,
    false,
    ['WhatsApp bağlantısı ya da "WhatsApp\'sız başla"'],
    connected
      ? connected.provider === 'shared'
        ? `Ortak numara${connected.displayPhone ? `: ${formatPhone(connected.displayPhone)}` : ''}${tenant.waCode ? ` · Dükkan kodu ${tenant.waCode}` : ''}`
        : `Bağlı: ${connected.displayPhone ?? ''}`.trim()
      : whatsappless
        ? 'WhatsApp\'sız mod: siparişler web ve SMS ile'
        : null,
  );

  push('test_order', Boolean(testOrder), false, ['Test siparişi'], testOrder ? `#${testOrder.number}` : null);

  const webLive = tenant.webLiveAt != null;
  const live = tenant.liveAt != null;
  push('go_live', webLive || live, false, ['Canlıya geç'], live ? 'Canlı' : webLive ? 'Web siparişine açık' : null);

  const missingForWeb = steps.filter((s) => s.requiredForWeb && !s.done).flatMap((s) => s.missing.map((m) => `${s.label}: ${m}`));
  const missingForFull = [...missingForWeb];
  if (!connected) missingForFull.push('WhatsApp: bağlantı sağlıklı değil (WhatsApp\'sız modda yalnız web siparişi açılır)');
  if (!testOrder) missingForFull.push('Test siparişi: henüz verilmedi');

  const code = stepCode({
    profile: steps[0]!.done,
    menu: steps[1]!.done,
    ops: steps[3]!.done,
    wa: Boolean(connected),
    test: Boolean(testOrder),
    webLive,
    live,
  });
  if (!ob || ob.step !== code) {
    await db
      .insert(tenantOnboarding)
      .values({ tenantId, step: code })
      .onConflictDoUpdate({ target: tenantOnboarding.tenantId, set: { step: code } });
  }

  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    totalCount: steps.length,
    whatsapp: { connected: Boolean(connected), whatsappless, displayPhone: connected?.displayPhone ?? null, mode: tenant.waMode, code: tenant.waCode ?? null },
    testOrder: testOrder && testOrder.testKind ? { id: testOrder.id, number: testOrder.number, status: testOrder.status, testKind: testOrder.testKind } : null,
    canGoLiveWeb: missingForWeb.length === 0,
    canGoLiveFull: missingForFull.length === 0,
    missingForWeb,
    missingForFull,
    liveAt: isoOrNull(tenant.liveAt),
    webLiveAt: isoOrNull(tenant.webLiveAt),
    lifecycleStage: tenant.lifecycleStage,
    slug: tenant.slug,
    branchId: branch?.id ?? null,
  };
}

export async function setWhatsappless(tx: Database, tenantId: string, enabled: boolean): Promise<void> {
  const value = enabled ? new Date() : null;
  await tx
    .insert(tenantOnboarding)
    .values({ tenantId, whatsapplessAt: value })
    .onConflictDoUpdate({ target: tenantOnboarding.tenantId, set: { whatsapplessAt: value } });
}

/**
 * Test siparişi (04 §3.4.3): test_kind 'onboarding_test', ilk aktif ürün × 1, durum 'new', gel-al.
 * Açık bir test siparişi varsa onu döner (created=false). Alarm/bildirim davranışı sipariş ve WhatsApp dilimlerindedir.
 */
export async function createTestOrder(
  tx: Database,
  tenantId: string,
  actor: { userId: string; name: string; phone: string | null },
): Promise<{ summary: OrderSummary; created: boolean }> {
  const [open] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.testKind, 'onboarding_test'), inArray(orders.status, [...OPEN_STATUSES]), ne(orders.status, 'awaiting_customer')))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  if (open) return { summary: await loadOrderSummary(tx, open), created: false };

  const branch = await firstBranch(tx, tenantId);
  if (!branch) throw notFound('Şube bulunamadı.');
  const [product] = await activeProductQuery(tx, tenantId);
  if (!product) throw conflict('menu_empty', 'Test siparişi için önce menüye en az bir aktif ürün ekleyin.');

  const now = new Date();
  const number = await createOrderNumber(tx, tenantId);
  const [order] = await tx
    .insert(orders)
    .values({
      tenantId,
      branchId: branch.id,
      number,
      status: 'new',
      channel: 'web',
      fulfillmentType: 'pickup',
      testKind: 'onboarding_test',
      verificationMethod: 'staff',
      verifiedAt: now,
      statusNotifyChannel: actor.phone ? 'whatsapp' : 'none',
      customerName: actor.name ? `${actor.name} (TEST)` : 'Test müşterisi',
      customerPhone: actor.phone,
      subtotalKurus: product.priceKurus,
      totalKurus: product.priceKurus,
      paymentMethod: 'pay_at_counter',
      placedAt: now,
      createdByUserId: actor.userId,
      note: 'Kurulum test siparişi',
      sourceMeta: { src: 'onboarding' },
    })
    .returning();
  await tx.insert(orderItems).values({
    tenantId,
    orderId: order!.id,
    productId: product.id,
    name: product.name,
    categoryName: product.categoryName,
    unitPriceKurus: product.priceKurus,
    quantity: 1,
    lineTotalKurus: product.priceKurus,
  });
  const { summary } = await recordOrderCreated(tx, { order: order!, actor: { type: 'user', userId: actor.userId }, now });
  await tx
    .insert(tenantOnboarding)
    .values({ tenantId, testOrderId: order!.id })
    .onConflictDoUpdate({ target: tenantOnboarding.tenantId, set: { testOrderId: order!.id } });
  return { summary, created: true };
}

/** Canlıya geçiş: Kapı 1 (web_live_at) zorunlu adımlarla; Kapı 2 (live_at) WhatsApp bağlı + test siparişi ile. */
export async function goLive(tx: Database, tenantId: string, status: OnboardingStatus, now = new Date()) {
  if (!status.canGoLiveWeb) {
    throw conflict('onboarding_incomplete', 'Canlıya geçmek için eksik adımları tamamlayın.', { missing: status.missingForWeb });
  }
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update');
  if (!t) throw notFound('İşletme bulunamadı.');
  const patch: Partial<typeof tenants.$inferInsert> = {};
  if (!t.webLiveAt) patch.webLiveAt = now;
  if (status.canGoLiveFull && !t.liveAt) patch.liveAt = now;
  if (t.lifecycleStage === 'lead' || t.lifecycleStage === 'onboarding') {
    const [sub] = await tx
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(and(eq(subscriptions.tenantId, tenantId), ne(subscriptions.status, 'cancelled')))
      .limit(1);
    patch.lifecycleStage = sub?.status === 'active' ? 'active' : 'trial';
  }
  const [row] = Object.keys(patch).length
    ? await tx
        .update(tenants)
        .set({ ...patch, version: t.version + 1 })
        .where(eq(tenants.id, tenantId))
        .returning()
    : [t];
  const live = row!.liveAt != null;
  await tx
    .insert(tenantOnboarding)
    .values({ tenantId, step: live ? 'live' : 'web_live', completedAt: now })
    .onConflictDoUpdate({ target: tenantOnboarding.tenantId, set: { step: live ? 'live' : 'web_live', completedAt: now } });
  return {
    webLive: row!.webLiveAt != null,
    live,
    liveAt: isoOrNull(row!.liveAt),
    webLiveAt: isoOrNull(row!.webLiveAt),
    lifecycleStage: row!.lifecycleStage,
    missingForFull: live ? [] : status.missingForFull,
    changed: Object.keys(patch),
  };
}
