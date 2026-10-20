// Ortak numara yönlendiricisinin kenar durumları (bağımsız inceleme bulguları; 14 §8.1):
// - "#1047" gibi harfsiz belirteç sipariş numarasıdır, dükkan kodu değil (kod en az bir harf içerir; DB kısıtı)
// - "DUR"/"BAŞLAT" alıntılanan dükkana, alıntı yoksa kişiye en son yazan dükkana gider; güncel dükkan değişmez
// - etkin güncel dükkanın #KOD'u yeni seçim sayılmaz ("yetkili", iptal, soğumalar); seçimde de "yetkili"/iptal işlenir
// - request_welcome sessizdir (QR'ın ön-dolu #KOD mesajı dükkanı seçer)
// - platforma giden mesajın tekrar teslimi sonradan seçilen dükkana gitmez
// - dizin yok (00 §12a madde 11, O2): son dükkan düğmeleri ve ad eşleşmesi listesi yok; benzer adlı çok dükkan varken de
//   kodsuz mesaj tek nötr metin alır; eski ad eşleşmesi sayfa düğmesi liste döndürmez; P07 tek düğmelidir

import { SHARED_PLATFORM_TEXTS, sharedPrefillText } from '@siparis/core';
import { messages, sharedWaMessages, tenants } from '@siparis/db';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildInboundPayload } from '../src/services/messaging/dev-payload';
import { processWebhookEvent } from '../src/services/messaging/ingest';
import { queueOutbound } from '../src/services/messaging/outbound';
import { findSharedRoute, ingestSharedWebhookPayload, shopContinueReply } from '../src/services/messaging/shared-router';
import { interactiveBody } from '../src/wa/cloud-body';
import { createTestContext, type TestContext } from './helpers';
import {
  HOUR,
  MIN,
  SHARED_DEV_ACCOUNT,
  conversationFor,
  flushOutbound,
  getConversation,
  lastOut,
  outCodes,
  plus,
  setupSharedTenant,
  sharedInbound,
  silentLog,
  threadRows,
  type WaSetup,
} from './wa-helpers';

let ctx: TestContext;
let A: WaSetup; // Bozok Pide Salonu #BOZOK
let B: WaSetup; // Çamlık Döner #DONER

let seq = 3000;
const nextPhone = () => `+90538${String(1000000 + seq++).slice(-7)}`;
const text = (s: string) => ({ type: 'text' as const, text: s });
const list = (id: string) => ({ type: 'list_reply' as const, id });
const convOf = (t: WaSetup, phone: string) => conversationFor(ctx.db, t.account, phone);
const inBodies = async (t: WaSetup, phone: string) => {
  const conv = await convOf(t, phone);
  return conv ? (await threadRows(ctx.db, conv.id)).filter((m) => m.direction === 'in').map((m) => m.body) : [];
};

async function platformRows(phone: string, direction: 'in' | 'out' = 'out') {
  const route = await findSharedRoute(ctx.db, { phone });
  if (!route) return [];
  return ctx.db
    .select()
    .from(sharedWaMessages)
    .where(and(eq(sharedWaMessages.routeId, route.id), eq(sharedWaMessages.direction, direction)))
    .orderBy(asc(sharedWaMessages.createdAt));
}
const codeOf = (m: { payload: unknown } | undefined) => (m!.payload as { code?: string }).code;

/** Dükkan personelinin elle mesajı (ortak numaradan gider; wamid gönderimde yazılır). */
async function staffMessage(t: WaSetup, phone: string, body: string) {
  const conv = (await convOf(t, phone))!;
  await ctx.db.transaction((tx) =>
    queueOutbound(tx, { tenantId: t.tenantId, branchId: t.branchId, conversationId: conv.id, spec: { type: 'text', text: body }, sentBy: 'user', sentByUserId: t.owner.id }),
  );
  await flushOutbound(ctx);
  return (await lastOut(ctx.db, conv.id))!;
}

beforeAll(async () => {
  ctx = await createTestContext();
  A = await setupSharedTenant(ctx, { name: 'Bozok Pide Salonu', code: 'BOZOK' });
  B = await setupSharedTenant(ctx, { name: 'Çamlık Döner', code: 'DONER' });
});
afterAll(async () => {
  await ctx.close();
});

// ---------------------------------------------------------------------------
describe('sipariş numarası "#1047" dükkan kodu değildir', () => {
  it('yalnız rakamdan oluşan kod veritabanında reddedilir', async () => {
    await expect(ctx.db.update(tenants).set({ waCode: '1453' }).where(eq(tenants.id, B.tenantId))).rejects.toThrow();
    const [b] = await ctx.db.select({ waCode: tenants.waCode }).from(tenants).where(eq(tenants.id, B.tenantId));
    expect(b!.waCode).toBe('DONER');
  });

  it('etkin dükkanla konuşan müşterinin "#1453 nolu siparişim" mesajı güncel dükkanda kalır; dükkansız yalın "1453" seçmez', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    await sharedInbound(ctx, { phone, name: 'Ali' }, text(sharedPrefillText('Bozok Pide Salonu', 'BOZOK')), { now: t0 });
    await sharedInbound(ctx, { phone }, text('#1453 nolu siparişim nerede? Adresim Cumhuriyet Mah. 5. sokak'), { now: plus(t0, MIN) });
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: A.tenantId });
    expect((await inBodies(A, phone)).at(-1)).toContain('#1453 nolu siparişim');
    expect(await convOf(B, phone)).toBeUndefined();

    const lonely = nextPhone();
    await sharedInbound(ctx, { phone: lonely }, text('1453'));
    expect(await findSharedRoute(ctx.db, { phone: lonely })).toMatchObject({ currentTenantId: null });
    expect((await platformRows(lonely)).map(codeOf)).toEqual(['P09']);
  });
});

// ---------------------------------------------------------------------------
describe('DUR / BAŞLAT hangi dükkana', () => {
  it('başka dükkanın mesajını alıntılayan "DUR" o dükkana gider (son yazan başka dükkan olsa da); güncel dükkan değişmez', async () => {
    const phone = nextPhone();
    const t0 = new Date(Date.now() - 10 * MIN);
    await sharedInbound(ctx, { phone, name: 'Ayşe' }, text(sharedPrefillText('Çamlık Döner', 'DONER')), { now: t0 });
    await sharedInbound(ctx, { phone }, text(sharedPrefillText('Bozok Pide Salonu', 'BOZOK')), { now: plus(t0, MIN) });
    await flushOutbound(ctx);
    const bMsg = await staffMessage(B, phone, 'Siparişiniz için teşekkür ederiz.');
    await staffMessage(A, phone, 'Pideniz fırında.');
    expect(bMsg.wamid).toBeTruthy();
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: A.tenantId });

    await sharedInbound(ctx, { phone }, text('DUR'), { contextWamid: bMsg.wamid! });
    expect((await outCodes(ctx.db, (await convOf(B, phone))!.id)).at(-1)).toBe('M31');
    expect(await outCodes(ctx.db, (await convOf(A, phone))!.id)).not.toContain('M31');
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: A.tenantId });
  });

  it('alıntısız "DUR" kişiye en son yazan dükkana gider; kodsuz sonraki mesaj yine güncel dükkana', async () => {
    const phone = nextPhone();
    const t0 = new Date(Date.now() - 10 * MIN);
    await sharedInbound(ctx, { phone }, text('#DONER'), { now: t0 });
    await sharedInbound(ctx, { phone }, text('#BOZOK'), { now: plus(t0, MIN) });
    await flushOutbound(ctx);
    await staffMessage(B, phone, 'Yeni menümüz hazır.');

    await sharedInbound(ctx, { phone }, text('DUR'));
    expect((await outCodes(ctx.db, (await convOf(B, phone))!.id)).at(-1)).toBe('M31');
    expect(await outCodes(ctx.db, (await convOf(A, phone))!.id)).not.toContain('M31');
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: A.tenantId });

    await sharedInbound(ctx, { phone }, text('2 kuşbaşılı pide'));
    expect((await inBodies(A, phone)).at(-1)).toBe('2 kuşbaşılı pide');
    expect(await inBodies(B, phone)).not.toContain('2 kuşbaşılı pide');
  });
});

// ---------------------------------------------------------------------------
describe('#KOD ve dükkan seçimi', () => {
  it('etkin güncel dükkanın #KOD\'u ile "yetkili" isteği insana devreder; ikinci karşılama gitmez', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    await sharedInbound(ctx, { phone, name: 'Ali' }, text(sharedPrefillText('Bozok Pide Salonu', 'BOZOK')), { now: t0 });
    const conv = (await convOf(A, phone))!;
    await sharedInbound(ctx, { phone }, text('Sipariş no 1001 hakkında #BOZOK yetkili ile görüşmek istiyorum'), { now: plus(t0, 10 * MIN) });
    const codes = await outCodes(ctx.db, conv.id);
    expect(codes.filter((c) => c === 'M01')).toHaveLength(1);
    expect(codes).toContain('M20');
    expect((await getConversation(ctx.db, conv.id)).mode).toBe('human');
  });

  it('aynı dükkanın QR\'ını tekrar okutmak yanıtsız kalmaz: 60 sn çift gönderim koruması, sonra kısa karşılama (14 §9.x)', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    const qr = text(sharedPrefillText('Bozok Pide Salonu', 'BOZOK'));
    await sharedInbound(ctx, { phone }, qr, { now: t0 });
    const conv = (await convOf(A, phone))!;
    await sharedInbound(ctx, { phone }, qr, { now: plus(t0, 20_000) });
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01']);
    await sharedInbound(ctx, { phone }, qr, { now: plus(t0, 5 * MIN) });
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01', 'M01K']);
    await sharedInbound(ctx, { phone }, qr, { now: plus(t0, 2 * HOUR) });
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01', 'M01K', 'M01K']);
    // Kodla birlikte SSS sorusu: olağan sıra (SSS yanıtı), kısa karşılama değil
    await sharedInbound(ctx, { phone }, text('#BOZOK minimum sepet ne kadar'), { now: plus(t0, 3 * HOUR) });
    expect((await outCodes(ctx.db, conv.id)).at(-1)).toBe('M28c');
  });

  it('dükkan seçen mesajda da (24 saat sonra #KOD) "yetkili" devreder, iptal isteği iptal akışına gider', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    await sharedInbound(ctx, { phone }, text('#BOZOK'), { now: t0 });
    await sharedInbound(ctx, { phone }, text('#BOZOK yetkili ile görüşmek istiyorum'), { now: plus(t0, 25 * HOUR) });
    const conv = (await convOf(A, phone))!;
    expect((await getConversation(ctx.db, conv.id)).mode).toBe('human');

    const phone2 = nextPhone();
    await sharedInbound(ctx, { phone: phone2 }, text('#BOZOK'), { now: t0 });
    const conv2 = (await convOf(A, phone2))!;
    await ctx.createOrder({ tenantId: A.tenantId, branchId: A.branchId, status: 'new', extra: { customerId: conv2.customerId } });
    await sharedInbound(ctx, { phone: phone2 }, text('#BOZOK siparişimi iptal etmek istiyorum lütfen'), { now: plus(t0, 25 * HOUR) });
    expect((await outCodes(ctx.db, conv2.id)).at(-1)).toBe('M27a');
  });

  it('request_welcome sessiz kalır (nötr yanıt gitmez); ardından gelen QR mesajı dükkanı seçer', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    await sharedInbound(ctx, { phone, name: 'Veli' }, { type: 'request_welcome' }, { now: t0 });
    expect(await platformRows(phone)).toHaveLength(0);
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ lastPickerAt: null, currentTenantId: null });
    await sharedInbound(ctx, { phone }, text(sharedPrefillText('Çamlık Döner', 'DONER')), { now: plus(t0, 2_000) });
    expect(await outCodes(ctx.db, (await convOf(B, phone))!.id)).toEqual(['M01']);
    expect(await platformRows(phone)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('tekrar teslim', () => {
  it('platforma giden kodsuz mesaj, müşteri sonradan dükkan seçse de tekrar teslimde dükkana işlenmez', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    const wamid = `wamid.edge.redeliver.${Date.now()}`;
    await sharedInbound(ctx, { phone }, text('Merhaba'), { now: t0, wamid });
    await sharedInbound(ctx, { phone }, text('#BOZOK'), { now: plus(t0, MIN) });
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: A.tenantId });

    const { payload } = buildInboundPayload(SHARED_DEV_ACCOUNT, { phone }, text('Merhaba'), { at: t0, wamid });
    const { webhookEventId } = await ingestSharedWebhookPayload(ctx.db, payload);
    const summary = await processWebhookEvent({ db: ctx.db, config: ctx.config, log: silentLog }, webhookEventId, { now: plus(t0, 2 * MIN) });
    expect(summary).toMatchObject({ messages: 0, duplicates: 1 });
    expect(await ctx.db.select({ id: messages.id }).from(messages).where(eq(messages.wamid, wamid))).toHaveLength(0);
    expect(await ctx.db.select({ id: sharedWaMessages.id }).from(sharedWaMessages).where(eq(sharedWaMessages.wamid, wamid))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('dizin yok: son dükkan düğmeleri, ad eşleşmesi listesi', () => {
  it('benzer adlı iki dükkanla konuşmuş kişi 24 saat sonra son dükkanlar düğmesi değil nötr yanıt alır (adlar yazılmaz)', async () => {
    await setupSharedTenant(ctx, { name: 'Yozgat Pide Salonu Merkez', code: 'YPSMERKEZ' });
    await setupSharedTenant(ctx, { name: 'Yozgat Pide Salonu Çamlık', code: 'YPSCAMLIK' });
    const phone = nextPhone();
    const t0 = new Date();
    await sharedInbound(ctx, { phone }, text('#YPSMERKEZ'), { now: t0 });
    await sharedInbound(ctx, { phone }, text('#YPSCAMLIK'), { now: plus(t0, MIN) });
    await sharedInbound(ctx, { phone }, text('iyi akşamlar'), { now: plus(t0, 25 * HOUR) });
    const rows = await platformRows(phone);
    expect(rows.map(codeOf)).toEqual(['P09']);
    expect(rows[0]!.body).toBe(SHARED_PLATFORM_TEXTS.neutral);
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/Yozgat Pide|shop:|shops:/);
  });

  it('P07 (dükkan motoru yanıt üretmedi): yalnız güncel dükkana devam düğmesi, "Diğer dükkanlar" yok, başlık ≤ 20', async () => {
    const L = await setupSharedTenant(ctx, { name: 'Yozgat Kuzu Tandır ve Pide Fırını', code: 'KUZUTANDIR' });
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, text('#KUZUTANDIR'));
    const route = (await findSharedRoute(ctx.db, { phone }))!;
    const reply = await shopContinueReply(ctx.db, route, 'Yozgat Kuzu Tandır ve Pide Fırını');
    expect(reply.code).toBe('P07');
    const spec = reply.spec as { type: 'interactive'; interactive: Parameters<typeof interactiveBody>[1] };
    const body = interactiveBody({ phone: '+905551112233' }, spec.interactive) as unknown as {
      interactive: { body: { text: string }; action: { buttons: { reply: { id: string; title: string } }[] } };
    };
    const buttons = body.interactive.action.buttons.map((b) => b.reply);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.id).toBe(`shop:${L.tenantId}`);
    expect(buttons[0]!.title.length).toBeLessThanOrEqual(20);
    expect(body.interactive.body.text).toBe('Mesajınızı *Yozgat Kuzu Tandır ve Pide Fırını* sohbetine ilettik.\nMenüyü açmak için aşağıdaki düğmeye dokunabilirsiniz.');
    // Dükkan artık seçilemiyor (sipariş kapalı): düğmesiz yalın metin
    await ctx.db.update(tenants).set({ orderingEnabled: false }).where(eq(tenants.id, L.tenantId));
    expect((await shopContinueReply(ctx.db, route, 'Yozgat Kuzu Tandır ve Pide Fırını')).spec).toEqual({
      type: 'text',
      text: 'Mesajınızı *Yozgat Kuzu Tandır ve Pide Fırını* sohbetine ilettik.',
    });
  });
});

// ---------------------------------------------------------------------------
// Son: çok sayıda dükkan ekler (önceki testleri etkilemesin)
describe('ad eşleşmesi 10\'dan fazla dükkana uysa da liste yok', () => {
  it('"lahmacuncu" yazan kişi nötr yanıt alır; eski ad eşleşmesi sayfa düğmesi de liste döndürmez; hiçbir dükkan seçilmez', async () => {
    const lahm: WaSetup[] = [];
    for (let i = 0; i < 11; i++) {
      const ch = String.fromCharCode(65 + i);
      lahm.push(await setupSharedTenant(ctx, { name: `Lahmacuncu ${ch} Usta`, code: `LAHM${ch}X` }));
    }
    const phone = nextPhone();
    const t0 = new Date();
    await sharedInbound(ctx, { phone }, text('lahmacuncu'), { now: t0 });
    const first = (await platformRows(phone)).at(-1);
    expect(codeOf(first)).toBe('P09');
    // Eski (O2 öncesi) ad eşleşmesi listesinin sayfa düğmesi ve satırı
    await sharedInbound(ctx, { phone }, list(`shops:m:${first!.id}:2`), { now: plus(t0, 2 * MIN) });
    await sharedInbound(ctx, { phone }, list(`shop:${lahm[10]!.tenantId}`), { now: plus(t0, 4 * MIN) });
    const rows = await platformRows(phone);
    expect(rows.map(codeOf)).toEqual(['P09', 'P09', 'P09']);
    for (const r of rows) {
      expect(r.kind).toBe('text');
      expect(`${r.body}${JSON.stringify(r.payload)}`).not.toMatch(/Lahmacuncu|shops:|shop:/);
    }
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: null, recentTenantIds: [] });
    for (const l of lahm) expect(await convOf(l, phone)).toBeUndefined();
  });
});
