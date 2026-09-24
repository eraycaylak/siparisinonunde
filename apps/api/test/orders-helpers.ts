// Dilim 2 (sipariş) test yardımcıları: menülü/bölgeli işletme kurulumu, sipariş verme, sahte saatle iş çalıştırma.

import {
  branches,
  categories,
  conversations,
  customers,
  deliveryZones,
  jobs,
  optionGroups,
  options,
  productOptionGroups,
  products,
  storefrontLinkTokens,
  users,
  waAccounts,
  type Database,
} from '@siparis/db';
import type { LightMyRequestResponse } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { processDueJobs, registerJobHandler, type JobPayload } from '../src/lib/jobs';
import { randomToken, sha256Hex } from '../src/lib/tokens';
import { insertOrderWithItems } from '../src/services/orders/create-order';
import { quoteForBranch } from '../src/services/orders/pricing-context';
import type { OrderRow } from '../src/services/orders/summary';
import type { TestContext, TestTenant } from './helpers';

export interface StoreFixture extends TestTenant {
  pideId: string;
  ayranId: string;
  rakiId: string;
  soldOutId: string;
  aciliId: string;
  acisizId: string;
  kasarId: string;
  zoneMerkezId: string;
  zoneUzakId: string;
  waAccountId: string | null;
}

let ipSeq = 1;
/** Her çağrıda farklı IP (hız sınırına takılmamak için). */
export const freshIp = () => `172.16.${Math.floor(ipSeq / 250) % 250}.${(ipSeq++ % 250) + 1}`;

let phoneSeq = 1000;
/** Her çağrıda farklı cep numarası (telefon başı hız sınırı için). */
export const freshPhone = () => `0532${String(1_000_000 + phoneSeq++).slice(-7)}`;

/** Menü + bölgeler + ödeme yöntemleri + (isteğe bağlı) bağlı WhatsApp hesabı olan işletme. */
export async function setupStore(ctx: TestContext, opts: { wa?: 'connected' | 'error' | 'none'; slug?: string } = {}): Promise<StoreFixture> {
  const t = await ctx.createTenantWithOwner({ slug: opts.slug });
  const db = ctx.db;
  await db
    .update(branches)
    .set({
      phone: '+903542120000',
      paymentMethods: ['cash_on_delivery', 'card_on_delivery', 'meal_card_on_delivery', 'pay_at_counter'],
      mealCardBrands: ['multinet', 'pluxee'],
    })
    .where(eq(branches.id, t.branchId));
  await db.update(users).set({ phone: `+90555${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}` }).where(eq(users.id, t.owner.id));

  const [cat] = await db.insert(categories).values({ tenantId: t.tenantId, name: 'Pideler', sort: 1 }).returning();
  const [pide] = await db.insert(products).values({ tenantId: t.tenantId, categoryId: cat!.id, name: 'Kıymalı Pide', priceKurus: 15000, sort: 1 }).returning();
  const [ayran] = await db.insert(products).values({ tenantId: t.tenantId, categoryId: cat!.id, name: 'Ayran', priceKurus: 2500, sort: 2 }).returning();
  const [raki] = await db
    .insert(products)
    .values({ tenantId: t.tenantId, categoryId: cat!.id, name: 'Rakı', priceKurus: 90000, waRestricted: true, sort: 3 })
    .returning();
  const [sold] = await db
    .insert(products)
    .values({ tenantId: t.tenantId, categoryId: cat!.id, name: 'Kaşarlı Pide', priceKurus: 16000, soldOutUntil: new Date(Date.now() + 3600_000), sort: 4 })
    .returning();
  const [aci] = await db.insert(optionGroups).values({ tenantId: t.tenantId, name: 'Acı', minSelect: 1, maxSelect: 1 }).returning();
  const [acili] = await db.insert(options).values({ tenantId: t.tenantId, groupId: aci!.id, name: 'Acılı', sort: 1 }).returning();
  const [acisiz] = await db.insert(options).values({ tenantId: t.tenantId, groupId: aci!.id, name: 'Acısız', sort: 2 }).returning();
  const [ekstra] = await db.insert(optionGroups).values({ tenantId: t.tenantId, name: 'Ekstralar', minSelect: 0, maxSelect: 3 }).returning();
  const [kasar] = await db.insert(options).values({ tenantId: t.tenantId, groupId: ekstra!.id, name: 'Kaşar', priceDeltaKurus: 2500, sort: 1 }).returning();
  await db.insert(productOptionGroups).values([
    { tenantId: t.tenantId, productId: pide!.id, groupId: aci!.id, sort: 1 },
    { tenantId: t.tenantId, productId: pide!.id, groupId: ekstra!.id, sort: 2 },
  ]);
  const [z1] = await db
    .insert(deliveryZones)
    .values({
      tenantId: t.tenantId,
      branchId: t.branchId,
      name: 'Merkez',
      kind: 'neighborhoods',
      neighborhoods: ['Medrese', 'Tekke'],
      feeKurus: 1000,
      minOrderKurus: 10000,
      etaMinutes: 30,
      sort: 1,
    })
    .returning();
  const [z2] = await db
    .insert(deliveryZones)
    .values({
      tenantId: t.tenantId,
      branchId: t.branchId,
      name: 'Uzak',
      kind: 'neighborhoods',
      neighborhoods: ['Karatepe'],
      feeKurus: 2500,
      minOrderKurus: 30000,
      etaMinutes: 40,
      sort: 2,
    })
    .returning();

  let waAccountId: string | null = null;
  if (opts.wa && opts.wa !== 'none') {
    const [acc] = await db
      .insert(waAccounts)
      .values({
        tenantId: t.tenantId,
        branchId: t.branchId,
        provider: 'mock',
        displayPhone: '+905550000099',
        phoneNumberId: `mock-${randomUUID().slice(0, 8)}`,
        webhookToken: randomUUID(),
        status: opts.wa,
      })
      .returning();
    waAccountId = acc!.id;
  }

  return {
    ...t,
    pideId: pide!.id,
    ayranId: ayran!.id,
    rakiId: raki!.id,
    soldOutId: sold!.id,
    aciliId: acili!.id,
    acisizId: acisiz!.id,
    kasarId: kasar!.id,
    zoneMerkezId: z1!.id,
    zoneUzakId: z2!.id,
    waAccountId,
  };
}

/** Varsayılan geçerli paket sipariş gövdesi (2× pide acılı + kaşar, 1× ayran; Medrese). */
export function orderBody(s: StoreFixture, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    items: [
      { productId: s.pideId, quantity: 2, optionIds: [s.aciliId, s.kasarId] },
      { productId: s.ayranId, quantity: 1, optionIds: [] },
    ],
    fulfillmentType: 'delivery',
    neighborhood: 'Medrese',
    customerName: 'Ayşe Yılmaz',
    customerPhone: freshPhone(),
    addressLine: 'Cumhuriyet Cd. No 12 Daire 3',
    directions: 'Eczanenin üstü',
    paymentMethod: 'cash_on_delivery',
    changeForKurus: 50000,
    wantsCutlery: true,
    note: 'Zili çalmayın',
    acceptPreInfo: true,
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

export async function placeOrder(
  ctx: TestContext,
  slug: string,
  body: Record<string, unknown>,
  opts: { ip?: string; cookie?: string } = {},
): Promise<LightMyRequestResponse> {
  return ctx.request({
    method: 'POST',
    url: `/api/v1/store/${slug}/orders`,
    body,
    headers: { 'x-forwarded-for': opts.ip ?? freshIp(), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
  });
}

/** Akış A link token'ı (konuşma + müşteri) ve çerez değeri. */
export async function createLinkToken(ctx: TestContext, s: StoreFixture): Promise<{ cookie: string; tokenId: string; customerId: string; conversationId: string }> {
  const [c] = await ctx.db.insert(customers).values({ tenantId: s.tenantId, name: 'WhatsApp Müşteri', waBsuid: `TR.test.${randomUUID().slice(0, 8)}` }).returning();
  const [conv] = await ctx.db
    .insert(conversations)
    .values({ tenantId: s.tenantId, branchId: s.branchId, waAccountId: s.waAccountId!, customerId: c!.id })
    .returning();
  const raw = randomToken(32);
  const [tok] = await ctx.db
    .insert(storefrontLinkTokens)
    .values({
      tenantId: s.tenantId,
      branchId: s.branchId,
      tokenHash: sha256Hex(raw),
      conversationId: conv!.id,
      customerId: c!.id,
      expiresAt: new Date(Date.now() + 2 * 3600_000),
      exchangedAt: new Date(),
    })
    .returning();
  return { cookie: `sf_link_${s.slug}=${raw}`, tokenId: tok!.id, customerId: c!.id, conversationId: conv!.id };
}

/** Hizmet katmanıyla (kancalar dahil) `new` sipariş oluşturur: alarm zinciri kurulur. */
export async function createHookedOrder(
  ctx: TestContext,
  s: StoreFixture,
  opts: { status?: 'new' | 'awaiting_customer'; testKind?: 'onboarding_test' | 'canary' | null; fulfillmentType?: 'delivery' | 'pickup' } = {},
): Promise<OrderRow> {
  const [branch] = await ctx.db.select().from(branches).where(eq(branches.id, s.branchId));
  const fulfillmentType = opts.fulfillmentType ?? 'delivery';
  const { quote, zoneMatch } = await quoteForBranch(ctx.db, {
    tenantId: s.tenantId,
    branch: branch!,
    request: {
      items: [{ productId: s.pideId, quantity: 1, optionIds: [s.acisizId] }],
      fulfillmentType,
      neighborhood: 'Tekke',
    },
  });
  if (!quote.ok) throw new Error(`quote: ${JSON.stringify(quote.problems)}`);
  const status = opts.status ?? 'new';
  return ctx.db.transaction((tx: Database) =>
    insertOrderWithItems(
      tx,
      {
        tenantId: s.tenantId,
        branchId: s.branchId,
        status,
        channel: 'web',
        fulfillmentType,
        quote,
        zone: zoneMatch ? { id: zoneMatch.zone.id, name: zoneMatch.zone.name } : null,
        neighborhood: zoneMatch?.neighborhood ?? null,
        addressLine: fulfillmentType === 'delivery' ? 'Test Sk. No 1' : null,
        directions: null,
        lat: null,
        lng: null,
        customerId: null,
        customerName: 'Test Müşteri',
        customerPhone: '+905321234567',
        paymentMethod: fulfillmentType === 'delivery' ? 'cash_on_delivery' : 'pay_at_counter',
        mealCardBrand: null,
        changeForKurus: null,
        wantsCutlery: false,
        note: null,
        verificationMethod: status === 'new' ? 'wa_link' : null,
        verifiedAt: status === 'new' ? new Date() : null,
        statusNotifyChannel: 'whatsapp',
        testKind: opts.testKind ?? null,
      },
      { type: 'customer' },
    ),
  );
}

/** Sahte saatle vadesi gelen işleri (tekrar tekrar) çalıştırır; `offsetMs` şimdiden ileri. */
export async function runJobsAt(ctx: TestContext, offsetMs: number): Promise<number> {
  let total = 0;
  const now = new Date(Date.now() + offsetMs);
  for (let i = 0; i < 20; i++) {
    const n = await processDueJobs({ db: ctx.db, config: ctx.config, log: ctx.app.log, now });
    total += n;
    if (n === 0) break;
  }
  return total;
}

/** Dilim 3'ün işleyicilerini testte etkisizleştirir ve çağrıları kaydeder. */
export function stubExternalJobs(): Record<string, JobPayload[]> {
  const calls: Record<string, JobPayload[]> = { 'platform.alert': [], 'sms.send': [], 'order.notify_customer': [] };
  for (const type of Object.keys(calls)) {
    registerJobHandler(type, async (payload: JobPayload) => {
      calls[type]!.push(payload);
    });
  }
  return calls;
}

export async function jobsFor(ctx: TestContext, orderId: string, type?: string) {
  const rows = await ctx.db.select().from(jobs);
  return rows.filter((j) => (j.payload as { orderId?: string }).orderId === orderId && (!type || j.type === type));
}

export async function setWaStatus(ctx: TestContext, s: StoreFixture, status: 'connected' | 'disconnected' | 'error') {
  if (!s.waAccountId) return;
  await ctx.db.update(waAccounts).set({ status }).where(and(eq(waAccounts.id, s.waAccountId)));
}
