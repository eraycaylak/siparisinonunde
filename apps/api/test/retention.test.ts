// Saklama (cron.retention, 08 §2.8): sipariş notu final durumdan 30 gün sonra boşaltılır (satır 1); WhatsApp mesaj
// içeriği 6 ay sonra silinir, wamid/yön/zaman/durum kalır (satır 4); hareketsiz müşteri 24 ay sonra elle KVKK silmesiyle
// aynı anlamda anonimleşir (satır 6); SMS kaydında telefon 90 gün sonra maskelenir (satır 19); audit 2 yıl (satır 13),
// lead 12 ay (satır 15); onay IP'si 1 yıl. Her adım retention_runs'a tutanak yazar (kabul kriterleri). Aydınlatma metni
// (storefront /yasal/aydinlatma) bu süreleri müşteriye taahhüt eder.

import { maskPhone } from '@siparis/core';
import {
  auditLog,
  conversations,
  customerAddresses,
  customerErasures,
  customers,
  leads,
  legalAcceptances,
  messages,
  orderItems,
  orders,
  otpVerifications,
  retentionRuns,
  smsMessages,
} from '@siparis/db';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueJob, processDueJobs } from '../src/lib/jobs';
import { RETENTION_REDACTED_BODY, RETENTION_RUN_SUMMARY } from '../src/jobs/system/index';
import { loadOverview } from '../src/services/admin/overview';
import { ANONYMOUS_ORDER_NAME, ERASED_CUSTOMER_NAME } from '../src/services/customers/index';
import { createTestContext, type TestContext } from './helpers';
import { createHookedOrder, createLinkToken, setupStore, type StoreFixture } from './orders-helpers';

const DAY = 86_400_000;

let ctx: TestContext;
let s: StoreFixture;

async function runRetention(): Promise<void> {
  await enqueueJob(ctx.db, { queue: 'cron', type: 'cron.retention' });
  await processDueJobs({ db: ctx.db, config: ctx.config, log: ctx.app.log, now: new Date(Date.now() + 1_000), where: sql`type = 'cron.retention'` });
}

/** Siparişe not yazar ve durumunu/zamanlarını ayarlar. */
async function orderWithNote(patch: Partial<typeof orders.$inferInsert>): Promise<string> {
  const o = await createHookedOrder(ctx, s);
  await ctx.db.update(orders).set({ note: 'Fıstık alerjim var, zile basmayın', ...patch }).where(eq(orders.id, o.id));
  await ctx.db.update(orderItems).set({ note: 'soğansız' }).where(eq(orderItems.orderId, o.id));
  return o.id;
}

const noteOf = async (id: string) => (await ctx.db.select({ note: orders.note }).from(orders).where(eq(orders.id, id)))[0]!.note;
const itemNotesOf = async (id: string) => (await ctx.db.select({ note: orderItems.note }).from(orderItems).where(eq(orderItems.orderId, id))).map((r) => r.note);

beforeAll(async () => {
  ctx = await createTestContext();
  s = await setupStore(ctx, { wa: 'connected' });
});
afterAll(async () => {
  await ctx.close();
});

describe('saklama: sipariş notu 30 gün (08 §2.8 satır 1)', () => {
  it('final durumdan 30 gün geçen siparişin ve kalemlerinin notu boşaltılır; yeni ve açık siparişe dokunulmaz', async () => {
    const old = new Date(Date.now() - 31 * DAY);
    const recent = new Date(Date.now() - 10 * DAY);
    const delivered = await orderWithNote({ status: 'delivered', deliveredAt: old });
    const rejected = await orderWithNote({ status: 'rejected', rejectedAt: old, rejectionReason: 'too_busy' });
    const cancelled = await orderWithNote({ status: 'cancelled', cancelledAt: old, cancelledBy: 'customer', cancelReason: 'customer_request' });
    const fresh = await orderWithNote({ status: 'delivered', deliveredAt: recent });
    // Açık sipariş (eski de olsa) not taşır: mutfak fişinde ve kartta gerekir
    const open = await orderWithNote({ status: 'accepted', createdAt: old });

    await runRetention();

    for (const id of [delivered, rejected, cancelled]) {
      expect(await noteOf(id)).toBeNull();
      expect(await itemNotesOf(id)).toEqual([null]);
    }
    for (const id of [fresh, open]) {
      expect(await noteOf(id)).toBe('Fıstık alerjim var, zile basmayın');
      expect(await itemNotesOf(id)).toEqual(['soğansız']);
    }
    // Sipariş kaydının kendisi kalır (tutar, kalemler)
    const [row] = await ctx.db.select({ total: orders.totalKurus, status: orders.status }).from(orders).where(eq(orders.id, delivered));
    expect(row).toMatchObject({ status: 'delivered' });
    expect(row!.total).toBeGreaterThan(0);
  });
});

describe('saklama: WhatsApp mesaj içeriği 6 ay (08 §2.8 satır 4)', () => {
  it('6 aydan eski mesajın metni ve metin taşıyan yük alanları silinir; wamid, yön, durum kalır; yeni mesaja dokunulmaz', async () => {
    const { conversationId } = await createLinkToken(ctx, s);
    const old = new Date(Date.now() - 200 * DAY);
    const recent = new Date(Date.now() - 30 * DAY);
    const oldInWamid = `wamid.${randomUUID()}`;
    const [oldIn, oldOut, oldReply, fresh] = await ctx.db
      .insert(messages)
      .values([
        {
          tenantId: s.tenantId,
          conversationId,
          direction: 'in',
          wamid: oldInWamid,
          kind: 'text',
          body: 'Yeni Mah. 5. Sok. No 3, zil bozuk',
          payload: { type: 'text', profileName: 'Ayşe Yılmaz', raw: { text: { body: 'Yeni Mah. 5. Sok. No 3' } } },
          createdAt: old,
        },
        {
          tenantId: s.tenantId,
          conversationId,
          direction: 'out',
          wamid: `wamid.${randomUUID()}`,
          kind: 'text',
          body: 'Siparişiniz alındı! Sipariş no: #1051',
          payload: {
            code: 'M05',
            spec: { type: 'text', text: 'Siparişiniz alındı! Sipariş no: #1051' },
            templateFallback: null,
            smsFallback: { to: '+905321234567', body: 'Siparişiniz alındı' },
            statusMessage: true,
            orderEvent: null,
          },
          status: 'read',
          sentBy: 'bot',
          createdAt: old,
        },
        {
          tenantId: s.tenantId,
          conversationId,
          direction: 'in',
          wamid: `wamid.${randomUUID()}`,
          kind: 'button_reply',
          body: 'Menüyü aç',
          payload: { type: 'button_reply', id: 'menu', title: 'Menüyü aç' },
          createdAt: old,
        },
        {
          tenantId: s.tenantId,
          conversationId,
          direction: 'in',
          wamid: `wamid.${randomUUID()}`,
          kind: 'text',
          body: 'merhaba',
          payload: { type: 'text', profileName: 'Ayşe Yılmaz' },
          createdAt: recent,
        },
      ])
      .returning();
    await ctx.db.update(conversations).set({ lastMessageAt: old, lastMessagePreview: 'Yeni Mah. 5. Sok.' }).where(eq(conversations.id, conversationId));

    await runRetention();

    const rows = await ctx.db.select().from(messages).where(inArray(messages.id, [oldIn!.id, oldOut!.id, oldReply!.id, fresh!.id]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const a = byId.get(oldIn!.id)!;
    expect(a).toMatchObject({ body: RETENTION_REDACTED_BODY, wamid: oldInWamid, direction: 'in', kind: 'text' });
    expect(a.payload).toEqual({ type: 'text' });
    const b = byId.get(oldOut!.id)!;
    expect(b).toMatchObject({ body: RETENTION_REDACTED_BODY, direction: 'out', status: 'read' });
    expect(b.payload).toEqual({ code: 'M05', statusMessage: true, orderEvent: null });
    const c = byId.get(oldReply!.id)!;
    expect(c.body).toBe(RETENTION_REDACTED_BODY);
    expect(c.payload).toEqual({ type: 'button_reply', id: 'menu' });
    for (const r of [a, b, c]) expect(JSON.stringify(r)).not.toMatch(/Yeni Mah|Ayşe|5321234567|alındı/);
    expect(byId.get(fresh!.id)).toMatchObject({ body: 'merhaba', payload: { type: 'text', profileName: 'Ayşe Yılmaz' } });

    const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conv!.lastMessagePreview).toBeNull();

    // İdempotent: ikinci koşu değiştirecek satır bulmaz
    const before = (await ctx.db.select({ id: messages.id, updatedAt: messages.updatedAt }).from(messages).where(eq(messages.id, oldIn!.id)))[0]!;
    await runRetention();
    const after = (await ctx.db.select({ id: messages.id, updatedAt: messages.updatedAt }).from(messages).where(eq(messages.id, oldIn!.id)))[0]!;
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});

describe('saklama: hareketsiz müşteri 24 ay (08 §2.8 satır 6, retention.customer_inactive)', () => {
  it('24 aydır siparişi ve gelen mesajı olmayan müşteri elle silmeyle aynı anlamda anonimleşir; etkin, açık siparişli, telefonla etkin ve yazışan müşteriye dokunulmaz', async () => {
    const old = new Date(Date.now() - 775 * DAY); // ~25 ay
    const recent = new Date(Date.now() - 20 * DAY);
    const b = await ctx.createTenantWithOwner();
    const mk = async (tenantId: string, v: Partial<typeof customers.$inferInsert>) =>
      (await ctx.db.insert(customers).values({ tenantId, createdAt: old, ...v }).returning())[0]!;

    const inactive = await mk(s.tenantId, {
      name: 'Hareketsiz Hasan',
      phoneE164: '+905329990001',
      waBsuid: 'TR.test.inactive1',
      waUsername: 'hasan',
      notes: 'Kapıda bekletmeyin',
      isBlocked: true,
      lastOrderAt: old,
      lastInboundAt: old,
    });
    // Son siparişi 3 ay önce: etkin
    const active = await mk(s.tenantId, { name: 'Etkin Ayşe', phoneE164: '+905329990002', lastOrderAt: new Date(Date.now() - 90 * DAY) });
    // Eski ama açık siparişi var
    const withOpen = await mk(s.tenantId, { name: 'Açık Siparişli Ali', phoneE164: '+905329990003', lastOrderAt: old });
    // Kayıt eski; aynı telefonla (başka müşteri kaydından) yakın zamanda sipariş verilmiş
    const byPhone = await mk(s.tenantId, { name: 'Telefonla Etkin Tülay', phoneE164: '+905329990004', lastOrderAt: old });
    // Kayıt eski; sohbette yakın zamanda gelen mesaj var
    const chatting = await mk(s.tenantId, { name: 'Yazışan Yusuf', waBsuid: 'TR.test.inactive5', lastInboundAt: old });
    // Başka işletmede aynı telefonlu etkin müşteri
    const foreign = await mk(b.tenantId, { name: 'Başka İşletmede Hasan', phoneE164: '+905329990001', lastOrderAt: recent });

    await ctx.db.insert(customerAddresses).values({ tenantId: s.tenantId, customerId: inactive.id, neighborhood: 'Tekke', addressLine: 'Lise Cad. 12', lastUsedAt: old });
    const own = await ctx.createOrder({
      tenantId: s.tenantId,
      branchId: s.branchId,
      status: 'delivered',
      totalKurus: 12345,
      extra: {
        customerId: inactive.id,
        customerName: 'Hareketsiz Hasan',
        customerPhone: '+905329990001',
        neighborhood: 'Tekke',
        addressLine: 'Lise Cad. 12',
        directions: 'Mavi kapı',
        createdAt: old,
        placedAt: old,
        deliveredAt: old,
      },
    });
    // Aynı kişinin başka kayıttan (ör. WhatsApp kimliği) verdiği eski sipariş: telefonla KVKK kapsamında
    const samePhone = await ctx.createOrder({
      tenantId: s.tenantId,
      branchId: s.branchId,
      status: 'cancelled',
      extra: {
        customerName: 'Hasan',
        customerPhone: '+905329990001',
        createdAt: old,
        placedAt: old,
        cancelledAt: old,
        cancelledBy: 'customer',
        cancelReason: 'customer_request',
      },
    });
    await ctx.createOrder({ tenantId: s.tenantId, branchId: s.branchId, status: 'accepted', extra: { customerId: withOpen.id, customerPhone: '+905329990003', createdAt: old, placedAt: old } });
    await ctx.createOrder({ tenantId: s.tenantId, branchId: s.branchId, status: 'delivered', extra: { customerPhone: '+905329990004', createdAt: recent, deliveredAt: recent } });
    const foreignOrder = await ctx.createOrder({
      tenantId: b.tenantId,
      branchId: b.branchId,
      status: 'delivered',
      extra: { customerId: foreign.id, customerName: 'Hasan', customerPhone: '+905329990001', createdAt: old, deliveredAt: old },
    });

    const [conv] = await ctx.db
      .insert(conversations)
      .values({
        tenantId: s.tenantId,
        branchId: s.branchId,
        waAccountId: s.waAccountId!,
        customerId: inactive.id,
        lastInboundAt: old,
        lastMessageAt: old,
        lastMessagePreview: 'Adresim Lise Cad. 12',
        unreadCount: 2,
      })
      .returning();
    await ctx.db.insert(messages).values([
      { tenantId: s.tenantId, conversationId: conv!.id, direction: 'in', wamid: `wamid.${randomUUID()}`, kind: 'text', body: 'Adresim Lise Cad. 12', payload: { type: 'text', profileName: 'Hasan' }, createdAt: old },
      { tenantId: s.tenantId, conversationId: conv!.id, direction: 'out', wamid: `wamid.${randomUUID()}`, kind: 'text', body: 'Siparişiniz alındı', payload: { code: 'M05' }, status: 'read', sentBy: 'bot', createdAt: old },
    ]);
    const [chatConv] = await ctx.db
      .insert(conversations)
      .values({ tenantId: s.tenantId, branchId: s.branchId, waAccountId: s.waAccountId!, customerId: chatting.id, lastInboundAt: recent, lastMessageAt: recent, lastMessagePreview: 'merhaba' })
      .returning();

    const before = new Date();
    await runRetention();

    // Kişi kaydı anonim kimliğe döner; silme kaydı sistem aktörlü
    const [c] = await ctx.db.select().from(customers).where(eq(customers.id, inactive.id));
    expect(c).toMatchObject({ name: ERASED_CUSTOMER_NAME, phoneE164: null, waBsuid: null, waUsername: null, notes: null, isBlocked: false, lastInboundAt: null });
    const [er] = await ctx.db.select().from(customerErasures).where(eq(customerErasures.customerId, inactive.id));
    expect(er).toMatchObject({ tenantId: s.tenantId, erasedByUserId: null });
    expect(await ctx.db.select().from(customerAddresses).where(eq(customerAddresses.customerId, inactive.id))).toHaveLength(0);

    // Siparişlerde ad/telefon/adres anlık görüntüleri temizlenir; ilçe düzeyi ve tutar kalır
    const anon = await ctx.db.select().from(orders).where(inArray(orders.id, [own.id, samePhone.id]));
    for (const o of anon) {
      expect(o).toMatchObject({ customerName: ANONYMOUS_ORDER_NAME, customerPhone: null, addressLine: null, directions: null, confirmationIp: null });
    }
    const ownAfter = anon.find((o) => o.id === own.id)!;
    expect(ownAfter).toMatchObject({ neighborhood: 'Tekke', totalKurus: 12345, status: 'delivered' });

    // Sohbet içerikleri elle silmedeki gibi: gövde ve yük NULL, önizleme silinir, okunmamış sıfırlanır; satırlar kalır
    const msgs = await ctx.db.select().from(messages).where(eq(messages.conversationId, conv!.id));
    expect(msgs).toHaveLength(2);
    for (const msg of msgs) expect(msg).toMatchObject({ body: null, payload: null });
    const [convAfter] = await ctx.db.select().from(conversations).where(eq(conversations.id, conv!.id));
    expect(convAfter).toMatchObject({ lastMessagePreview: null, unreadCount: 0 });

    // Denetim kaydı: aktör sistem, kişisel veri yok
    const logs = await ctx.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, s.tenantId), eq(auditLog.action, 'customer.erase'), eq(auditLog.entityId, inactive.id)));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorUserId).toBeNull();
    expect(logs[0]!.data).toMatchObject({ actorType: 'system', job: 'retention.customer_inactive', orderCount: 2, messageCount: 2 });
    expect(JSON.stringify(logs[0])).not.toMatch(/9990001|Hasan|Lise/);

    // Dokunulmayanlar
    const untouched = await ctx.db.select().from(customers).where(inArray(customers.id, [active.id, withOpen.id, byPhone.id, chatting.id, foreign.id]));
    expect(untouched).toHaveLength(5);
    for (const u of untouched) expect(u.name).not.toBe(ERASED_CUSTOMER_NAME);
    expect(untouched.find((u) => u.id === foreign.id)!.phoneE164).toBe('+905329990001');
    expect(await ctx.db.select().from(customerErasures).where(inArray(customerErasures.customerId, untouched.map((u) => u.id)))).toHaveLength(0);
    const [fo] = await ctx.db.select().from(orders).where(eq(orders.id, foreignOrder.id));
    expect(fo).toMatchObject({ customerName: 'Hasan', customerPhone: '+905329990001' });
    const [chatAfter] = await ctx.db.select().from(conversations).where(eq(conversations.id, chatConv!.id));
    expect(chatAfter!.lastMessagePreview).toBe('merhaba');

    // Tutanak: tenant başına satır (yalnız adayı olan tenant)
    const runs = await ctx.db
      .select()
      .from(retentionRuns)
      .where(and(eq(retentionRuns.jobName, 'retention.customer_inactive'), gte(retentionRuns.startedAt, before)));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ tenantId: s.tenantId, affectedCount: 1, error: null });

    // İdempotent: ikinci koşu kimseyi yeniden silmez; adaysız koşu tenant'sız tek satır yazar
    const second = new Date();
    await runRetention();
    expect(await ctx.db.select().from(customerErasures).where(eq(customerErasures.customerId, inactive.id))).toHaveLength(1);
    const runs2 = await ctx.db
      .select()
      .from(retentionRuns)
      .where(and(eq(retentionRuns.jobName, 'retention.customer_inactive'), gte(retentionRuns.startedAt, second)));
    expect(runs2).toHaveLength(1);
    expect(runs2[0]).toMatchObject({ tenantId: null, affectedCount: 0, error: null });
  });
});

describe('saklama: SMS ve OTP kayıtları (08 §2.8 satır 19, retention.technical)', () => {
  it('90 günü geçen SMS kaydı silinmez, telefonu maskelenir (durum, amaç, kota kalır); OTP kaydı 30 günde silinir', async () => {
    const order = await ctx.createOrder({ tenantId: s.tenantId, branchId: s.branchId, status: 'delivered' });
    const [oldSms, freshSms] = await ctx.db
      .insert(smsMessages)
      .values([
        { tenantId: s.tenantId, orderId: order.id, toPhone: '+905321112244', body: 'Doğrulama kodunuz: 123456', purpose: 'otp', provider: 'mock', status: 'sent', countsTowardQuota: true, createdAt: new Date(Date.now() - 100 * DAY) },
        { tenantId: s.tenantId, orderId: order.id, toPhone: '+905321112255', body: 'Doğrulama kodunuz: 654321', purpose: 'otp', provider: 'mock', status: 'sent', countsTowardQuota: true, createdAt: new Date(Date.now() - 10 * DAY) },
      ])
      .returning();
    const [oldOtp, freshOtp] = await ctx.db
      .insert(otpVerifications)
      .values([
        { tenantId: s.tenantId, orderId: order.id, phoneE164: '+905321112244', codeHash: 'x', expiresAt: new Date(Date.now() - 31 * DAY), createdAt: new Date(Date.now() - 31 * DAY) },
        { tenantId: s.tenantId, orderId: order.id, phoneE164: '+905321112255', codeHash: 'y', expiresAt: new Date(Date.now() - 5 * DAY), createdAt: new Date(Date.now() - 5 * DAY) },
      ])
      .returning();

    await runRetention();

    const sms = await ctx.db.select().from(smsMessages).where(inArray(smsMessages.id, [oldSms!.id, freshSms!.id]));
    expect(sms).toHaveLength(2);
    const masked = sms.find((x) => x.id === oldSms!.id)!;
    expect(masked).toMatchObject({ toPhone: maskPhone('+905321112244'), status: 'sent', purpose: 'otp', countsTowardQuota: true, provider: 'mock' });
    expect(masked.toPhone).not.toContain('5321112244');
    expect(sms.find((x) => x.id === freshSms!.id)!.toPhone).toBe('+905321112255');

    const otps = await ctx.db.select({ id: otpVerifications.id }).from(otpVerifications).where(inArray(otpVerifications.id, [oldOtp!.id, freshOtp!.id]));
    expect(otps.map((x) => x.id)).toEqual([freshOtp!.id]);

    // İdempotent: maskeli kayıt yeniden maskelenmez
    await runRetention();
    const [again] = await ctx.db.select({ toPhone: smsMessages.toPhone }).from(smsMessages).where(eq(smsMessages.id, oldSms!.id));
    expect(again!.toPhone).toBe(maskPhone('+905321112244'));
  });
});

describe('saklama: audit 2 yıl, lead 12 ay, onay IP’si 1 yıl (08 §2.8 satır 13, 15, 10)', () => {
  it('eski audit ve hareketsiz lead silinir; eski sipariş/kabul kaydının IP ve tarayıcı bilgisi boşaltılır, kayıt kalır', async () => {
    const [oldAudit, freshAudit] = await ctx.db
      .insert(auditLog)
      .values([
        { tenantId: s.tenantId, action: 'menu.product_update', ip: '203.0.113.1', createdAt: new Date(Date.now() - 775 * DAY) },
        { tenantId: s.tenantId, action: 'menu.product_update', ip: '203.0.113.2', createdAt: new Date(Date.now() - 700 * DAY) },
      ])
      .returning();
    const [oldLead, touchedLead, freshLead] = await ctx.db
      .insert(leads)
      .values([
        { name: 'Eski Lead', phone: '+905300000011', createdAt: new Date(Date.now() - 403 * DAY), updatedAt: new Date(Date.now() - 403 * DAY) },
        { name: 'Yeniden Temas', phone: '+905300000012', createdAt: new Date(Date.now() - 403 * DAY), updatedAt: new Date(Date.now() - 30 * DAY) },
        { name: 'Yeni Lead', phone: '+905300000013', createdAt: new Date(Date.now() - 30 * DAY), updatedAt: new Date(Date.now() - 30 * DAY) },
      ])
      .returning();

    const oldAt = new Date(Date.now() - 400 * DAY);
    const freshAt = new Date(Date.now() - 330 * DAY);
    const ipExtra = { confirmationIp: '203.0.113.7', confirmationUserAgent: 'Mozilla/5.0 (Linux; Android 14)' };
    const oldOrder = await ctx.createOrder({ tenantId: s.tenantId, branchId: s.branchId, status: 'delivered', extra: { ...ipExtra, createdAt: oldAt, deliveredAt: oldAt } });
    const freshOrder = await ctx.createOrder({ tenantId: s.tenantId, branchId: s.branchId, status: 'delivered', extra: { ...ipExtra, createdAt: freshAt, deliveredAt: freshAt } });
    const acc = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (Linux; Android 14)', version: '2026-01' };
    const [oldAcc, freshAcc, userAcc] = await ctx.db
      .insert(legalAcceptances)
      .values([
        { tenantId: s.tenantId, orderId: oldOrder.id, document: 'on_bilgilendirme', acceptedAt: oldAt, ...acc },
        { tenantId: s.tenantId, orderId: freshOrder.id, document: 'on_bilgilendirme', acceptedAt: freshAt, ...acc },
        // İşletme yetkilisinin kabulü (son müşteri değil): bu adım dokunmaz
        { tenantId: s.tenantId, userId: s.owner.id, document: 'abonelik', acceptedAt: oldAt, ...acc },
      ])
      .returning();

    await runRetention();

    const audits = await ctx.db.select({ id: auditLog.id }).from(auditLog).where(inArray(auditLog.id, [oldAudit!.id, freshAudit!.id]));
    expect(audits.map((x) => x.id)).toEqual([freshAudit!.id]);
    const ls = await ctx.db.select({ id: leads.id }).from(leads).where(inArray(leads.id, [oldLead!.id, touchedLead!.id, freshLead!.id]));
    expect(ls.map((x) => x.id).sort()).toEqual([touchedLead!.id, freshLead!.id].sort());

    const ords = await ctx.db.select().from(orders).where(inArray(orders.id, [oldOrder.id, freshOrder.id]));
    expect(ords.find((o) => o.id === oldOrder.id)).toMatchObject({ confirmationIp: null, confirmationUserAgent: null, status: 'delivered' });
    expect(ords.find((o) => o.id === freshOrder.id)).toMatchObject(ipExtra);
    const accs = await ctx.db.select().from(legalAcceptances).where(inArray(legalAcceptances.id, [oldAcc!.id, freshAcc!.id, userAcc!.id]));
    expect(accs).toHaveLength(3);
    expect(accs.find((a) => a.id === oldAcc!.id)).toMatchObject({ ip: null, userAgent: null, document: 'on_bilgilendirme', version: '2026-01' });
    expect(accs.find((a) => a.id === freshAcc!.id)).toMatchObject({ ip: acc.ip, userAgent: acc.userAgent });
    expect(accs.find((a) => a.id === userAcc!.id)).toMatchObject({ ip: acc.ip, userAgent: acc.userAgent });
  });
});

describe('saklama: imha tutanağı retention_runs ve admin sağlık göstergesi (08 §2.8 kabul kriterleri)', () => {
  it('her adım bir satır yazar, koşu özeti yazılır; tutanaklar silinmez; 48 saatten eski ya da hatalı koşu admin özetinde alarm', async () => {
    // 4 yıllık tutanak: saklama işi silmez
    const [ancient] = await ctx.db
      .insert(retentionRuns)
      .values({
        jobName: 'retention.order_notes',
        affectedCount: 3,
        startedAt: new Date(Date.now() - 1460 * DAY),
        finishedAt: new Date(Date.now() - 1460 * DAY),
        durationMs: 5,
      })
      .returning();
    const before = new Date();
    await runRetention();

    const runs = await ctx.db.select().from(retentionRuns).where(gte(retentionRuns.startedAt, before));
    const names = new Set(runs.map((r) => r.jobName));
    for (const n of [
      'retention.technical.branch_events',
      'retention.technical.wa_webhook_events',
      'retention.technical.otp_verifications',
      'retention.technical.sms_messages',
      'retention.technical.jobs',
      'retention.technical.storefront_link_tokens',
      'retention.technical.courier_login_links',
      'retention.technical.sessions',
      'retention.locations',
      'retention.media',
      'retention.order_notes',
      'retention.order_notes.items',
      'retention.wa_messages',
      'retention.wa_messages.previews',
      'retention.customer_inactive',
      'retention.access_logs.orders',
      'retention.access_logs.legal_acceptances',
      'retention.audit',
      'retention.leads',
      RETENTION_RUN_SUMMARY,
    ]) {
      expect(names.has(n), n).toBe(true);
    }
    // Adım başına tek satır (bu koşuda hareketsiz müşteri yok → tenant'sız tek satır)
    expect(runs).toHaveLength(names.size);
    for (const r of runs) {
      expect(r.error, r.jobName).toBeNull();
      expect(r.tenantId).toBeNull();
      expect(r.finishedAt.getTime()).toBeGreaterThanOrEqual(r.startedAt.getTime());
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(await ctx.db.select().from(retentionRuns).where(eq(retentionRuns.id, ancient!.id))).toHaveLength(1);

    // Admin özeti: taze ve hatasız koşu → alarm yok
    const ok = await loadOverview(ctx.db);
    expect(ok.retention).toMatchObject({ error: null, stale: false, alert: false });
    expect(ok.retention.lastRunAt).not.toBeNull();
    // 48 saat sonra hâlâ yeni koşu yoksa → alarm
    const late = await loadOverview(ctx.db, new Date(Date.now() + 49 * 3600_000));
    expect(late.retention).toMatchObject({ stale: true, alert: true });
    // Son koşu hatalıysa → alarm (hata metni görünür)
    const now = new Date(Date.now() + 1_000);
    await ctx.db.insert(retentionRuns).values({
      jobName: RETENTION_RUN_SUMMARY,
      affectedCount: 0,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      error: '1 adım başarısız: retention.leads',
    });
    const failed = await loadOverview(ctx.db, new Date(Date.now() + 2_000));
    expect(failed.retention).toMatchObject({ error: '1 adım başarısız: retention.leads', stale: false, alert: true });
    await ctx.db.delete(retentionRuns).where(and(eq(retentionRuns.jobName, RETENTION_RUN_SUMMARY), eq(retentionRuns.startedAt, now), isNull(retentionRuns.tenantId)));
  });
});
