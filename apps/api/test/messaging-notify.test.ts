// Sipariş bildirim kuralları: Akış A debounce birleştirme, bütçe (≤ 4), pencere → şablon, WhatsApp'sız mod (SMS),
// canary sessiz, supersede, opt-out, M13/M34, wa.send hata eşlemesi (131047 → şablon, 190 → hesap error + uyarı).

import { conversations, jobs, messages, orders, smsMessages, waAccounts } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueueJob } from '../src/lib/jobs';
import type { OutboundPayload } from '../src/services/messaging/outbound';
import { handleNotifyCustomer, isSuperseded } from '../src/services/messaging/order-notify';
import { performWaSend } from '../src/services/messaging/send';
import { clearMockSent, mockFailNext } from '../src/wa/index';
import { createTestContext, type TestContext } from './helpers';
import {
  HOUR,
  MIN,
  conversationFor,
  createOrderWithHooks,
  echo,
  flushNotify,
  flushOutbound,
  getOrder,
  inbound,
  lastOut,
  outCodes,
  pendingJobs,
  plus,
  runJobs,
  setupWaTenant,
  silentLog,
  threadRows,
  transition,
  type WaSetup,
} from './wa-helpers';

let ctx: TestContext;
let t: WaSetup;
let seq = 3000;
const nextPhone = () => `+90534${String(1000000 + seq++).slice(-7)}`;

beforeAll(async () => {
  ctx = await createTestContext();
  t = await setupWaTenant(ctx, { name: 'Bildirim Kebap' });
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(() => clearMockSent());

/** Müşteri yazar (pencere açılır, karşılama gider) → Akış A siparişi (wa_link, new). */
async function flowAOrder(opts: { extra?: Partial<typeof orders.$inferInsert>; phone?: string; setup?: WaSetup } = {}) {
  const s = opts.setup ?? t;
  const phone = opts.phone ?? nextPhone();
  await inbound(ctx, s.account, { phone, name: 'Deniz' }, { type: 'text', text: 'merhaba' });
  const conv = await conversationFor(ctx.db, s.account, phone);
  const order = await createOrderWithHooks(ctx, s, {
    status: 'new',
    extra: {
      channel: 'wa_link',
      verificationMethod: 'wa_link',
      customerId: conv!.customerId,
      conversationId: conv!.id,
      fulfillmentType: 'delivery',
      paymentMethod: 'cash_on_delivery',
      customerPhone: phone,
      ...opts.extra,
    },
  });
  return { order, conv: conv!, phone };
}

const accept = (orderId: string, tenantId = t.tenantId) =>
  transition(ctx, { orderId, tenantId, to: 'accepted', actor: { type: 'user' }, extra: { etaMinutes: 30, estimatedReadyAt: new Date(Date.now() + 30 * MIN) } });

describe('Akış A: 60 sn debounce', () => {
  it('60 sn içinde onay → "alındı" işi iptal, tek birleşik M06c', async () => {
    const { order, conv } = await flowAOrder();
    const [deb] = await pendingJobs(ctx.db, 'order.received_debounced');
    expect(deb!.dedupeKey).toBe(`received_debounced:${order.id}`);
    expect(deb!.runAt.getTime() - Date.now()).toBeGreaterThan(50_000);
    await accept(order.id);
    expect((await pendingJobs(ctx.db, 'order.received_debounced')).filter((j) => (j.payload as { orderId?: string }).orderId === order.id)).toHaveLength(0);
    await flushNotify(ctx);
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01', 'M06c']);
    const m = await lastOut(ctx.db, conv.id);
    expect(m!.body).toContain('Siparişiniz alındı ve onaylandı!');
    expect(m!.status).toBe('sent');
    expect((await getOrder(ctx.db, order.id)).waStatusMsgCount).toBe(1);
  });

  it('60 sn geçerse M05; sonra M06a → M09 → M10 (3 değerlendirme butonu); bütçe 4', async () => {
    const { order, conv } = await flowAOrder();
    await runJobs(ctx, ['order.received_debounced'], plus(new Date(), 61_000));
    await flushOutbound(ctx);
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01', 'M05']);
    await accept(order.id);
    await flushNotify(ctx);
    await transition(ctx, { orderId: order.id, tenantId: t.tenantId, to: 'on_the_way', actor: { type: 'user' } });
    await flushNotify(ctx);
    await transition(ctx, { orderId: order.id, tenantId: t.tenantId, to: 'delivered', actor: { type: 'user' } });
    await flushNotify(ctx);
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01', 'M05', 'M06a', 'M09', 'M10']);
    const m10 = (await lastOut(ctx.db, conv.id))!.payload as unknown as OutboundPayload;
    expect(m10.spec.type === 'interactive' && m10.spec.interactive.buttons?.map((b) => b.id)).toEqual([
      `review:${order.id}:good`,
      `review:${order.id}:ok`,
      `review:${order.id}:bad`,
    ]);
    expect((await getOrder(ctx.db, order.id)).waStatusMsgCount).toBe(4);
  });
});

describe('bütçe, pencere, supersede', () => {
  it('bütçe dolu → durum mesajı atlanır; terminal iptal (M12) yine gider', async () => {
    const { order, conv } = await flowAOrder();
    await ctx.db.update(orders).set({ waStatusMsgCount: 4 }).where(eq(orders.id, order.id));
    await accept(order.id);
    await flushNotify(ctx);
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01']);
    await transition(ctx, { orderId: order.id, tenantId: t.tenantId, to: 'cancelled', actor: { type: 'user' }, reason: 'courier_issue' });
    await flushNotify(ctx);
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01', 'M12a']);
    expect((await lastOut(ctx.db, conv.id))!.body).toContain('Sebep: teslimat şu an yapılamıyor');
  });

  it('pencere kapalı (24 sa) → utility şablonu; şablonu olmayan mesaj atlanır', async () => {
    const { order, conv } = await flowAOrder();
    await runJobs(ctx, ['order.received_debounced'], plus(new Date(), 61_000));
    await ctx.db.update(conversations).set({ lastInboundAt: new Date(Date.now() - 25 * HOUR) }).where(eq(conversations.id, conv.id));
    await accept(order.id);
    await flushNotify(ctx);
    const m = await lastOut(ctx.db, conv.id);
    expect(m).toMatchObject({ kind: 'template', templateName: 'siparis_onaylandi_v1', status: 'sent' });
    const spec = (m!.payload as unknown as OutboundPayload).spec;
    expect(spec.type === 'template' && spec.params).toEqual(['Bildirim Kebap', '30', `#${order.number}`]);
    expect(spec.type === 'template' && spec.buttons?.[0]?.type).toBe('url');
    expect(m!.body).toContain('Siparişiniz onaylandı. Bildirim Kebap siparişinizi hazırlamaya başladı');
    // pencere kapalıyken M34 (şablonsuz) gönderilmez
    await enqueueJob(ctx.db, { queue: 'notify', type: 'order.notify_customer', payload: { orderId: order.id, event: 'delay', extraMinutes: 10 } });
    await flushNotify(ctx);
    expect((await outCodes(ctx.db, conv.id)).includes('M34')).toBe(false);
  });

  it('tenant_no_response iptali → M12d (bütçe dışı, işletme telefonu)', async () => {
    const { order, conv } = await flowAOrder();
    await ctx.db.update(orders).set({ waStatusMsgCount: 4 }).where(eq(orders.id, order.id));
    await transition(ctx, { orderId: order.id, tenantId: t.tenantId, to: 'cancelled', actor: { type: 'system' }, reason: 'tenant_no_response' });
    await flushNotify(ctx);
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01', 'M12d']);
    expect((await lastOut(ctx.db, conv.id))!.body).toContain('zamanında onaylanamadığı için iptal edildi');
  });

  it('supersede: "onaylandı" beklerken "yolda" gelirse yalnız M09', async () => {
    const { order, conv } = await flowAOrder();
    await runJobs(ctx, ['order.received_debounced'], plus(new Date(), 61_000));
    await flushOutbound(ctx);
    await accept(order.id);
    await transition(ctx, { orderId: order.id, tenantId: t.tenantId, to: 'on_the_way', actor: { type: 'user' } });
    await flushNotify(ctx);
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01', 'M05', 'M09']);
  });

  it('gel-al: ready → M08; "hazırlanıyor" varsayılan kapalı', async () => {
    const { order, conv } = await flowAOrder({ extra: { fulfillmentType: 'pickup', paymentMethod: 'pay_at_counter' } });
    await accept(order.id);
    await transition(ctx, { orderId: order.id, tenantId: t.tenantId, to: 'preparing', actor: { type: 'user' } });
    await flushNotify(ctx);
    await transition(ctx, { orderId: order.id, tenantId: t.tenantId, to: 'ready', actor: { type: 'user' } });
    await flushNotify(ctx);
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01', 'M06c', 'M08']);
  });

  it('canary → hiçbir iş/mesaj; onboarding_test → normal', async () => {
    const { order, conv } = await flowAOrder({ extra: { testKind: 'canary', number: 0 } });
    expect((await pendingJobs(ctx.db, 'order.received_debounced')).some((j) => (j.payload as { orderId?: string }).orderId === order.id)).toBe(false);
    await accept(order.id);
    expect(await ctx.db.select().from(jobs).where(eq(jobs.dedupeKey, `notify:${order.id}:accepted`))).toHaveLength(0);
    await flushNotify(ctx);
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01']);

    const test = await flowAOrder({ extra: { testKind: 'onboarding_test' } });
    await accept(test.order.id);
    await flushNotify(ctx);
    expect(await outCodes(ctx.db, test.conv.id)).toEqual(['M01', 'M06c']);
  });

  it('işletme telefondan yazdı (insan modu) → durum bildirimleri yine gider', async () => {
    const { order, conv, phone } = await flowAOrder();
    await echo(ctx, t.account, { phone }, 'Siparişiniz birazdan hazır');
    await accept(order.id);
    await flushNotify(ctx);
    expect((await outCodes(ctx.db, conv.id)).slice(-1)).toEqual(['M06c']);
  });

  it('"hepsini durdur" → önceki siparişe bildirim gitmez, sonra verilen siparişe gider', async () => {
    const { order, conv, phone } = await flowAOrder();
    await inbound(ctx, t.account, { phone }, { type: 'text', text: 'DUR' });
    await inbound(ctx, t.account, { phone }, { type: 'button_reply', id: 'optout:all', title: 'Evet, hepsini durdur' });
    await accept(order.id);
    await flushNotify(ctx);
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01', 'M31', 'M31a']);
    const later = await createOrderWithHooks(ctx, t, {
      status: 'new',
      extra: { channel: 'wa_link', verificationMethod: 'wa_link', customerId: conv.customerId, conversationId: conv.id, placedAt: plus(new Date(), 1000) },
    });
    await accept(later.id);
    await flushNotify(ctx);
    expect((await outCodes(ctx.db, conv.id)).slice(-1)).toEqual(['M06c']);
  });
});

describe('idempotent iş, bekleyen ret, kurulum test siparişi', () => {
  it('order.notify_customer aynı yükle iki kez çalışırsa ikinci mesaj ve bütçe harcanmaz', async () => {
    const { order, conv } = await flowAOrder();
    await runJobs(ctx, ['order.received_debounced'], plus(new Date(), 61_000));
    await accept(order.id);
    const deps = { db: ctx.db, config: ctx.config, log: silentLog };
    const payload = { orderId: order.id, event: 'status' as const, to: 'accepted' as const, from: 'new' as const };
    expect(await handleNotifyCustomer(deps, payload)).toMatchObject({ sent: 'wa' });
    expect(await handleNotifyCustomer(deps, payload)).toEqual({ sent: 'none', reason: 'already_sent' });
    await flushNotify(ctx);
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01', 'M05', 'M06a']);
    expect((await getOrder(ctx.db, order.id)).waStatusMsgCount).toBe(2);
  });

  it('Akış A: ret bekliyorken (30 sn geri alma) 60 sn "alındı" gitmez', async () => {
    const { order, conv } = await flowAOrder();
    await ctx.db.update(orders).set({ rejectionScheduledAt: new Date(), rejectionReason: 'too_busy' }).where(eq(orders.id, order.id));
    await runJobs(ctx, ['order.received_debounced'], plus(new Date(), 61_000));
    await flushOutbound(ctx);
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01']);
    expect((await getOrder(ctx.db, order.id)).waStatusMsgCount).toBe(0);
  });

  it('"alındı" sonraki her durumla geçersizleşir', () => {
    expect(isSuperseded('new', 'accepted', false)).toBe(true);
    expect(isSuperseded('new', 'new', false)).toBe(false);
    expect(isSuperseded('accepted', 'preparing', false)).toBe(false);
  });

  it('kurulum test siparişi: SMS gitmez; sahibin konuşması varsa yalnız "Onaylandı" WhatsApp\'tan gider', async () => {
    const ownerPhone = nextPhone();
    const base = {
      testKind: 'onboarding_test' as const,
      channel: 'web' as const,
      verificationMethod: 'staff' as const,
      statusNotifyChannel: 'whatsapp' as const,
      fulfillmentType: 'pickup' as const,
      paymentMethod: 'pay_at_counter' as const,
      customerId: null,
      customerPhone: ownerPhone,
    };
    // Konuşma yok: ne WhatsApp ne SMS
    const silent = await createOrderWithHooks(ctx, t, { status: 'new', extra: base });
    await accept(silent.id);
    await flushNotify(ctx);
    expect(await ctx.db.select().from(smsMessages).where(eq(smsMessages.toPhone, ownerPhone))).toHaveLength(0);
    expect(await ctx.db.select().from(messages).where(eq(messages.orderId, silent.id))).toHaveLength(0);

    // Sahip işletmeye yazmış (bağlantı denemesi): "alındı" gitmez, "Onaylandı" gider, SMS yok
    await inbound(ctx, t.account, { phone: ownerPhone, name: 'Sahip' }, { type: 'text', text: 'deneme' });
    const conv = await conversationFor(ctx.db, t.account, ownerPhone);
    const before = await outCodes(ctx.db, conv!.id);
    const test = await createOrderWithHooks(ctx, t, { status: 'new', extra: base });
    await flushNotify(ctx);
    await accept(test.id);
    await flushNotify(ctx);
    expect((await outCodes(ctx.db, conv!.id)).slice(before.length)).toEqual(['M06b']);
    expect(await ctx.db.select().from(smsMessages).where(eq(smsMessages.toPhone, ownerPhone))).toHaveLength(0);
  });
});

describe('WhatsApp\'sız mod (SMS)', () => {
  it('sms_otp siparişi: onay → SMS-02, ret → SMS-03a; teslim → SMS yok; WhatsApp mesajı üretilmez', async () => {
    const phone = nextPhone();
    const o1 = await createOrderWithHooks(ctx, t, { status: 'new', extra: { verificationMethod: 'sms_otp', statusNotifyChannel: 'sms', customerPhone: phone } });
    await accept(o1.id);
    await flushNotify(ctx);
    let sms = await ctx.db.select().from(smsMessages).where(eq(smsMessages.toPhone, phone));
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ purpose: 'status', status: 'sent', countsTowardQuota: true, provider: 'mock' });
    expect(sms[0]!.body).toMatch(new RegExp(`^Bildirim Kebap: #${o1.number} numaralı siparişiniz onaylandı\\. Tahmini teslim .+ Takip: http://localhost:3000/t/`));
    await transition(ctx, { orderId: o1.id, tenantId: t.tenantId, to: 'on_the_way', actor: { type: 'user' } });
    await transition(ctx, { orderId: o1.id, tenantId: t.tenantId, to: 'delivered', actor: { type: 'user' } });
    await flushNotify(ctx);
    sms = await ctx.db.select().from(smsMessages).where(eq(smsMessages.toPhone, phone));
    expect(sms).toHaveLength(1);

    const o2 = await createOrderWithHooks(ctx, t, { status: 'new', extra: { verificationMethod: 'sms_otp', statusNotifyChannel: 'sms', customerPhone: phone } });
    await transition(ctx, { orderId: o2.id, tenantId: t.tenantId, to: 'rejected', actor: { type: 'user' }, reason: 'too_busy' });
    await flushNotify(ctx);
    sms = await ctx.db.select().from(smsMessages).where(eq(smsMessages.toPhone, phone));
    expect(sms.map((s) => s.body).find((b) => b.includes('alınamadı'))).toContain('Sebep: yoğunluk nedeniyle şu an sipariş alınamıyor');
    const waMsgs = await ctx.db.select().from(messages).where(eq(messages.orderId, o1.id));
    expect(waMsgs).toHaveLength(0);
  });

  it('hesap hatalı (error) → kritik durum SMS; tenant_no_response varyantı', async () => {
    const s = await setupWaTenant(ctx, { name: 'Hatalı Hesap Döner' });
    await ctx.db.update(waAccounts).set({ status: 'error', lastError: 'Token geçersiz' }).where(eq(waAccounts.id, s.account.id));
    const phone = nextPhone();
    const o = await createOrderWithHooks(ctx, s, { status: 'new', extra: { verificationMethod: 'wa_code', customerPhone: phone } });
    await transition(ctx, { orderId: o.id, tenantId: s.tenantId, to: 'cancelled', actor: { type: 'system' }, reason: 'tenant_no_response' });
    await flushNotify(ctx);
    const [sms] = await ctx.db.select().from(smsMessages).where(eq(smsMessages.toPhone, phone));
    expect(sms!.body).toContain('zamanında onaylanamadığı için iptal edildi, özür dileriz');
  });
});

describe('M13 / M34 (order.notify_customer)', () => {
  it('approval_delay → M13 (Beklerim / Siparişi iptal et), sipariş başına 1', async () => {
    const { order, conv } = await flowAOrder();
    for (let i = 0; i < 2; i++) {
      await enqueueJob(ctx.db, { queue: 'notify', type: 'order.notify_customer', payload: { orderId: order.id, event: 'approval_delay' } });
      await flushNotify(ctx);
    }
    const codes = await outCodes(ctx.db, conv.id);
    expect(codes.filter((c) => c === 'M13')).toHaveLength(1);
    const rows = await threadRows(ctx.db, conv.id);
    const m13 = rows.find((r) => (r.payload as unknown as OutboundPayload | null)?.code === 'M13')!;
    const spec = (m13.payload as unknown as OutboundPayload).spec;
    expect(spec.type === 'interactive' && spec.interactive.buttons?.map((b) => b.id)).toEqual([`wait:${order.id}`, `cancel:${order.id}`]);
    expect(m13.body).toContain('dakika içinde onaylanmazsa');
    expect((await getOrder(ctx.db, order.id)).waStatusMsgCount).toBe(1); // yalnız M05 sayıldı; M13 bütçe dışı
  });

  it('delay → M34 (ek dakika, yeni saat)', async () => {
    const { order, conv } = await flowAOrder();
    await accept(order.id);
    await flushNotify(ctx);
    await enqueueJob(ctx.db, { queue: 'notify', type: 'order.notify_customer', payload: { orderId: order.id, event: 'delay', extraMinutes: 15 } });
    await flushNotify(ctx);
    const m = await lastOut(ctx.db, conv.id);
    expect((m!.payload as unknown as OutboundPayload).code).toBe('M34');
    expect(m!.body).toContain('yaklaşık 15 dk gecikecek');
  });
});

describe('wa.send hata eşlemesi', () => {
  it('131047 → aynı içerik şablonla gider', async () => {
    const { order, conv } = await flowAOrder();
    await flushOutbound(ctx);
    await accept(order.id);
    await runJobs(ctx, ['order.notify_customer']);
    mockFailNext('131047', 'Re-engagement message');
    await flushOutbound(ctx);
    const m = await lastOut(ctx.db, conv.id);
    expect(m).toMatchObject({ kind: 'template', templateName: 'siparis_onaylandi_v1', status: 'sent' });
  });

  it('190 → hesap error, platform uyarısı işi, mesaj failed + kritik durum SMS yedeği', async () => {
    const s = await setupWaTenant(ctx, { name: 'Token Hatalı Pide' });
    const { order, conv, phone } = await flowAOrder({ setup: s });
    await flushOutbound(ctx);
    await accept(order.id, s.tenantId);
    await runJobs(ctx, ['order.notify_customer']);
    mockFailNext('190', 'Invalid OAuth access token');
    await flushOutbound(ctx);
    const m = await lastOut(ctx.db, conv.id);
    expect(m).toMatchObject({ status: 'failed', errorCode: '190' });
    const [acc] = await ctx.db.select().from(waAccounts).where(eq(waAccounts.id, s.account.id));
    expect(acc).toMatchObject({ status: 'error' });
    expect(acc!.lastError).toContain('190');
    const alerts = await ctx.db.select().from(jobs).where(and(eq(jobs.type, 'platform.alert'), eq(jobs.tenantId, s.tenantId)));
    expect(alerts[0]!.payload).toMatchObject({ kind: 'wa_disconnected', tenantId: s.tenantId });
    await runJobs(ctx, ['sms.send']);
    const [sms] = await ctx.db.select().from(smsMessages).where(eq(smsMessages.toPhone, phone));
    expect(sms!.body).toContain('onaylandı');
  });

  it('geçici hata (131056) → yeniden denenir; son denemede failed', async () => {
    const { conv } = await flowAOrder();
    const out = (await threadRows(ctx.db, conv.id)).find((r) => r.direction === 'out')!;
    mockFailNext('131056', 'pair rate');
    await expect(performWaSend({ db: ctx.db, config: ctx.config, log: silentLog }, out.id)).rejects.toThrow();
    expect((await threadRows(ctx.db, conv.id)).find((r) => r.id === out.id)!.status).toBe('queued');
    expect(await performWaSend({ db: ctx.db, config: ctx.config, log: silentLog }, out.id)).toBe('sent');
    // Zaten gönderilmiş mesaj tekrar gönderilmez
    expect(await performWaSend({ db: ctx.db, config: ctx.config, log: silentLog }, out.id)).toBe('skipped');
  });
});
