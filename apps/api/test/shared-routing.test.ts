// Ortak numara yönlendiricisi (00 §12a madde 8; 14 §8.1): QR/#KOD ile dükkan seçimi, ikinci kodla dükkan değişimi,
// 24 saat içinde güncel dükkana devam, eski yönlendirmede son dükkanlar butonu, tüm liste ve sayfalama, komutlar,
// ad eşleşmesi, Akış B kodunun global araması, etkileşimli yanıtın doğru dükkana gitmesi, dükkan adıyla marka,
// platform mesajlarının hiçbir dükkanın sohbetine girmemesi ve tenant yalıtımı. Kendi numaralı işletme etkilenmez.

import { sharedPrefillText } from '@siparis/core';
import { conversations, customers, messages, orders, reviews, sharedWaMessages, tenants } from '@siparis/db';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildStatusPayload } from '../src/services/messaging/dev-payload';
import { processWebhookEvent } from '../src/services/messaging/ingest';
import { upsertConversation } from '../src/services/messaging/customers';
import { queueOutbound, type OutboundPayload } from '../src/services/messaging/outbound';
import { findSharedRoute, ingestSharedWebhookPayload } from '../src/services/messaging/shared-router';
import { transitionOrder } from '../src/services/orders/transition';
import { clearMockSent, mockSentMessages } from '../src/wa/providers/mock';
import { createTestContext, type TestContext } from './helpers';
import {
  HOUR,
  MIN,
  SHARED_DEV_ACCOUNT,
  conversationFor,
  createAwaitingOrder,
  flushNotify,
  flushOutbound,
  getOrder,
  inbound,
  lastOut,
  outCodes,
  plus,
  runJobs,
  setupSharedTenant,
  setupWaTenant,
  sharedInbound,
  silentLog,
  threadRows,
  type WaSetup,
} from './wa-helpers';

let ctx: TestContext;
let A: WaSetup; // Bozok Pide Salonu #BOZOK
let B: WaSetup; // Çamlık Döner #DONER
let E: WaSetup; // Yozgat Pide Evi #PIDEEVI
let D: WaSetup; // Kapalı Kebap #KAPALI (canlı değil)
let C: WaSetup; // kendi numaralı (own) #KENDI

let seq = 5000;
const nextPhone = () => `+90536${String(1000000 + seq++).slice(-7)}`;
const text = (s: string) => ({ type: 'text' as const, text: s });
const list = (id: string) => ({ type: 'list_reply' as const, id });
const button = (id: string) => ({ type: 'button_reply' as const, id });

type PlatformRow = typeof sharedWaMessages.$inferSelect;
type ListSpec = { type: 'interactive'; interactive: { kind: string; body: string; header?: string; buttons?: { id: string; title: string }[]; list?: { sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[] } } };

async function platformRows(phone: string, direction: 'in' | 'out' = 'out'): Promise<PlatformRow[]> {
  const route = await findSharedRoute(ctx.db, { phone });
  if (!route) return [];
  return ctx.db
    .select()
    .from(sharedWaMessages)
    .where(and(eq(sharedWaMessages.routeId, route.id), eq(sharedWaMessages.direction, direction)))
    .orderBy(asc(sharedWaMessages.createdAt));
}
const lastPlatform = async (phone: string) => (await platformRows(phone)).at(-1);
const specOf = (m: { payload: unknown } | undefined) => (m!.payload as { spec: ListSpec }).spec;
const codeOf = (m: { payload: unknown } | undefined) => (m!.payload as { code?: string }).code;
const listRows = (m: PlatformRow | undefined) => specOf(m).interactive.list!.sections.flatMap((s) => s.rows);
const convOf = (t: WaSetup, phone: string) => conversationFor(ctx.db, t.account, phone);
async function countMessages(t: WaSetup): Promise<number> {
  return (await ctx.db.select({ id: messages.id }).from(messages).where(eq(messages.tenantId, t.tenantId))).length;
}

beforeAll(async () => {
  ctx = await createTestContext();
  A = await setupSharedTenant(ctx, { name: 'Bozok Pide Salonu', code: 'BOZOK' });
  B = await setupSharedTenant(ctx, { name: 'Çamlık Döner', code: 'DONER' });
  E = await setupSharedTenant(ctx, { name: 'Yozgat Pide Evi', code: 'PIDEEVI' });
  D = await setupSharedTenant(ctx, { name: 'Kapalı Kebap', code: 'KAPALI', live: false });
  C = await setupWaTenant(ctx, { name: 'Kendi Numaralı Lokanta' });
  await ctx.db.update(tenants).set({ waCode: 'KENDI' }).where(eq(tenants.id, C.tenantId));
});
afterAll(async () => {
  await ctx.close();
});

// ---------------------------------------------------------------------------
describe('dükkan seçimi (QR / #KOD)', () => {
  const phone = nextPhone();
  const t0 = new Date();

  it('#BOZOK (QR ön-dolu metni) → Bozok karşılaması (M01, menü linki), dükkan adıyla; güncel dükkan Bozok', async () => {
    clearMockSent();
    const r = await sharedInbound(ctx, { phone, name: 'Ayşe' }, text(sharedPrefillText('Bozok Pide Salonu', 'BOZOK')), { now: t0 });
    expect(r.summary).toMatchObject({ messages: 1, duplicates: 0 });
    const conv = await convOf(A, phone);
    expect(conv).toBeDefined();
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01']);
    const out = await lastOut(ctx.db, conv!.id);
    const payload = out!.payload as unknown as OutboundPayload;
    expect(out!.body!.startsWith('*Bozok Pide Salonu*\nMerhaba Ayşe, Bozok Pide Salonu WhatsApp sipariş hattına hoş geldiniz!')).toBe(true);
    expect(payload.brand).toBe('Bozok Pide Salonu');
    expect(payload.spec).toMatchObject({ type: 'interactive', interactive: { kind: 'cta_url', header: 'Bozok Pide Salonu' } });
    expect((payload.spec as ListSpec & { interactive: { url: { href: string } } }).interactive.url.href).toContain(`/s/${A.slug}?l=`);
    const inRows = (await threadRows(ctx.db, conv!.id)).filter((m) => m.direction === 'in');
    expect(inRows).toHaveLength(1);
    const route = await findSharedRoute(ctx.db, { phone });
    expect(route).toMatchObject({ currentTenantId: A.tenantId, recentTenantIds: [A.tenantId], phoneE164: phone });
    expect(await platformRows(phone)).toHaveLength(0);
    // Gönderim platform sağlayıcısıyla (mock), başlık dükkan adı
    await flushOutbound(ctx);
    const sent = mockSentMessages().at(-1)!;
    expect(sent.accountId).toBe(A.account.id);
    expect(sent.body).toMatchObject({ to: phone.slice(1), interactive: { header: { type: 'text', text: 'Bozok Pide Salonu' } } });
    expect((await lastOut(ctx.db, conv!.id))!.status).toBe('sent');
  });

  it('başka dükkanın QR\'ı (#DONER) → Çamlık Döner; Bozok sohbeti değişmez', async () => {
    const before = await countMessages(A);
    await sharedInbound(ctx, { phone }, text(sharedPrefillText('Çamlık Döner', 'DONER')), { now: plus(t0, MIN) });
    const conv = await convOf(B, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01']);
    expect((await lastOut(ctx.db, conv!.id))!.body!.startsWith('*Çamlık Döner*\n')).toBe(true);
    expect(await countMessages(A)).toBe(before);
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: B.tenantId, recentTenantIds: [B.tenantId, A.tenantId] });
  });

  it('kodsuz mesaj 24 saat içinde güncel dükkana (Çamlık Döner) gider', async () => {
    const beforeA = await countMessages(A);
    await sharedInbound(ctx, { phone }, text('Acılı olsun lütfen'), { now: plus(t0, 2 * MIN) });
    const conv = await convOf(B, phone);
    const ins = (await threadRows(ctx.db, conv!.id)).filter((m) => m.direction === 'in').map((m) => m.body);
    expect(ins.at(-1)).toBe('Acılı olsun lütfen');
    expect(await countMessages(A)).toBe(beforeA);
    expect(await platformRows(phone)).toHaveLength(0);
  });

  it('listeden aynı dükkanı tekrar seçmek soğuma beklemeden karşılar (seçim zorlanır)', async () => {
    await sharedInbound(ctx, { phone }, list(`shop:${A.tenantId}`), { now: plus(t0, 3 * MIN) });
    const conv = await convOf(A, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01', 'M01']);
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: A.tenantId, recentTenantIds: [A.tenantId, B.tenantId] });
  });

  it('24 saatten eski yönlendirme: son 2 dükkan + "Diğer dükkanlar" butonu (P01); dükkan sohbetlerine girmez', async () => {
    const [ba, bb] = [await countMessages(A), await countMessages(B)];
    await sharedInbound(ctx, { phone }, text('merhaba'), { now: plus(t0, 25 * HOUR) });
    const p = await lastPlatform(phone);
    expect(codeOf(p)).toBe('P01');
    expect(specOf(p).interactive).toMatchObject({
      kind: 'buttons',
      body: 'Hangi dükkandan sipariş vermek istersin?',
      buttons: [
        { id: `shop:${A.tenantId}`, title: 'Bozok Pide Salonu' },
        { id: `shop:${B.tenantId}`, title: 'Çamlık Döner' },
        { id: 'shops:list', title: 'Diğer dükkanlar' },
      ],
    });
    expect(p!.body).toBe('Hangi dükkandan sipariş vermek istersin?');
    expect([await countMessages(A), await countMessages(B)]).toEqual([ba, bb]);
    // Gelen mesaj platform düzeyinde kalır
    expect((await platformRows(phone, 'in')).map((m) => m.body)).toEqual(['merhaba']);
  });

  it('"Diğer dükkanlar" → liste (P02): yalnız ortak numarada canlı dükkanlar, bölüm başlığıyla', async () => {
    await sharedInbound(ctx, { phone }, button('shops:list'), { now: plus(t0, 25 * HOUR + MIN) });
    const p = await lastPlatform(phone);
    expect(codeOf(p)).toBe('P02');
    const rows = listRows(p);
    expect(rows.map((r) => r.title)).toEqual(['Bozok Pide Salonu', 'Çamlık Döner', 'Yozgat Pide Evi']);
    expect(rows.map((r) => r.id)).toEqual([`shop:${A.tenantId}`, `shop:${B.tenantId}`, `shop:${E.tenantId}`]);
    expect(specOf(p).interactive.list!.sections[0]!.title).toBe('Merkez, Yozgat');
    expect(rows.some((r) => r.title === 'Kapalı Kebap' || r.title === 'Kendi Numaralı Lokanta')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('seçici: kayıtsız müşteri, soğuma, komutlar', () => {
  it('ilk kez kodsuz yazan → tüm liste; 60 sn içinde ikinci seçici gitmez; "dükkanlar" komutu her zaman yanıtlanır', async () => {
    const phone = nextPhone();
    const t = new Date();
    await sharedInbound(ctx, { phone }, text('selam'), { now: t });
    expect((await platformRows(phone)).map(codeOf)).toEqual(['P02']);
    await sharedInbound(ctx, { phone }, text('selam'), { now: plus(t, 10_000) });
    expect(await platformRows(phone)).toHaveLength(1);
    await sharedInbound(ctx, { phone }, text('Dükkanlar'), { now: plus(t, 20_000) });
    expect((await platformRows(phone)).map(codeOf)).toEqual(['P02', 'P02']);
    // Hiçbir dükkanda konuşma açılmadı
    for (const s of [A, B, E]) expect(await convOf(s, phone)).toBeUndefined();
  });

  it('tekrar teslim (aynı wamid) yinelenmez', async () => {
    const phone = nextPhone();
    const first = await sharedInbound(ctx, { phone }, text('iyi akşamlar'), { wamid: 'wamid.shared.dup.1' });
    expect(first.summary).toMatchObject({ messages: 1 });
    const again = await sharedInbound(ctx, { phone }, text('iyi akşamlar'), { wamid: 'wamid.shared.dup.1' });
    expect(again.summary).toMatchObject({ messages: 0, duplicates: 1 });
    expect(await platformRows(phone)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('Akış B ve etkileşimli yanıtlar', () => {
  const phone = nextPhone();
  let orderId: string;

  it('Akış B kodu tüm işletmelerde aranır: güncel dükkan Bozok olsa da kod Çamlık Döner\'in siparişine gider', async () => {
    await sharedInbound(ctx, { phone, name: 'Veli' }, text('#BOZOK'));
    const order = await createAwaitingOrder(ctx, B, 'K7M2Q9', { extra: { customerPhone: phone } });
    orderId = order.id;
    await sharedInbound(ctx, { phone }, text('Sipariş kodu: K7M2Q9'));
    const o = await getOrder(ctx.db, order.id);
    const conv = await convOf(B, phone);
    expect(o).toMatchObject({ status: 'new', verificationMethod: 'wa_code', conversationId: conv!.id });
    const out = await lastOut(ctx.db, conv!.id);
    expect((out!.payload as unknown as OutboundPayload).code).toBe('M05');
    expect(out!.body!.startsWith('*Çamlık Döner*\n')).toBe(true);
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: B.tenantId });
    // Bozok'ta bu sipariş için mesaj yok
    const aConv = await convOf(A, phone);
    expect(await outCodes(ctx.db, aConv!.id)).toEqual(['M01']);
  });

  it('sipariş kimlikli buton (değerlendirme) başka dükkan güncelken siparişin dükkanına gider', async () => {
    await sharedInbound(ctx, { phone }, text('#BOZOK'));
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: A.tenantId });
    await ctx.db.update(orders).set({ status: 'delivered', deliveredAt: new Date() }).where(eq(orders.id, orderId));
    await sharedInbound(ctx, { phone }, button(`review:${orderId}:good`));
    const [rev] = await ctx.db.select().from(reviews).where(eq(reviews.orderId, orderId));
    expect(rev).toMatchObject({ tenantId: B.tenantId, rating: 'good' });
    const conv = await convOf(B, phone);
    expect((await outCodes(ctx.db, conv!.id)).at(-1)).toBe('M10a');
    expect((await lastOut(ctx.db, conv!.id))!.body).toBe('*Çamlık Döner*\nÇok sevindik, teşekkür ederiz!');
  });

  it('yanıtlanan mesaj (context) dükkanı belirler: Çamlık Döner mesajındaki "Yetkiliyle görüş" o dükkana', async () => {
    await sharedInbound(ctx, { phone }, text('#BOZOK'));
    await flushOutbound(ctx);
    const conv = await convOf(B, phone);
    const bOut = (await threadRows(ctx.db, conv!.id)).filter((m) => m.direction === 'out' && m.wamid);
    expect(bOut.length).toBeGreaterThan(0);
    await sharedInbound(ctx, { phone }, button('human'), { contextWamid: bOut.at(-1)!.wamid! });
    const [c] = await ctx.db.select().from(conversations).where(eq(conversations.id, conv!.id));
    expect(c!.mode).toBe('human');
    const aConv = await convOf(A, phone);
    const [ac] = await ctx.db.select().from(conversations).where(eq(conversations.id, aConv!.id));
    expect(ac!.mode).toBe('bot');
  });
});

// ---------------------------------------------------------------------------
describe('dükkan adı ve komutlar', () => {
  it('adın tamamı → tek eşleşme seçilir (karşılama)', async () => {
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, text("Çamlık Döner'den sipariş vermek istiyorum"));
    const conv = await convOf(B, phone);
    expect(await outCodes(ctx.db, conv!.id)).toEqual(['M01']);
    expect(await platformRows(phone)).toHaveLength(0);
  });

  it('küçük yazım hatası ve ek tolere edilir ("bozokdan")', async () => {
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, text('bozokdan'));
    expect(await outCodes(ctx.db, (await convOf(A, phone))!.id)).toEqual(['M01']);
  });

  it('birden çok eşleşme → yalnız eşleşen dükkanların listesi', async () => {
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, text('pide'));
    const p = await lastPlatform(phone);
    expect(codeOf(p)).toBe('P02');
    expect(specOf(p).interactive.body).toBe('Yazdığına uyan birden fazla dükkan var. Hangisinden sipariş vermek istersin?');
    expect(listRows(p).map((r) => r.title)).toEqual(['Bozok Pide Salonu', 'Yozgat Pide Evi']);
  });

  it('yalın kod sözcüğü yalnız etkin dükkan yokken seçer; etkin oturumda "#KOD" gerekir', async () => {
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, text('doner'));
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: B.tenantId });
    await sharedInbound(ctx, { phone }, text('bozok'));
    const bIns = (await threadRows(ctx.db, (await convOf(B, phone))!.id)).filter((m) => m.direction === 'in').map((m) => m.body);
    expect(bIns).toEqual(['doner', 'bozok']);
    expect(await convOf(A, phone)).toBeUndefined();
    await sharedInbound(ctx, { phone }, text('#bozok'));
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: A.tenantId });
  });

  it('"başka dükkan" 24 saat içinde bile seçici gösterir (son dükkan önde)', async () => {
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, text('#DONER'));
    await sharedInbound(ctx, { phone }, text('Başka dükkan'));
    const p = await lastPlatform(phone);
    expect(codeOf(p)).toBe('P01');
    expect(specOf(p).interactive.buttons!.map((b) => b.id)).toEqual([`shop:${B.tenantId}`, 'shops:list']);
  });
});

// ---------------------------------------------------------------------------
describe('kodun işletmesi seçilemiyorsa', () => {
  it('kendi numaralı işletmenin kodu → kendi numarası bilgisi (P03)', async () => {
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, text('#KENDI'));
    const p = await lastPlatform(phone);
    expect(codeOf(p)).toBe('P03');
    expect(p!.body).toBe(
      'Kendi Numaralı Lokanta siparişlerini kendi WhatsApp numarasından alıyor: 0555 000 00 99\nBu bağlantıdan yazabilirsin: https://wa.me/905550000099',
    );
    expect(await conversationFor(ctx.db, C.account, phone)).toBeUndefined();
  });

  it('canlı olmayan dükkanın kodu (P04) ve listeden seçilmeye çalışılması', async () => {
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, text('kapali'));
    const p = await lastPlatform(phone);
    expect(codeOf(p)).toBe('P04');
    expect(p!.body).toBe('Kapalı Kebap şu an bu numaradan sipariş almıyor. Başka bir dükkan için "dükkanlar" yazabilirsin.');
    await sharedInbound(ctx, { phone }, list(`shop:${D.tenantId}`));
    const p2 = await lastPlatform(phone);
    expect(specOf(p2).interactive.body.startsWith('Kapalı Kebap şu an bu numaradan sipariş almıyor.')).toBe(true);
    expect(await convOf(D, phone)).toBeUndefined();
  });

  it('bilinmeyen #kod seçiciye düşer; bulunamayan Akış B kodu listede not düşer', async () => {
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, text('#YOKBOYLE'));
    expect(codeOf(await lastPlatform(phone))).toBe('P02');
    const phone2 = nextPhone();
    await sharedInbound(ctx, { phone: phone2 }, text('Sipariş kodu: ZZ9ZZ9'));
    const p = await lastPlatform(phone2);
    expect(specOf(p).interactive.body.startsWith('Bu sipariş kodunu bulamadık.')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('opt-out, durum olayları, gönderim', () => {
  it('"DUR" güncel dükkana gider; dükkanı olmayan kişiye yanıt yok', async () => {
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, text('#DONER'));
    await sharedInbound(ctx, { phone }, text('DUR'));
    expect((await outCodes(ctx.db, (await convOf(B, phone))!.id)).at(-1)).toBe('M31');
    const lonely = nextPhone();
    await sharedInbound(ctx, { phone: lonely }, text('DUR'));
    expect(await platformRows(lonely)).toHaveLength(0);
    expect((await platformRows(lonely, 'in')).map((m) => m.body)).toEqual(['DUR']);
  });

  it('platform mesajı ortak numaradan gider; durum olayları doğru kayda yazılır', async () => {
    const phone = nextPhone();
    clearMockSent();
    await sharedInbound(ctx, { phone }, text('selamlar'));
    await sharedInbound(ctx, { phone }, text('#BOZOK'));
    expect(await runJobs(ctx, ['wa.send_shared'])).toBeGreaterThan(0);
    await flushOutbound(ctx);
    const p = await lastPlatform(phone);
    expect(p).toMatchObject({ status: 'sent' });
    expect(p!.wamid).toMatch(/^mock\./);
    expect(mockSentMessages().some((m) => m.accountId === 'platform' && m.wamid === p!.wamid)).toBe(true);
    const deps = { db: ctx.db, config: ctx.config, log: silentLog };
    const st1 = await ingestSharedWebhookPayload(ctx.db, buildStatusPayload(SHARED_DEV_ACCOUNT, { wamid: p!.wamid!, status: 'delivered' }));
    await processWebhookEvent(deps, st1.webhookEventId);
    expect((await lastPlatform(phone))!.status).toBe('delivered');
    const tOut = await lastOut(ctx.db, (await convOf(A, phone))!.id);
    const st2 = await ingestSharedWebhookPayload(ctx.db, buildStatusPayload(SHARED_DEV_ACCOUNT, { wamid: tOut!.wamid!, status: 'read' }));
    await processWebhookEvent(deps, st2.webhookEventId);
    expect((await lastOut(ctx.db, (await convOf(A, phone))!.id))!.status).toBe('read');
  });
});

// ---------------------------------------------------------------------------
describe('marka: bildirimler, elle yanıt, kendi numara', () => {
  it('onay bildirimi pencere içinde dükkan adıyla; pencere dışında şablon dükkan adını değişkende taşır', async () => {
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, text('#DONER'));
    const order = await createAwaitingOrder(ctx, B, 'P3N4R5', { extra: { customerPhone: phone } });
    await sharedInbound(ctx, { phone }, text('Sipariş kodu: P3N4R5'));
    await ctx.db.transaction((tx) => transitionOrder(tx, { orderId: order.id, tenantId: B.tenantId, to: 'accepted', actor: { type: 'system' }, extra: { etaMinutes: 30 } }));
    await flushNotify(ctx);
    const conv = await convOf(B, phone);
    const acc = await lastOut(ctx.db, conv!.id);
    expect((acc!.payload as unknown as OutboundPayload).orderEvent).toBe('accepted');
    expect(acc!.body!.startsWith('*Çamlık Döner*\n')).toBe(true);
    // Pencere kapandı (son gelen mesaj 25 saat önce) → yolda şablonu; dükkan adı ilk değişken
    await ctx.db.update(conversations).set({ lastInboundAt: new Date(Date.now() - 25 * HOUR) }).where(eq(conversations.id, conv!.id));
    await ctx.db.transaction((tx) => transitionOrder(tx, { orderId: order.id, tenantId: B.tenantId, to: 'on_the_way', actor: { type: 'system' } }));
    await flushNotify(ctx);
    const tpl = await lastOut(ctx.db, conv!.id);
    const spec = (tpl!.payload as unknown as OutboundPayload).spec;
    expect(spec).toMatchObject({ type: 'template', name: 'siparis_yolda_v1' });
    expect(spec.type === 'template' && spec.params[0]).toBe('Çamlık Döner');
    expect(tpl!.body!.startsWith('Siparişiniz yola çıktı. Çamlık Döner kuryesi')).toBe(true);
  });

  it('panelden elle yanıt dükkan adıyla gider', async () => {
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, text('#DONER'));
    const conv = await convOf(B, phone);
    const res = await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${conv!.id}/messages`, cookie: B.ownerCookie, body: { text: 'Siparişiniz hazırlanıyor' } });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().message).toMatchObject({ body: '*Çamlık Döner*\nSiparişiniz hazırlanıyor', brand: 'Çamlık Döner', sentBy: 'user' });
  });

  it('kendi numaralı işletmenin mesajları markasız ve kendi webhook\'undan', async () => {
    const phone = nextPhone();
    await inbound(ctx, C.account, { phone, name: 'Selin' }, text('merhaba'));
    const out = await lastOut(ctx.db, (await conversationFor(ctx.db, C.account, phone))!.id);
    expect(out!.body!.startsWith('Merhaba Selin, Kendi Numaralı Lokanta')).toBe(true);
    expect((out!.payload as unknown as OutboundPayload).brand).toBeUndefined();
    expect((out!.payload as unknown as OutboundPayload).spec).not.toHaveProperty('interactive.header');
    expect(await findSharedRoute(ctx.db, { phone })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('dükkandan başlayan mesaj (ör. telefon siparişi şablonu)', () => {
  it('etkin dükkanı olmayan kişiye giden dükkan mesajı yanıtı o dükkana yönlendirir; etkin oturum bozulmaz', async () => {
    const tplFor = (name: string) => ({ type: 'template' as const, name: 'siparis_alindi_v1', params: ['Telefon Müşteri', name, '#1001', '100,00 TL'] });
    const phone = nextPhone();
    const [cust] = await ctx.db.insert(customers).values({ tenantId: E.tenantId, phoneE164: phone, name: 'Telefon Müşteri' }).returning();
    const conv = await ctx.db.transaction((tx) => upsertConversation(tx, E.account, cust!.id));
    await ctx.db.transaction((tx) =>
      queueOutbound(tx, { tenantId: E.tenantId, branchId: E.branchId, conversationId: conv.id, spec: tplFor('Yozgat Pide Evi'), code: 'siparis_alindi_v1', sentBy: 'bot' }),
    );
    await flushOutbound(ctx);
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: E.tenantId, recentTenantIds: [E.tenantId] });
    await sharedInbound(ctx, { phone }, text('Teşekkürler'));
    expect((await threadRows(ctx.db, conv.id)).filter((m) => m.direction === 'in').map((m) => m.body)).toEqual(['Teşekkürler']);
    expect(await platformRows(phone)).toHaveLength(0);

    const phone2 = nextPhone();
    await sharedInbound(ctx, { phone: phone2 }, text('#BOZOK'));
    const [c2] = await ctx.db.insert(customers).values({ tenantId: E.tenantId, phoneE164: phone2, name: 'Telefon Müşteri' }).returning();
    const conv2 = await ctx.db.transaction((tx) => upsertConversation(tx, E.account, c2!.id));
    await ctx.db.transaction((tx) =>
      queueOutbound(tx, { tenantId: E.tenantId, branchId: E.branchId, conversationId: conv2.id, spec: tplFor('Yozgat Pide Evi'), code: 'siparis_alindi_v1', sentBy: 'bot' }),
    );
    await flushOutbound(ctx);
    expect(await findSharedRoute(ctx.db, { phone: phone2 })).toMatchObject({ currentTenantId: A.tenantId, recentTenantIds: [A.tenantId, E.tenantId] });
  });
});

// ---------------------------------------------------------------------------
describe('tenant yalıtımı', () => {
  it('iki dükkanla konuşan müşteri: her dükkan yalnız kendi sohbetini, mesajını ve müşterisini görür', async () => {
    const phone = nextPhone();
    await sharedInbound(ctx, { phone, name: 'Ortak Müşteri' }, text('#BOZOK'));
    await sharedInbound(ctx, { phone }, text('Bozok için not'));
    await sharedInbound(ctx, { phone }, text('#DONER'));
    await sharedInbound(ctx, { phone }, text('Döner için not'));
    const aConv = await convOf(A, phone);
    const bConv = await convOf(B, phone);
    expect(aConv!.tenantId).toBe(A.tenantId);
    expect(bConv!.tenantId).toBe(B.tenantId);
    const aBodies = (await threadRows(ctx.db, aConv!.id)).map((m) => m.body ?? '');
    expect(aBodies).toContain('Bozok için not');
    expect(aBodies.some((b) => b.includes('Döner için not') || b.includes('Çamlık Döner'))).toBe(false);
    // Müşteri kaydı her işletmede ayrı
    const [aCust] = await ctx.db.select().from(customers).where(and(eq(customers.tenantId, A.tenantId), eq(customers.phoneE164, phone)));
    const [bCust] = await ctx.db.select().from(customers).where(and(eq(customers.tenantId, B.tenantId), eq(customers.phoneE164, phone)));
    expect(aCust!.id).not.toBe(bCust!.id);
    // Panel: A sahibinin listeleri yalnız A'nın kayıtları; B'nin sohbetine erişim 404
    const convs = (await ctx.request({ method: 'GET', url: '/api/v1/panel/conversations', cookie: A.ownerCookie })).json() as { items: { id: string }[] };
    expect(convs.items.some((c) => c.id === aConv!.id)).toBe(true);
    expect(convs.items.some((c) => c.id === bConv!.id)).toBe(false);
    const other = await ctx.request({ method: 'GET', url: `/api/v1/panel/conversations/${bConv!.id}/messages`, cookie: A.ownerCookie });
    expect(other.statusCode).toBe(404);
    const custs = (await ctx.request({ method: 'GET', url: '/api/v1/panel/customers', cookie: A.ownerCookie })).json() as { items: { id: string }[] };
    expect(custs.items.some((c) => c.id === aCust!.id)).toBe(true);
    expect(custs.items.some((c) => c.id === bCust!.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('sayfalama (10\'dan fazla dükkan)', () => {
  it('ilk sayfa 9 dükkan + "Diğer dükkanlar"; son sayfadan başa dönülür; her mesajda en çok 10 satır', async () => {
    for (let i = 1; i <= 9; i++) await setupSharedTenant(ctx, { name: `Test Lokantası ${String.fromCharCode(64 + i)}`, code: `TESTLOK${String.fromCharCode(64 + i)}` });
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, text('iyi günler'));
    const p1 = await lastPlatform(phone);
    const rows1 = listRows(p1);
    expect(rows1).toHaveLength(10);
    expect(rows1.slice(0, 9).every((r) => r.id.startsWith('shop:'))).toBe(true);
    expect(rows1[9]).toMatchObject({ id: 'shops:page:2', title: 'Diğer dükkanlar', description: 'Sayfa 2/2' });
    expect(specOf(p1).interactive.body).toContain('(Sayfa 1/2)');
    await sharedInbound(ctx, { phone }, list('shops:page:2'));
    const rows2 = listRows(await lastPlatform(phone));
    expect(rows2).toHaveLength(4);
    expect(rows2.at(-1)).toMatchObject({ id: 'shops:page:1', title: 'Listenin başı' });
    const all = [...rows1.slice(0, 9), ...rows2.slice(0, 3)].map((r) => r.id);
    expect(new Set(all).size).toBe(12);
    // Seçim listeden: ikinci sayfadaki dükkan
    const pick = rows2[0]!.id;
    await sharedInbound(ctx, { phone }, list(pick));
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: pick.slice(5) });
  });
});
