// Konuşma motoru: kanonik sıra ve sıklık kuralları (sahte saat), karşılama/menü linki, insana devir, opt-out,
// kara liste/askı, kapalı/duraklatılmış, açık sipariş kartı, medya, echo, kimlik birleştirme.
// Sessizlik kuralı (2026-10-06): bot açıkken hiçbir mesaj yanıtsız kalmaz — özel yanıt soğumadaysa kısa yardım (M01N).

import { branches, branchEvents, conversations, customers, messages, notifications, openingHours, orders, storefrontLinkTokens, tenants } from '@siparis/db';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueJob } from '../src/lib/jobs';
import { sha256Hex } from '../src/lib/tokens';
import type { OutboundPayload } from '../src/services/messaging/outbound';
import { handleInboundMessage } from '../src/services/messaging/engine';
import { createTestContext, expectError, type TestContext } from './helpers';
import {
  HOUR,
  MIN,
  conversationFor,
  echo,
  getConversation,
  inbound,
  lastOut,
  outCodes,
  plus,
  runJobs,
  setupWaTenant,
  silentLog,
  threadRows,
  type WaSetup,
} from './wa-helpers';

let ctx: TestContext;
let t: WaSetup;
let phoneSeq = 1000;
const nextPhone = () => `+90532${String(1000000 + phoneSeq++).slice(-7)}`;

beforeAll(async () => {
  ctx = await createTestContext();
  t = await setupWaTenant(ctx, { name: 'Bozok Test Pide' });
});
afterAll(async () => {
  await ctx.close();
});

const text = (s: string) => ({ type: 'text' as const, text: s });

describe('karşılama ve sıklık (12 sa / 30 dk)', () => {
  it('ilk mesaj → M01 + "Menüyü aç" CTA (imzalı token, 2 sa) + aydınlatma satırı', async () => {
    const phone = nextPhone();
    const now = new Date();
    await inbound(ctx, t.account, { phone, name: 'Ayşe Yılmaz' }, text('merhaba'), { now });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(conv).toBeTruthy();
    expect(conv!.unreadCount).toBe(1);
    expect(conv!.lastInboundAt!.getTime()).toBeLessThanOrEqual(now.getTime());
    const out = await lastOut(ctx.db, conv!.id);
    const payload = out!.payload as unknown as OutboundPayload;
    expect(payload.code).toBe('M01');
    expect(out!.status).toBe('queued');
    expect(out!.body).toContain('Merhaba Ayşe, Bozok Test Pide WhatsApp sipariş hattına hoş geldiniz!');
    expect(out!.body).toContain('Kişisel verileriniz');
    // Aydınlatma linki işletmenin kendi metnine gider (veri sorumlusu işletme; 08 §2.4-B), platformun metnine değil
    expect(out!.body).toContain(`Ayrıntı: http://localhost:3000/s/${t.slug}/yasal/aydinlatma`);
    expect(out!.body).not.toContain('/yasal/kvkk-aydinlatma');
    expect(out!.body).toContain('"yetkili"');
    expect(payload.spec.type).toBe('interactive');
    if (payload.spec.type !== 'interactive') return;
    expect(payload.spec.interactive.kind).toBe('cta_url');
    const href = payload.spec.interactive.url!.href;
    expect(payload.spec.interactive.url!.label).toBe('Menüyü aç');
    // Kısa bağlantı (Twilio'da düz metinde görünür): /m/<12 karakter>; web /s/<slug>?l=<token>'a yönlendirir
    const m = /^http:\/\/localhost:3000\/m\/([A-Za-z0-9_-]{12})$/.exec(href);
    expect(m).toBeTruthy();
    const [tok] = await ctx.db.select().from(storefrontLinkTokens).where(eq(storefrontLinkTokens.tokenHash, sha256Hex(m![1]!)));
    expect(tok).toMatchObject({ tenantId: t.tenantId, conversationId: conv!.id, customerId: conv!.customerId, branchId: t.branchId });
    expect(tok!.expiresAt.getTime() - now.getTime()).toBe(2 * HOUR);
    // Kısa bağlantı çözümü (web /m/<token>): yalnız dükkan adresi döner, token tüketilmez
    const resolved = await ctx.request({ method: 'GET', url: `/api/v1/public/menu-link/${m![1]}` });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(resolved.json()).toEqual({ slug: t.slug });
    const [still] = await ctx.db.select().from(storefrontLinkTokens).where(eq(storefrontLinkTokens.id, tok!.id));
    expect(still!.exchangedAt).toBeNull();
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/public/menu-link/bilinmeyen-bag-0000' }), 404, 'not_found');
    await ctx.db.insert(storefrontLinkTokens).values({ tenantId: t.tenantId, tokenHash: sha256Hex('suresi-dolmus-0001'), expiresAt: new Date(now.getTime() - 1000) });
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/public/menu-link/suresi-dolmus-0001' }), 404, 'not_found');
    const [cust] = await ctx.db.select().from(customers).where(eq(customers.id, conv!.customerId));
    expect(cust!.name).toBe('Ayşe Yılmaz');
    // SSE: gelen + giden mesaj olayları
    const evs = await ctx.db.select().from(branchEvents).where(and(eq(branchEvents.branchId, t.branchId), eq(branchEvents.type, 'conversation.message')));
    expect(evs.filter((e) => (e.payload as { conversationId?: string }).conversationId === conv!.id).length).toBeGreaterThanOrEqual(2);
  });

  it('karşılama soğumasında yanıtsız kalmaz: M01N, 30 dk sonra M01K, 12 sa sonra tam karşılama (aydınlatmasız)', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    await inbound(ctx, t.account, { phone }, text('merhaba'), { now: t0 });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01']);
    // Mesaj patlaması: son yanıttan 2 dk geçmeden ikinci otomatik yanıt gitmez
    await inbound(ctx, t.account, { phone }, text('orada mısınız'), { now: plus(t0, MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01']);
    // Karşılama soğuması (30 dk) içinde: eskiden TAM SESSİZLİK vardı, artık kısa yardım
    await inbound(ctx, t.account, { phone }, text('a'), { now: plus(t0, 10 * MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01', 'M01N']);
    const help = await lastOut(ctx.db, conv!.id);
    expect(help!.body).toContain('tam olarak anlayamadık');
    expect(help!.body).toContain('menümüzü açabilirsiniz');
    expect(help!.body).toContain('"yetkili"');
    const helpSpec = (help!.payload as unknown as OutboundPayload).spec;
    expect(helpSpec.type === 'interactive' && helpSpec.interactive.url?.label).toBe('Menüyü aç');
    // Yardım yanıtından hemen sonra gelen mesaj sessiz (patlama koruması)
    await inbound(ctx, t.account, { phone }, text('?'), { now: plus(t0, 11 * MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01', 'M01N']);
    // 30 dk geçti → kısa karşılama (M01K); 12 sa geçti → tam karşılama, aydınlatma satırı yok
    await inbound(ctx, t.account, { phone }, text('menü'), { now: plus(t0, 35 * MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01', 'M01N', 'M01K']);
    await inbound(ctx, t.account, { phone }, text('iyi akşamlar'), { now: plus(t0, 12 * HOUR + MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01', 'M01N', 'M01K', 'M01']);
    const last = await lastOut(ctx.db, conv!.id);
    expect(last!.body).not.toContain('Kişisel verileriniz');
  });

  it('request_welcome tam karşılama sayılır; sohbeti yeniden açmak "anlayamadık" yanıtı üretmez', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    await inbound(ctx, t.account, { phone }, { type: 'request_welcome' }, { now: t0 });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01']);
    expect(conv!.unreadCount).toBe(0);
    // Yazılan mesaj soğuma içinde de yanıt alır (M01N)
    await inbound(ctx, t.account, { phone }, text('merhaba'), { now: plus(t0, 5 * MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01', 'M01N']);
    // request_welcome bir mesaj değil (müşteri yalnız sohbeti açtı): soğuma içinde sessiz kalır
    await inbound(ctx, t.account, { phone }, { type: 'request_welcome' }, { now: plus(t0, 20 * MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01', 'M01N']);
  });

  it('teslim edilmiş siparişi olan müşteri → M02 (son sipariş, tutarsız)', async () => {
    const phone = nextPhone();
    const [cust] = await ctx.db.insert(customers).values({ tenantId: t.tenantId, phoneE164: phone, name: 'Mehmet' }).returning();
    await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'delivered', extra: { customerId: cust!.id } });
    await inbound(ctx, t.account, { phone }, text('selam'));
    const conv = await conversationFor(ctx.db, t.account, phone);
    const out = await lastOut(ctx.db, conv!.id);
    expect((out!.payload as unknown as OutboundPayload).code).toBe('M02');
    expect(out!.body).toContain('Tekrar hoş geldiniz Mehmet.');
    expect(out!.body).toContain('1× Test Ürün');
    expect(out!.body).not.toMatch(/TL/);
  });

  it('SSS: ödeme sorusu → M28d', async () => {
    const phone = nextPhone();
    await inbound(ctx, t.account, { phone }, text('kart geçiyor mu'));
    const conv = await conversationFor(ctx.db, t.account, phone);
    const out = await lastOut(ctx.db, conv!.id);
    expect((out!.payload as unknown as OutboundPayload).code).toBe('M28d');
    expect(out!.body).toContain('Kapıda');
  });
});

describe('insana devir', () => {
  it('"yetkili" → M20, insan modu 30 dk, panel bildirimi; süre içinde bot susar, sonra geri döner', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    await inbound(ctx, t.account, { phone }, text('Yetkiliyle görüşmek istiyorum'), { now: t0 });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M20']);
    expect((await lastOut(ctx.db, conv!.id))!.body).toContain('Sizi yetkilimize aktardık');
    expect(conv!.mode).toBe('human');
    expect(conv!.humanUntil!.getTime() - t0.getTime()).toBe(30 * MIN);
    const notes = await ctx.db.select().from(notifications).where(and(eq(notifications.tenantId, t.tenantId), eq(notifications.kind, 'conversation_handoff')));
    expect(notes.some((n) => (n.payload as { conversationId?: string }).conversationId === conv!.id)).toBe(true);
    const updates = await ctx.db.select().from(branchEvents).where(and(eq(branchEvents.branchId, t.branchId), eq(branchEvents.type, 'conversation.updated')));
    expect(updates.some((e) => (e.payload as { conversationId?: string; mode?: string }).conversationId === conv!.id && (e.payload as { mode?: string }).mode === 'human')).toBe(true);

    await inbound(ctx, t.account, { phone }, text('merhaba'), { now: plus(t0, 10 * MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M20']);
    await inbound(ctx, t.account, { phone }, text('merhaba'), { now: plus(t0, 31 * MIN) });
    const after = await getConversation(ctx.db, conv!.id);
    expect(after.mode).toBe('bot');
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M20', 'M01']);
  });

  it('"Yetkiliyle görüş" butonu (human) aynı devri yapar', async () => {
    const phone = nextPhone();
    await inbound(ctx, t.account, { phone }, { type: 'button_reply', id: 'human', title: 'Yetkiliyle görüş' });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(conv!.mode).toBe('human');
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M20']);
  });

  it('echo (işletme telefonundan) → business_phone kaydı, insan modu 30 dk, bot susar', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    await echo(ctx, t.account, { phone }, 'Merhaba, siparişiniz hazırlanıyor', { now: t0 });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(conv!.mode).toBe('human');
    expect(conv!.humanUntil!.getTime() - t0.getTime()).toBe(30 * MIN);
    const rows = await threadRows(ctx.db, conv!.id);
    expect(rows[0]).toMatchObject({ direction: 'out', kind: 'echo', sentBy: 'business_phone', body: 'Merhaba, siparişiniz hazırlanıyor', status: 'sent' });
    await inbound(ctx, t.account, { phone }, text('teşekkürler'), { now: plus(t0, 5 * MIN) });
    const after = await threadRows(ctx.db, conv!.id);
    expect(after.filter((r) => r.direction === 'out')).toHaveLength(1);
    // Döngü koruması: kendi giden mesajımıza (echo) bot yanıtı ÜRETİLMEZ
    expect(after.filter((r) => r.sentBy === 'bot')).toHaveLength(0);
  });
});

describe('opt-out / opt-in', () => {
  it('DUR → M31; "Evet, hepsini durdur" → M31a ve otomatik yanıt yok; BAŞLAT → M32', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    await inbound(ctx, t.account, { phone }, text('DUR'), { now: t0 });
    const conv = await conversationFor(ctx.db, t.account, phone);
    const m31 = await lastOut(ctx.db, conv!.id);
    expect((m31!.payload as unknown as OutboundPayload).code).toBe('M31');
    const spec = (m31!.payload as unknown as OutboundPayload).spec;
    expect(spec.type === 'interactive' && spec.interactive.buttons?.map((b) => b.id)).toEqual(['optout:all', 'optout:no']);

    await inbound(ctx, t.account, { phone }, { type: 'button_reply', id: 'optout:all', title: 'Evet, hepsini durdur' }, { now: plus(t0, MIN) });
    expect((await getConversation(ctx.db, conv!.id)).optedOut).toBe(true);
    await inbound(ctx, t.account, { phone }, text('merhaba'), { now: plus(t0, 2 * HOUR) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M31', 'M31a']);
    await inbound(ctx, t.account, { phone }, text('Başlat'), { now: plus(t0, 3 * HOUR) });
    expect((await getConversation(ctx.db, conv!.id)).optedOut).toBe(false);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M31', 'M31a', 'M32']);
  });

  it('"Dur, adresi değiştireyim" opt-out değildir', async () => {
    const phone = nextPhone();
    await inbound(ctx, t.account, { phone }, text('Dur, adresi değiştireyim'));
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01']);
  });

  it('"Hayır" → M31b', async () => {
    const phone = nextPhone();
    await inbound(ctx, t.account, { phone }, text('stop'));
    await inbound(ctx, t.account, { phone }, { type: 'button_reply', id: 'optout:no', title: 'Hayır' });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M31', 'M31b']);
    expect(conv!.optedOut).toBe(false);
  });
});

describe('kara liste / askı', () => {
  it('kara listedeki müşteri → M33 (12 sa\'te 1)', async () => {
    const phone = nextPhone();
    await ctx.db.insert(customers).values({ tenantId: t.tenantId, phoneE164: phone, isBlocked: true });
    const t0 = new Date();
    await inbound(ctx, t.account, { phone }, text('merhaba'), { now: t0 });
    await inbound(ctx, t.account, { phone }, text('merhaba'), { now: plus(t0, 6 * HOUR) });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M33']);
    await inbound(ctx, t.account, { phone }, text('merhaba'), { now: plus(t0, 12 * HOUR + MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M33', 'M33']);
  });

  it('online siparişi kapatılmış (askı) işletme → M33', async () => {
    const s = await setupWaTenant(ctx);
    await ctx.db.update(tenants).set({ orderingEnabled: false }).where(eq(tenants.id, s.tenantId));
    const phone = nextPhone();
    await inbound(ctx, s.account, { phone }, text('merhaba'));
    const conv = await conversationFor(ctx.db, s.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M33']);
  });
});

describe('şube durumu ve açık sipariş', () => {
  it('kapalı şube → M03 (6 sa\'te 1); açık siparişi varsa M03 değil M26', async () => {
    const s = await setupWaTenant(ctx);
    await ctx.db.delete(openingHours).where(eq(openingHours.branchId, s.branchId));
    const phone = nextPhone();
    const t0 = new Date();
    await inbound(ctx, s.account, { phone }, text('merhaba'), { now: t0 });
    const conv = await conversationFor(ctx.db, s.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M03']);
    // Kapalı bilgisi 6 sa'te 1: soğuma içinde M03 yinelenmez ama müşteri yanıtsız da kalmaz (M01N kapalı varyantı)
    await inbound(ctx, s.account, { phone }, text('merhaba'), { now: plus(t0, 5 * HOUR) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M03', 'M01N']);
    expect((await lastOut(ctx.db, conv!.id))!.body).toContain('Şu an sipariş alamıyoruz');
    await inbound(ctx, s.account, { phone }, text('merhaba'), { now: plus(t0, 6 * HOUR + MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M03', 'M01N', 'M03']);

    // Açık sipariş: kapalı şubede bile durum kartı
    const phone2 = nextPhone();
    const [cust] = await ctx.db.insert(customers).values({ tenantId: s.tenantId, phoneE164: phone2 }).returning();
    const order = await ctx.createOrder({ tenantId: s.tenantId, branchId: s.branchId, status: 'accepted', extra: { customerId: cust!.id, estimatedReadyAt: plus(t0, 30 * MIN) } });
    await inbound(ctx, s.account, { phone: phone2 }, text('siparişim nerede'), { now: t0 });
    const conv2 = await conversationFor(ctx.db, s.account, phone2);
    const out = await lastOut(ctx.db, conv2!.id);
    expect((out!.payload as unknown as OutboundPayload).code).toBe('M26');
    expect(out!.body).toContain(`#${order.number} numaralı siparişinizin durumu: Onaylandı`);
    // Durum kartı 15 dk'da 1: soğuma içinde kart yinelenmez, yerine takip bağlantılı yardım gider
    await inbound(ctx, s.account, { phone: phone2 }, text('?'), { now: plus(t0, 10 * MIN) });
    expect(await outCodes(ctx.db, conv2!.id)).toEqual(['M26', 'M01N']);
    const help = await lastOut(ctx.db, conv2!.id);
    expect(help!.body).toContain('takip edebilirsiniz');
    // Anlaşılan mesaja "anlayamadık" denmez: yalnız durum kartı soğumada (M01N'in anlasildi varyantı)
    expect(help!.body).not.toContain('anlayamadık');
    const helpSpec = (help!.payload as unknown as OutboundPayload).spec;
    expect(helpSpec.type === 'interactive' && helpSpec.interactive.url?.label).toBe('Siparişi takip et');
    await inbound(ctx, s.account, { phone: phone2 }, text('?'), { now: plus(t0, 16 * MIN) });
    expect(await outCodes(ctx.db, conv2!.id)).toEqual(['M26', 'M01N', 'M26']);
    // Aktif siparişte konum: işletme panelde görür, müşteri de "ilettik" yanıtı alır (M30c)
    await inbound(ctx, s.account, { phone: phone2 }, { type: 'location', lat: 39.8, lng: 34.8 }, { now: plus(t0, 40 * MIN) });
    expect(await outCodes(ctx.db, conv2!.id)).toEqual(['M26', 'M01N', 'M26', 'M30c']);
    expect((await lastOut(ctx.db, conv2!.id))!.body).toContain('Konumunuzu işletmeye ilettik');
  });

  it('duraklatılmış şube → M04 (12 sa\'te 1)', async () => {
    const s = await setupWaTenant(ctx);
    const t0 = new Date();
    await ctx.db.update(branches).set({ pausedUntil: plus(t0, 2 * HOUR) }).where(eq(branches.id, s.branchId));
    const phone = nextPhone();
    await inbound(ctx, s.account, { phone }, text('merhaba'), { now: t0 });
    const conv = await conversationFor(ctx.db, s.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M04']);
    expect((await lastOut(ctx.db, conv!.id))!.body).toContain('itibarıyla yeniden sipariş alacağız');
    // Duraklatma bilgisi 12 sa'te 1: soğuma içinde yanıtsız kalmaz
    await inbound(ctx, s.account, { phone }, text('merhaba'), { now: plus(t0, HOUR) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M04', 'M01N']);
  });

  it('açık siparişte "iptal" → M27a (onay butonları)', async () => {
    const phone = nextPhone();
    const [cust] = await ctx.db.insert(customers).values({ tenantId: t.tenantId, phoneE164: phone }).returning();
    const order = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new', extra: { customerId: cust!.id } });
    await inbound(ctx, t.account, { phone }, text('iptal etmek istiyorum'));
    const conv = await conversationFor(ctx.db, t.account, phone);
    const out = await lastOut(ctx.db, conv!.id);
    const p = out!.payload as unknown as OutboundPayload;
    expect(p.code).toBe('M27a');
    expect(p.spec.type === 'interactive' && p.spec.interactive.buttons?.map((b) => b.id)).toEqual([`cancel:${order.id}`, `keep:${order.id}`]);
  });

  it('buton yanıtı: "Vazgeçtim" ve bayat "Beklerim" sessiz kalmaz (durum kartı)', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    const [cust] = await ctx.db.insert(customers).values({ tenantId: t.tenantId, phoneE164: phone }).returning();
    const order = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new', extra: { customerId: cust!.id } });
    await inbound(ctx, t.account, { phone }, text('iptal etmek istiyorum'), { now: t0 });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect((await outCodes(ctx.db, conv!.id)).at(-1)).toBe('M27a');
    // "Vazgeçtim": kendi metni yok; eskiden TAM SESSİZLİK vardı → olağan sıra durum kartını gönderir
    await inbound(ctx, t.account, { phone }, { type: 'button_reply', id: `keep:${order.id}` }, { now: plus(t0, 3 * MIN) });
    expect((await outCodes(ctx.db, conv!.id)).at(-1)).toBe('M26');
    // Bayat buton: işletme bu arada onayladı, "Beklerim" artık uygun değil → yanıtsız bırakılmaz
    await ctx.db.update(orders).set({ status: 'accepted' }).where(eq(orders.id, order.id));
    await inbound(ctx, t.account, { phone }, { type: 'button_reply', id: `wait:${order.id}` }, { now: plus(t0, 25 * MIN) });
    const son = await lastOut(ctx.db, conv!.id);
    expect((son!.payload as unknown as OutboundPayload).code).toBe('M26');
    expect(son!.body).toContain('Onaylandı');
  });
});

describe('medya ve desteklenmeyen', () => {
  it('ses → M29 (30 dk\'da 1); görsel → M30b; desteklenmeyen → M30; soğumalarda kısa yardım', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    await inbound(ctx, t.account, { phone }, { type: 'audio' }, { now: t0 });
    // Ses yanıtı 30 dk'da 1: soğuma içinde sessiz değil, kısa yardım
    await inbound(ctx, t.account, { phone }, { type: 'audio' }, { now: plus(t0, 10 * MIN) });
    // Görsel: eskiden HİÇ yanıt yoktu → M30b
    await inbound(ctx, t.account, { phone }, { type: 'image', caption: 'menü fotoğrafı' }, { now: plus(t0, 20 * MIN) });
    await inbound(ctx, t.account, { phone }, { type: 'unsupported' }, { now: plus(t0, 30 * MIN) });
    await inbound(ctx, t.account, { phone }, { type: 'unsupported' }, { now: plus(t0, 40 * MIN) });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M29', 'M01N', 'M30b', 'M30', 'M01N']);
    const rows = await threadRows(ctx.db, conv!.id);
    expect(rows.filter((r) => r.direction === 'in').map((r) => r.kind)).toEqual(['audio', 'audio', 'image', 'system', 'system']);
    const media = rows.filter((r) => r.direction === 'out').find((r) => (r.payload as unknown as OutboundPayload | null)?.code === 'M30b');
    expect(media!.body).toContain('Gönderdiğiniz dosyayı işletmeye ilettik');
  });
});

describe('tanınmayan mesaj: sessizlik yok (M01N), spam de yok', () => {
  it('emoji ve tek harf de yanıt alır; ilk temasta karşılama, soğumada kısa yardım', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    // İlk temas: emoji de olsa tam karşılama gider
    await inbound(ctx, t.account, { phone }, text('😀'), { now: t0 });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01']);
    // Soğuma içinde tek harf / emoji: yanıtsız kalmaz
    await inbound(ctx, t.account, { phone }, text('a'), { now: plus(t0, 5 * MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01', 'M01N']);
    await inbound(ctx, t.account, { phone }, text('🙏'), { now: plus(t0, 15 * MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01', 'M01N', 'M01N']);
  });

  it('request_welcome açık siparişte de "anlayamadık" almaz (yazılmış bir mesaj yok)', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    const [cust] = await ctx.db.insert(customers).values({ tenantId: t.tenantId, phoneE164: phone }).returning();
    await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'accepted', extra: { customerId: cust!.id } });
    await inbound(ctx, t.account, { phone }, text('siparişim nerede'), { now: t0 });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M26']);
    // Durum kartı soğuması (15 dk) içinde sohbeti yeniden açmak: müşteri bir şey YAZMADI → sessiz
    await inbound(ctx, t.account, { phone }, { type: 'request_welcome' }, { now: plus(t0, 5 * MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M26']);
    // Yazılan mesaj aynı soğumada yanıt alır (kapı yalnız request_welcome için)
    await inbound(ctx, t.account, { phone }, text('?'), { now: plus(t0, 6 * MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M26', 'M01N']);
  });

  it('saatlik üst sınır (4) dolunca kısa süre sessiz, sonra yine yanıt verir', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    await inbound(ctx, t.account, { phone }, text('merhaba'), { now: t0 });
    for (const dk of [10, 13, 16, 19, 22, 25]) {
      await inbound(ctx, t.account, { phone }, text('aaa'), { now: plus(t0, dk * MIN) });
    }
    const conv = await conversationFor(ctx.db, t.account, phone);
    // 4 yardım yanıtı gitti, 5. ve 6. mesaj sınır nedeniyle yanıtsız (müşteri son 15 dk'da 4 yanıt aldı)
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01', 'M01N', 'M01N', 'M01N', 'M01N']);
    // Sınır kalıcı sessizlik DEĞİL: pencere kayınca motor yine yanıt verir
    await inbound(ctx, t.account, { phone }, text('bbb'), { now: plus(t0, 90 * MIN) });
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01', 'M01N', 'M01N', 'M01N', 'M01N', 'M01K']);
  });

  it('InboundResult.replied: yanıt üretilince true, bilerek sessiz kalınca false (yönlendirici sözleşmesi)', async () => {
    const now = new Date();
    const deps = { db: ctx.db, config: ctx.config, log: silentLog };
    const ev = (phone: string, wamid: string) => ({
      type: 'message' as const,
      phoneNumberId: null,
      wamid,
      from: { phone },
      timestamp: now,
      message: { kind: 'text' as const, text: 'merhaba' },
    });
    const yes = await handleInboundMessage(deps, t.account, ev(nextPhone(), 'wamid.replied.yes'), now);
    expect(yes).toMatchObject({ status: 'processed', replied: true });

    // Bot kapalı: mesaj panele düşer, yanıt üretilmez
    const off = await setupWaTenant(ctx);
    await ctx.db.update(tenants).set({ botEnabled: false }).where(eq(tenants.id, off.tenantId));
    const no = await handleInboundMessage(deps, off.account, ev(nextPhone(), 'wamid.replied.no'), now);
    expect(no).toMatchObject({ status: 'processed', replied: false });
    // Tekrar teslim (aynı wamid) da yanıt üretmez
    const dup = await handleInboundMessage(deps, t.account, ev('+905550000001', 'wamid.replied.yes'), now);
    expect(dup).toMatchObject({ status: 'duplicate', replied: false });
  });
});

describe('saklama (cron.retention): konum/medya 30 gün', () => {
  it('31 günlük konum mesajının koordinat/adresi ve medya (ses, görsel, belge) kimliği silinir; yeni mesaj ve metin dokunulmaz', async () => {
    const phone = nextPhone();
    await inbound(ctx, t.account, { phone }, { type: 'location', lat: 39.8201, lng: 34.8089, name: 'Ev', address: 'Yeni Mah. 5. Sok. No 3' });
    await inbound(ctx, t.account, { phone }, { type: 'image', caption: 'kapı' });
    await inbound(ctx, t.account, { phone }, { type: 'text', text: 'merhaba' });
    await inbound(ctx, t.account, { phone }, { type: 'location', lat: 39.83, lng: 34.81 });
    // Belge sistem mesajı olarak (mediaType) kaydedilir; medya kimliği yine 30 günde silinir
    await inbound(ctx, t.account, { phone }, { type: 'document', caption: 'reçete' });
    const conv = await conversationFor(ctx.db, t.account, phone);
    const ins = (await threadRows(ctx.db, conv!.id)).filter((r) => r.direction === 'in');
    const [oldLoc, oldImg, oldText, newLoc, oldDoc] = ins;
    await ctx.db
      .update(messages)
      .set({ createdAt: new Date(Date.now() - 31 * 24 * HOUR) })
      .where(inArray(messages.id, [oldLoc!.id, oldImg!.id, oldText!.id, oldDoc!.id]));
    await enqueueJob(ctx.db, { queue: 'cron', type: 'cron.retention' });
    await runJobs(ctx, ['cron.retention']);
    const rows = await ctx.db.select().from(messages).where(inArray(messages.id, ins.map((r) => r.id)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const loc = byId.get(oldLoc!.id)!;
    expect(loc.body).toBe('Konum paylaşıldı');
    expect(JSON.stringify(loc.payload)).not.toMatch(/39\.82|34\.80|Yeni Mah/);
    expect(loc.payload).toMatchObject({ type: 'location' });
    expect(byId.get(oldImg!.id)!.payload).not.toHaveProperty('mediaId');
    const doc = byId.get(oldDoc!.id)!;
    expect(doc.kind).toBe('system');
    expect(doc.payload).toMatchObject({ mediaType: 'document' });
    expect(doc.payload).not.toHaveProperty('mediaId');
    expect(byId.get(oldText!.id)!.body).toBe('merhaba');
    expect(byId.get(newLoc!.id)!.payload).toMatchObject({ lat: 39.83, lng: 34.81 });
  });
});

describe('kimlik ve idempotency', () => {
  it('aynı wamid ikinci kez işlenmez', async () => {
    const phone = nextPhone();
    const first = await inbound(ctx, t.account, { phone }, text('merhaba'));
    const again = await inbound(ctx, t.account, { phone }, text('merhaba'), { wamid: first.wamid });
    expect(again.summary).toMatchObject({ messages: 0, duplicates: 1 });
    const conv = await conversationFor(ctx.db, t.account, phone);
    expect((await threadRows(ctx.db, conv!.id)).filter((r) => r.direction === 'in')).toHaveLength(1);
    expect(conv!.unreadCount).toBe(1);
  });

  it('yalnız BSUID (telefonsuz) müşteri; sonra telefon gelince aynı kayda yazılır', async () => {
    const bsuid = `TR.${phoneSeq++}${Date.now()}`;
    await inbound(ctx, t.account, { bsuid, name: 'Kullanıcı Adlı' }, text('merhaba'));
    const [c1] = await ctx.db.select().from(customers).where(and(eq(customers.tenantId, t.tenantId), eq(customers.waBsuid, bsuid)));
    expect(c1!.phoneE164).toBeNull();
    const phone = nextPhone();
    await inbound(ctx, t.account, { bsuid, phone }, text('tekrar'));
    const [c2] = await ctx.db.select().from(customers).where(eq(customers.id, c1!.id));
    expect(c2!.phoneE164).toBe(phone);
    const convs = await ctx.db.select().from(conversations).where(eq(conversations.customerId, c1!.id));
    expect(convs).toHaveLength(1);
  });

  it('BSUID\'siz telefon kaydı (telefon siparişi) WhatsApp\'tan yazınca birleşir (kural 2)', async () => {
    const phone = nextPhone();
    const [manual] = await ctx.db.insert(customers).values({ tenantId: t.tenantId, phoneE164: phone, name: 'Telefon Müşterisi' }).returning();
    const bsuid = `TR.m${phoneSeq++}`;
    await inbound(ctx, t.account, { bsuid, phone, name: 'WA Adı' }, text('merhaba'));
    const rows = await ctx.db.select().from(customers).where(and(eq(customers.tenantId, t.tenantId), eq(customers.phoneE164, phone)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: manual!.id, waBsuid: bsuid, name: 'Telefon Müşterisi' });
  });
});
