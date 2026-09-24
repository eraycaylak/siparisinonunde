// Geliştirme verisi (14 §4 Seed): platform admini, demo işletme "Bozok Pide Salonu" (Yozgat Merkez),
// menü, saatler, bölgeler, mock WhatsApp hesabı, personel, kill-switch'ler ve birkaç geçmiş sipariş.
// Parolalar yalnız geliştirme içindir.

import {
  KILL_SWITCHES,
  LEGAL_DOCUMENT_VERSION,
  localDateString,
  quoteCart,
  zonedTimeToUtc,
  type CancelReason,
  type CancelledBy,
  type FulfillmentType,
  type MealCardBrand,
  type OrderChannel,
  type OrderStatus,
  type PaymentMethod,
  type PricingProduct,
  type RejectionReason,
  type TenantRole,
  type VerificationMethod,
} from '@siparis/core';
import { eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { createDb, type Database } from './client';
import { nextOrderNumber } from './helpers';
import {
  branches,
  categories,
  customers,
  deliveryZones,
  featureFlags,
  legalAcceptances,
  memberships,
  openingHours,
  optionGroups,
  options,
  orderEvents,
  orderItemOptions,
  orderItems,
  orders,
  productOptionGroups,
  products,
  reviews,
  subscriptions,
  tenants,
  users,
  waAccounts,
} from './schema/index';
import { hashPasswordForSeed } from './seed-password';

export const DEMO = {
  admin: { email: 'admin@siparisinonunde.local', password: 'admin1234', name: 'Platform Yöneticisi' },
  tenantSlug: 'bozok-pide',
  tenantName: 'Bozok Pide Salonu',
  users: [
    { email: 'demo@siparisinonunde.local', password: 'demo1234', name: 'Mehmet Usta', phone: '+905550000010', role: 'owner' },
    { email: 'mudur@siparisinonunde.local', password: 'mudur1234', name: 'Hasan Yönetici', phone: '+905550000011', role: 'manager' },
    { email: 'kasa@siparisinonunde.local', password: 'kasa1234', name: 'Elif Kasa', phone: '+905550000012', role: 'cashier' },
    { email: 'mutfak@siparisinonunde.local', password: 'mutfak1234', name: 'Mutfak Ekranı', phone: null, role: 'kitchen' },
    { email: 'kurye@siparisinonunde.local', password: 'kurye1234', name: 'Burak Kurye', phone: '+905550000014', role: 'courier' },
  ] as { email: string; password: string; name: string; phone: string | null; role: TenantRole }[],
  waDisplayPhone: '+905550000001',
  waWebhookToken: 'dev-bozok-pide-mock-webhook',
} as const;

export interface SeedResult {
  skipped: boolean;
  adminUserId: string;
  tenantId: string | null;
  branchId: string | null;
  ownerUserId: string | null;
  waAccountId: string | null;
}

type Log = (msg: string) => void;

async function ensureFeatureFlags(tx: Database) {
  const descriptions: Record<string, string> = {
    signup_open: 'Yeni işletme kaydı',
    wa_onboarding: 'WhatsApp bağlama akışı',
    campaigns_global: 'Kampanya modülü (Faz 2)',
    llm_parsing: 'Yapay zeka ile serbest metin siparişi (Faz 2)',
    sms_fallback: 'SMS yedeği (OTP ve kritik durum SMS)',
  };
  for (const key of KILL_SWITCHES) {
    await tx
      .insert(featureFlags)
      .values({ key, enabled: true, kind: 'kill_switch', description: descriptions[key] ?? null })
      .onConflictDoNothing();
  }
  await tx
    .insert(featureFlags)
    .values({ key: 'platform_wa_alerts', enabled: true, kind: 'ops', description: 'Platform WhatsApp uyarı şablonları' })
    .onConflictDoNothing();
}

async function ensureAdmin(tx: Database): Promise<string> {
  const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, DEMO.admin.email));
  if (existing) return existing.id;
  const [row] = await tx
    .insert(users)
    .values({
      email: DEMO.admin.email,
      name: DEMO.admin.name,
      passwordHash: await hashPasswordForSeed(DEMO.admin.password),
      isPlatformAdmin: true,
      platformRole: 'platform_owner',
    })
    .returning({ id: users.id });
  return row!.id;
}

/** Yerel (İstanbul) "N gün önce HH:MM" anı. */
function daysAgoAt(now: Date, days: number, hhmm: string): Date {
  const d = localDateString(new Date(now.getTime() - days * 86400000));
  return zonedTimeToUtc(d, hhmm);
}

const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60000);

export async function seedDemo(db: Database, opts: { now?: Date; log?: Log } = {}): Promise<SeedResult> {
  const now = opts.now ?? new Date();
  const log: Log = opts.log ?? (() => {});

  return db.transaction(async (tx) => {
    await ensureFeatureFlags(tx);
    const adminUserId = await ensureAdmin(tx);

    const [existingTenant] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, DEMO.tenantSlug));
    if (existingTenant) {
      log(`"${DEMO.tenantSlug}" zaten var; demo verisi atlandı.`);
      return { skipped: true, adminUserId, tenantId: existingTenant.id, branchId: null, ownerUserId: null, waAccountId: null };
    }

    // --- İşletme ve şube
    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: DEMO.tenantName,
        slug: DEMO.tenantSlug,
        legalName: 'Bozok Pide Salonu (örnek şahıs işletmesi)',
        taxNo: '1234567890',
        taxOffice: 'Yozgat',
        phone: '+903542120000',
        email: 'iletisim@bozokpide.local',
        address: 'Lise Caddesi No: 12, Merkez / Yozgat',
        lifecycleStage: 'pilot',
        planCode: 'pro',
        brandColor: '#B45309',
        isDemo: true,
        trialEndsAt: addMin(now, 14 * 24 * 60),
        liveAt: now,
        webLiveAt: now,
      })
      .returning();
    const tenantId = tenant!.id;

    const [branch] = await tx
      .insert(branches)
      .values({
        tenantId,
        name: 'Merkez',
        phone: '+903542120000',
        addressLine: 'Lise Caddesi No: 12',
        neighborhood: 'Medrese',
        district: 'Merkez',
        city: 'Yozgat',
        lat: 39.8181,
        lng: 34.8147,
        defaultPrepMinutes: 20,
        acceptsDelivery: true,
        acceptsPickup: true,
        paymentMethods: ['cash_on_delivery', 'card_on_delivery', 'meal_card_on_delivery', 'pay_at_counter'],
        mealCardBrands: ['multinet', 'pluxee', 'edenred', 'setcard', 'metropol'],
      })
      .returning();
    const branchId = branch!.id;

    // --- Personel
    const userIds: Partial<Record<TenantRole, string>> = {};
    for (const u of DEMO.users) {
      const [row] = await tx
        .insert(users)
        .values({ email: u.email, phone: u.phone, name: u.name, passwordHash: await hashPasswordForSeed(u.password) })
        .returning({ id: users.id });
      userIds[u.role] = row!.id;
      await tx.insert(memberships).values({ tenantId, userId: row!.id, role: u.role });
    }
    const ownerUserId = userIds.owner!;

    await tx.insert(subscriptions).values({
      tenantId,
      planCode: 'pro',
      status: 'trialing',
      trialEndsAt: tenant!.trialEndsAt,
      founderDiscountBp: 3000,
      notes: 'Pilot işletme (3 ay ücretsiz)',
    });
    for (const document of ['abonelik', 'kvkk_aydinlatma'] as const) {
      await tx.insert(legalAcceptances).values({ userId: ownerUserId, tenantId, document, version: LEGAL_DOCUMENT_VERSION });
    }

    // --- Çalışma saatleri: her gün 10:00–23:30
    await tx.insert(openingHours).values(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ tenantId, branchId, weekday, opensAt: '10:00', closesAt: '23:30' })),
    );

    // --- Seçenek grupları
    const [gPorsiyon] = await tx
      .insert(optionGroups)
      .values({ tenantId, name: 'Porsiyon', internalName: 'Porsiyon — kebap', minSelect: 1, maxSelect: 1, sort: 0 })
      .returning();
    const [gEkstra] = await tx
      .insert(optionGroups)
      .values({ tenantId, name: 'Ekstralar', internalName: 'Ekstralar — pide', minSelect: 0, maxSelect: 3, sort: 1 })
      .returning();
    const [gAci] = await tx
      .insert(optionGroups)
      .values({ tenantId, name: 'Acı', minSelect: 1, maxSelect: 1, sort: 2 })
      .returning();

    const optRows = await tx
      .insert(options)
      .values([
        { tenantId, groupId: gPorsiyon!.id, name: 'Tam porsiyon', priceDeltaKurus: 0, sort: 0 },
        // 1,5 porsiyon: kebap fiyatlarının ~%50'si (sabit fark)
        { tenantId, groupId: gPorsiyon!.id, name: '1,5 porsiyon', priceDeltaKurus: 13000, sort: 1 },
        { tenantId, groupId: gEkstra!.id, name: 'Kaşar', priceDeltaKurus: 3000, sort: 0 },
        { tenantId, groupId: gEkstra!.id, name: 'Yumurta', priceDeltaKurus: 2000, sort: 1 },
        { tenantId, groupId: gEkstra!.id, name: 'Sucuk', priceDeltaKurus: 4000, sort: 2 },
        { tenantId, groupId: gEkstra!.id, name: 'Tereyağı', priceDeltaKurus: 1500, sort: 3 },
        { tenantId, groupId: gAci!.id, name: 'Acılı', priceDeltaKurus: 0, sort: 0 },
        { tenantId, groupId: gAci!.id, name: 'Acısız', priceDeltaKurus: 0, sort: 1 },
      ])
      .returning();
    const opt = (name: string) => optRows.find((o) => o.name === name)!.id;

    // --- Menü
    type P = { name: string; price: number; desc?: string; groups?: string[] };
    const menu: { category: string; items: P[] }[] = [
      {
        category: 'Pideler',
        items: [
          { name: 'Kıymalı Pide', price: 20000, desc: 'Özel harçlı kıyma, taş fırında', groups: ['ekstra'] },
          { name: 'Kaşarlı Pide', price: 22000, desc: 'Bol kaşarlı', groups: ['ekstra'] },
          { name: 'Kuşbaşılı Pide', price: 26000, desc: 'Dana kuşbaşı, domates, biber', groups: ['ekstra'] },
          { name: 'Sucuklu Kaşarlı Pide', price: 25000, groups: ['ekstra'] },
          { name: 'Karışık Pide', price: 28000, desc: 'Kıyma, kuşbaşı, kaşar, sucuk', groups: ['ekstra'] },
          { name: 'Yumurtalı Pide', price: 18000, groups: ['ekstra'] },
        ],
      },
      {
        category: 'Lahmacun',
        items: [
          { name: 'Lahmacun', price: 9000, desc: 'İnce hamur, yeşillik ve limonla', groups: ['aci'] },
          { name: 'Fındık Lahmacun (3 adet)', price: 15000, groups: ['aci'] },
        ],
      },
      {
        category: 'Kebaplar',
        items: [
          { name: 'Adana Kebap', price: 30000, desc: 'Lavaş, közlenmiş domates ve biber ile', groups: ['porsiyon', 'aci'] },
          { name: 'Urfa Kebap', price: 30000, desc: 'Lavaş, közlenmiş domates ve biber ile', groups: ['porsiyon'] },
          { name: 'Tavuk Şiş', price: 25000, groups: ['porsiyon'] },
          { name: 'Kuzu Şiş', price: 36000, groups: ['porsiyon'] },
          { name: 'Yozgat Tandır', price: 38000, desc: 'Ağır ateşte pişmiş kuzu, pilav ile', groups: ['porsiyon'] },
        ],
      },
      {
        category: 'Çorbalar',
        items: [
          { name: 'Mercimek Çorbası', price: 9000 },
          { name: 'Arabaşı Çorbası', price: 11000, desc: 'Yozgat usulü, hamuruyla' },
          { name: 'Tavuk Suyu Çorbası', price: 10000 },
        ],
      },
      {
        category: 'İçecekler',
        items: [
          { name: 'Ayran', price: 3000 },
          { name: 'Şalgam', price: 3500 },
          { name: 'Kola (330 ml)', price: 5000 },
          { name: 'Su (500 ml)', price: 1500 },
          { name: 'Çay', price: 1500 },
        ],
      },
      {
        category: 'Tatlılar',
        items: [
          { name: 'Künefe', price: 15000, desc: 'Antep fıstıklı' },
          { name: 'Sütlaç', price: 9000, desc: 'Fırında' },
          { name: 'Parmak Çörek (6 adet)', price: 12000, desc: 'Yozgat’ın meşhur tatlısı' },
        ],
      },
    ];
    const groupIdByKey: Record<string, string> = { porsiyon: gPorsiyon!.id, ekstra: gEkstra!.id, aci: gAci!.id };
    const groupRows = [gPorsiyon!, gEkstra!, gAci!];
    const productIdByName: Record<string, string> = {};
    const pricing: PricingProduct[] = [];

    for (const [ci, cat] of menu.entries()) {
      const [c] = await tx.insert(categories).values({ tenantId, name: cat.category, sort: ci }).returning();
      for (const [pi, p] of cat.items.entries()) {
        const [row] = await tx
          .insert(products)
          .values({ tenantId, categoryId: c!.id, name: p.name, description: p.desc ?? null, priceKurus: p.price, sort: pi })
          .returning();
        productIdByName[p.name] = row!.id;
        const groups = (p.groups ?? []).map((k) => groupIdByKey[k]!);
        if (groups.length) {
          await tx.insert(productOptionGroups).values(groups.map((groupId, sort) => ({ tenantId, productId: row!.id, groupId, sort })));
        }
        pricing.push({
          id: row!.id,
          name: p.name,
          categoryName: cat.category,
          priceKurus: p.price,
          optionGroups: groups.map((gid) => {
            const g = groupRows.find((x) => x.id === gid)!;
            return {
              id: g.id,
              name: g.name,
              minSelect: g.minSelect,
              maxSelect: g.maxSelect,
              options: optRows.filter((o) => o.groupId === g.id).map((o) => ({ id: o.id, name: o.name, priceDeltaKurus: o.priceDeltaKurus })),
            };
          }),
        });
      }
    }

    // --- Teslimat bölgeleri. Mahalle adları ÖRNEKTİR; işletme gerçek listeyle panelden düzenler.
    const zoneRows = await tx
      .insert(deliveryZones)
      .values([
        {
          tenantId,
          branchId,
          name: 'Merkez yakın',
          kind: 'neighborhoods',
          neighborhoods: ['Aşağınohutlu', 'Yukarınohutlu', 'Medrese', 'Çapanoğlu', 'Tekke'],
          feeKurus: 0,
          minOrderKurus: 15000,
          etaMinutes: 25,
          sort: 0,
        },
        {
          tenantId,
          branchId,
          name: 'Merkez orta',
          kind: 'neighborhoods',
          neighborhoods: ['Bahçeşehir', 'Erdoğan Akdağ', 'Karatepe', 'Köseoğlu', 'Şeyh Osman'],
          feeKurus: 2000,
          minOrderKurus: 20000,
          etaMinutes: 35,
          sort: 1,
        },
        {
          tenantId,
          branchId,
          name: 'Çevre (4 km)',
          kind: 'radius',
          radiusM: 4000,
          feeKurus: 4000,
          minOrderKurus: 30000,
          etaMinutes: 45,
          sort: 2,
        },
      ])
      .returning();

    // --- Mock WhatsApp hesabı (simülatör)
    const [wa] = await tx
      .insert(waAccounts)
      .values({
        tenantId,
        branchId,
        provider: 'mock',
        displayPhone: DEMO.waDisplayPhone,
        phoneNumberId: 'mock-bozok-pide',
        wabaId: 'mock-waba-bozok-pide',
        webhookToken: DEMO.waWebhookToken,
        status: 'connected',
      })
      .returning();

    // --- Müşteriler
    const custRows = await tx
      .insert(customers)
      .values([
        { tenantId, name: 'Ayşe Yılmaz', phoneE164: '+905321112233', waBsuid: 'TR.mock.ayse' },
        { tenantId, name: 'Ahmet Demir', phoneE164: '+905331234567' },
        { tenantId, name: 'Zeynep Kaya', phoneE164: '+905441234567', waBsuid: 'TR.mock.zeynep' },
      ])
      .returning();
    const cust = (name: string) => custRows.find((c) => c.name === name)!;

    // --- Geçmiş siparişler (fiyatlar core.quoteCart ile hesaplanır)
    interface PastOrder {
      at: Date;
      customer: string;
      channel: OrderChannel;
      verification: VerificationMethod;
      fulfillment: FulfillmentType;
      zone?: string;
      neighborhood?: string;
      address?: string;
      payment: PaymentMethod;
      mealCard?: MealCardBrand;
      changeFor?: number;
      items: { product: string; qty: number; options?: string[] }[];
      final: OrderStatus;
      rejection?: RejectionReason;
      cancel?: { by: CancelledBy; reason: CancelReason };
      courier?: boolean;
      review?: 'good' | 'ok' | 'bad';
    }
    const past: PastOrder[] = [
      {
        at: daysAgoAt(now, 3, '19:10'),
        customer: 'Ayşe Yılmaz',
        channel: 'wa_link',
        verification: 'wa_link',
        fulfillment: 'delivery',
        zone: 'Merkez yakın',
        neighborhood: 'Medrese',
        address: 'Cumhuriyet Sok. No: 4 D: 3',
        payment: 'cash_on_delivery',
        changeFor: 50000,
        items: [
          { product: 'Lahmacun', qty: 2, options: ['Acılı'] },
          { product: 'Ayran', qty: 2 },
        ],
        final: 'delivered',
        courier: true,
        review: 'good',
      },
      {
        at: daysAgoAt(now, 3, '20:05'),
        customer: 'Ahmet Demir',
        channel: 'web',
        verification: 'wa_code',
        fulfillment: 'pickup',
        payment: 'pay_at_counter',
        items: [
          { product: 'Karışık Pide', qty: 1, options: ['Kaşar'] },
          { product: 'Çay', qty: 2 },
        ],
        final: 'delivered',
      },
      {
        at: daysAgoAt(now, 2, '13:20'),
        customer: 'Zeynep Kaya',
        channel: 'web',
        verification: 'sms_otp',
        fulfillment: 'delivery',
        zone: 'Merkez orta',
        neighborhood: 'Bahçeşehir',
        address: 'Atatürk Bulv. No: 88 Kat: 2',
        payment: 'meal_card_on_delivery',
        mealCard: 'multinet',
        items: [
          { product: 'Adana Kebap', qty: 1, options: ['1,5 porsiyon', 'Acısız'] },
          { product: 'Mercimek Çorbası', qty: 1 },
        ],
        final: 'delivered',
        courier: true,
      },
      {
        at: daysAgoAt(now, 2, '21:40'),
        customer: 'Ayşe Yılmaz',
        channel: 'wa_link',
        verification: 'wa_link',
        fulfillment: 'delivery',
        zone: 'Merkez yakın',
        neighborhood: 'Medrese',
        address: 'Cumhuriyet Sok. No: 4 D: 3',
        payment: 'card_on_delivery',
        items: [{ product: 'Kuşbaşılı Pide', qty: 1 }],
        final: 'rejected',
        rejection: 'too_busy',
      },
      {
        at: daysAgoAt(now, 1, '12:30'),
        customer: 'Ahmet Demir',
        channel: 'web',
        verification: 'wa_code',
        fulfillment: 'delivery',
        zone: 'Merkez yakın',
        neighborhood: 'Çapanoğlu',
        address: 'Bahar Sok. No: 7',
        payment: 'cash_on_delivery',
        items: [{ product: 'Kıymalı Pide', qty: 1, options: ['Yumurta'] }],
        final: 'cancelled',
        cancel: { by: 'customer', reason: 'customer_request' },
      },
      {
        at: daysAgoAt(now, 1, '19:50'),
        customer: 'Zeynep Kaya',
        channel: 'wa_link',
        verification: 'wa_link',
        fulfillment: 'delivery',
        zone: 'Merkez orta',
        neighborhood: 'Bahçeşehir',
        address: 'Atatürk Bulv. No: 88 Kat: 2',
        payment: 'card_on_delivery',
        items: [
          { product: 'Yozgat Tandır', qty: 1, options: ['Tam porsiyon'] },
          { product: 'Künefe', qty: 1 },
          { product: 'Ayran', qty: 2 },
        ],
        final: 'delivered',
        courier: true,
      },
    ];

    for (const po of past) {
      const zone = po.zone ? zoneRows.find((z) => z.name === po.zone)! : null;
      const quote = quoteCart(
        {
          fulfillmentType: po.fulfillment,
          zone: zone ? { id: zone.id, name: zone.name, feeKurus: zone.feeKurus, minOrderKurus: zone.minOrderKurus, etaMinutes: zone.etaMinutes } : null,
          items: po.items.map((i) => ({ productId: productIdByName[i.product]!, quantity: i.qty, optionIds: (i.options ?? []).map(opt) })),
        },
        { products: pricing, now: po.at },
      );
      if (!quote.ok) throw new Error(`Seed siparişi geçersiz: ${JSON.stringify(quote.problems)}`);
      const c = cust(po.customer);
      const number = await nextOrderNumber(tx, tenantId);
      const acceptedAt = po.final === 'delivered' ? addMin(po.at, 3) : null;
      const eta = po.fulfillment === 'delivery' ? 45 : 20;
      const finalAt =
        po.final === 'delivered' ? addMin(po.at, po.fulfillment === 'delivery' ? 44 : 22) : addMin(po.at, po.final === 'rejected' ? 2 : 4);

      const [order] = await tx
        .insert(orders)
        .values({
          tenantId,
          branchId,
          number,
          status: po.final,
          channel: po.channel,
          fulfillmentType: po.fulfillment,
          customerId: c.id,
          verificationMethod: po.verification,
          verifiedAt: po.at,
          statusNotifyChannel: po.verification === 'sms_otp' ? 'sms' : 'whatsapp',
          zoneId: zone?.id ?? null,
          zoneName: zone?.name ?? null,
          neighborhood: po.neighborhood ?? null,
          addressLine: po.address ?? null,
          customerName: c.name,
          customerPhone: c.phoneE164,
          subtotalKurus: quote.subtotalKurus,
          deliveryFeeKurus: quote.deliveryFeeKurus,
          totalKurus: quote.totalKurus,
          minOrderKurus: quote.minOrderKurus,
          paymentMethod: po.payment,
          paymentStatus: po.final === 'delivered' ? 'paid' : 'unpaid',
          paidAt: po.final === 'delivered' ? finalAt : null,
          mealCardBrand: po.mealCard ?? null,
          changeForKurus: po.changeFor ?? null,
          wantsCutlery: false,
          etaMinutes: acceptedAt ? eta : null,
          estimatedReadyAt: acceptedAt ? addMin(acceptedAt, eta) : null,
          courierUserId: po.courier ? userIds.courier! : null,
          placedAt: po.at,
          firstAckedAt: addMin(po.at, 1),
          acceptedAt,
          acceptedByUserId: acceptedAt ? userIds.cashier! : null,
          readyAt: po.final === 'delivered' ? addMin(po.at, 25) : null,
          onTheWayAt: po.final === 'delivered' && po.fulfillment === 'delivery' ? addMin(po.at, 28) : null,
          deliveredAt: po.final === 'delivered' ? finalAt : null,
          rejectedAt: po.final === 'rejected' ? finalAt : null,
          cancelledAt: po.final === 'cancelled' ? finalAt : null,
          rejectionReason: po.rejection ?? null,
          cancelledBy: po.cancel?.by ?? null,
          cancelReason: po.cancel?.reason ?? null,
          trackingExpiresAt: addMin(finalAt, 7 * 24 * 60),
          createdAt: po.at,
          updatedAt: finalAt,
        })
        .returning();
      const orderId = order!.id;

      for (const [sort, line] of quote.lines.entries()) {
        const [item] = await tx
          .insert(orderItems)
          .values({
            tenantId,
            orderId,
            productId: line.productId,
            name: line.name,
            categoryName: line.categoryName,
            unitPriceKurus: line.unitPriceKurus,
            optionsUnitKurus: line.optionsUnitKurus,
            quantity: line.quantity,
            lineTotalKurus: line.lineTotalKurus,
            sort,
          })
          .returning({ id: orderItems.id });
        if (line.options.length) {
          await tx.insert(orderItemOptions).values(
            line.options.map((o) => ({
              tenantId,
              orderItemId: item!.id,
              optionId: o.optionId,
              groupName: o.groupName,
              optionName: o.optionName,
              priceDeltaKurus: o.priceDeltaKurus,
            })),
          );
        }
      }

      // Zaman çizelgesi
      const ev: (typeof orderEvents.$inferInsert)[] = [
        { tenantId, orderId, type: 'created', fromStatus: null, toStatus: 'new', actorType: 'customer', createdAt: po.at },
      ];
      if (po.final === 'delivered') {
        ev.push({ tenantId, orderId, fromStatus: 'new', toStatus: 'accepted', actorType: 'user', actorUserId: userIds.cashier!, createdAt: acceptedAt! });
        ev.push({ tenantId, orderId, fromStatus: 'accepted', toStatus: 'ready', actorType: 'user', actorUserId: userIds.kitchen!, createdAt: addMin(po.at, 25) });
        if (po.fulfillment === 'delivery') {
          ev.push({ tenantId, orderId, fromStatus: 'ready', toStatus: 'on_the_way', actorType: 'user', actorUserId: userIds.courier!, createdAt: addMin(po.at, 28) });
          ev.push({ tenantId, orderId, fromStatus: 'on_the_way', toStatus: 'delivered', actorType: 'user', actorUserId: userIds.courier!, createdAt: finalAt });
        } else {
          ev.push({ tenantId, orderId, fromStatus: 'ready', toStatus: 'delivered', actorType: 'user', actorUserId: userIds.cashier!, createdAt: finalAt });
        }
      } else if (po.final === 'rejected') {
        ev.push({ tenantId, orderId, fromStatus: 'new', toStatus: 'rejected', actorType: 'user', actorUserId: userIds.cashier!, reason: po.rejection!, createdAt: finalAt });
      } else if (po.final === 'cancelled') {
        ev.push({ tenantId, orderId, fromStatus: 'new', toStatus: 'cancelled', actorType: 'customer', reason: po.cancel!.reason, createdAt: finalAt });
      }
      await tx.insert(orderEvents).values(ev);

      if (po.review) await tx.insert(reviews).values({ tenantId, orderId, customerId: c.id, rating: po.review, createdAt: addMin(finalAt, 10) });
      for (const doc of ['mesafeli_satis', 'on_bilgilendirme'] as const) {
        await tx.insert(legalAcceptances).values({ tenantId, orderId, document: doc, version: LEGAL_DOCUMENT_VERSION, acceptedAt: po.at });
      }
    }

    // Müşteri istatistikleri (yalnız teslim edilenler)
    for (const c of custRows) {
      const delivered = past.filter((p) => p.customer === c.name && p.final === 'delivered');
      const last = delivered.map((p) => p.at).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      await tx.update(customers).set({ orderCount: delivered.length, lastOrderAt: last }).where(eq(customers.id, c.id));
    }

    log(`Demo işletme oluşturuldu: ${DEMO.tenantName} (${DEMO.tenantSlug}), ${past.length} geçmiş sipariş.`);
    return { skipped: false, adminUserId, tenantId, branchId, ownerUserId, waAccountId: wa!.id };
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL tanımlı değil (.env).');
    process.exit(1);
  }
  const handle = createDb(url, { max: 2 });
  try {
    const res = await seedDemo(handle.db, { log: (m) => console.log(m) });
    if (!res.skipped) {
      console.log('Girişler (yalnız geliştirme):');
      console.log(`  Platform admini : ${DEMO.admin.email} / ${DEMO.admin.password}`);
      for (const u of DEMO.users) console.log(`  ${u.role.padEnd(15)} : ${u.email} / ${u.password}`);
      console.log(`  Storefront      : /s/${DEMO.tenantSlug}`);
      console.log(`  Mock WhatsApp   : ${DEMO.waDisplayPhone} (webhook token ${DEMO.waWebhookToken})`);
    }
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
