// Ortak numara yönlendiricisinin kenar durumları (bağımsız inceleme bulguları; 14 §8.1):
// - "#1047" gibi harfsiz belirteç sipariş numarasıdır, dükkan kodu değil (kod en az bir harf içerir; DB kısıtı)
// - "DUR"/"BAŞLAT" alıntılanan dükkana, alıntı yoksa kişiye en son yazan dükkana gider; güncel dükkan değişmez
// - etkin güncel dükkanın #KOD'u yeni seçim sayılmaz ("yetkili", iptal, soğumalar); seçimde de "yetkili"/iptal işlenir
// - request_welcome sessizdir (QR'ın ön-dolu #KOD mesajı dükkanı seçer)
// - platforma giden mesajın tekrar teslimi sonradan seçilen dükkana gitmez
// - son dükkan butonlarının başlıkları tekildir; ad eşleşmesi listesinin sonraki sayfası yine eşleşenlerden oluşur

import { sharedPrefillText } from '@siparis/core';
import { messages, sharedWaMessages, tenants } from '@siparis/db';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildInboundPayload } from '../src/services/messaging/dev-payload';
import { processWebhookEvent } from '../src/services/messaging/ingest';
import { queueOutbound } from '../src/services/messaging/outbound';
import { findSharedRoute, ingestSharedWebhookPayload, recentShopsSpec } from '../src/services/messaging/shared-router';
import type { SharedShop } from '../src/services/messaging/shared';
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

type ListSpec = { interactive: { kind: string; body: string; buttons?: { id: string; title: string }[]; list?: { sections: { rows: { id: string; title: string }[] }[] } } };
async function platformRows(phone: string, direction: 'in' | 'out' = 'out') {
  const route = await findSharedRoute(ctx.db, { phone });
  if (!route) return [];
  return ctx.db
    .select()
    .from(sharedWaMessages)
    .where(and(eq(sharedWaMessages.routeId, route.id), eq(sharedWaMessages.direction, direction)))
    .orderBy(asc(sharedWaMessages.createdAt));
}
const specOf = (m: { payload: unknown } | undefined) => (m!.payload as { spec: ListSpec }).spec;
const listRows = (m: { payload: unknown } | undefined) => specOf(m).interactive.list!.sections.flatMap((s) => s.rows);

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
    expect((await platformRows(lonely)).map((m) => (m.payload as { code?: string }).code)).toEqual(['P02']);
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

  it('aynı dükkanın QR\'ını tekrar okutmak soğumalara uyar (30 dk içinde sessiz, sonra kısa karşılama)', async () => {
    const phone = nextPhone();
    const t0 = new Date();
    const qr = text(sharedPrefillText('Bozok Pide Salonu', 'BOZOK'));
    await sharedInbound(ctx, { phone }, qr, { now: t0 });
    const conv = (await convOf(A, phone))!;
    await sharedInbound(ctx, { phone }, qr, { now: plus(t0, 5 * MIN) });
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01']);
    await sharedInbound(ctx, { phone }, qr, { now: plus(t0, 2 * HOUR) });
    expect(await outCodes(ctx.db, conv.id)).toEqual(['M01', 'M01K']);
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

  it('request_welcome sessiz kalır (seçici gitmez); ardından gelen QR mesajı dükkanı seçer', async () => {
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
    await sharedInbound(ctx, { phone }, list(`shop:${A.tenantId}`), { now: plus(t0, MIN) });
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
describe('seçici mesajlarının biçimi', () => {
  const shop = (id: string, name: string, code: string | null): SharedShop => ({
    tenantId: id,
    name,
    slug: id,
    code,
    accountId: id,
    branchId: id,
    neighborhood: null,
    district: 'Merkez',
    city: 'Yozgat',
  });

  it('kırpılınca aynılaşan dükkan adları tekil buton başlıklarıyla gider (≤ 20 karakter)', () => {
    const cases: [SharedShop, SharedShop][] = [
      [shop('a', 'Yozgat Pide Salonu Merkez', 'YPSM'), shop('b', 'Yozgat Pide Salonu Çamlık', 'YPSC')],
      [shop('a', 'Yozgat Pide Salonu Merkez', null), shop('b', 'Yozgat Pide Salonu Çamlık', null)],
      [shop('a', 'Diğer dükkanlar', 'DIGER'), shop('b', 'Kebapçı', 'KEBAPCI')],
    ];
    for (const [x, y] of cases) {
      const spec = recentShopsSpec([x, y], true) as ListSpec & { interactive: Parameters<typeof interactiveBody>[1] };
      const body = interactiveBody({ phone: '+905551112233' }, spec.interactive) as unknown as { interactive: { action: { buttons: { reply: { title: string } }[] } } };
      const titles = body.interactive.action.buttons.map((b) => b.reply.title);
      expect(titles).toHaveLength(3);
      expect(new Set(titles.map((t) => t.toLocaleLowerCase('tr-TR'))).size).toBe(3);
      for (const t of titles) expect(t.length).toBeLessThanOrEqual(20);
    }
    // Çakışma yoksa ad olduğu gibi
    const plain = recentShopsSpec([shop('a', 'Bozok Pide Salonu', 'BOZOK'), shop('b', 'Çamlık Döner', 'DONER')], false) as ListSpec;
    expect(plain.interactive.buttons!.map((b) => b.title)).toEqual(['Bozok Pide Salonu', 'Çamlık Döner']);
  });

  it('son dükkan seçicisi (P01) uzun ve benzer adlı iki dükkanı ayrı başlıklarla sunar', async () => {
    const M = await setupSharedTenant(ctx, { name: 'Yozgat Pide Salonu Merkez', code: 'YPSMERKEZ' });
    const C = await setupSharedTenant(ctx, { name: 'Yozgat Pide Salonu Çamlık', code: 'YPSCAMLIK' });
    const phone = nextPhone();
    const t0 = new Date();
    await sharedInbound(ctx, { phone }, text('#YPSMERKEZ'), { now: t0 });
    await sharedInbound(ctx, { phone }, text('#YPSCAMLIK'), { now: plus(t0, MIN) });
    await sharedInbound(ctx, { phone }, text('iyi akşamlar'), { now: plus(t0, 25 * HOUR) });
    const p = (await platformRows(phone)).at(-1);
    const buttons = specOf(p).interactive.buttons!;
    expect(buttons.map((b) => b.id)).toEqual([`shop:${C.tenantId}`, `shop:${M.tenantId}`, 'shops:list']);
    expect(new Set(buttons.map((b) => b.title)).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Son: çok sayıda dükkan ekler (önceki testlerin listelerini etkilemesin)
describe('ad eşleşmesi listesi 10\'dan fazla dükkana uyarsa', () => {
  it('sonraki sayfa yine yalnız eşleşen dükkanlar; başka kişinin liste kimliği tüm listeye düşer', async () => {
    const lahm: WaSetup[] = [];
    for (let i = 0; i < 11; i++) {
      const ch = String.fromCharCode(65 + i);
      lahm.push(await setupSharedTenant(ctx, { name: `Lahmacuncu ${ch} Usta`, code: `LAHM${ch}X` }));
    }
    for (let i = 0; i < 4; i++) await setupSharedTenant(ctx, { name: `Tatlıcı ${String.fromCharCode(65 + i)}`, code: `TATLI${String.fromCharCode(65 + i)}X` });
    const phone = nextPhone();
    const t0 = new Date();
    await sharedInbound(ctx, { phone }, text('lahmacuncu'), { now: t0 });
    const first = (await platformRows(phone)).at(-1);
    const rows1 = listRows(first);
    expect(rows1).toHaveLength(10);
    expect(rows1.slice(0, 9).every((r) => r.title.startsWith('Lahmacuncu'))).toBe(true);
    const next = rows1[9]!;
    expect(next.id).toBe(`shops:m:${first!.id}:2`);

    await sharedInbound(ctx, { phone }, list(next.id), { now: plus(t0, MIN) });
    const rows2 = listRows((await platformRows(phone)).at(-1));
    expect(rows2.map((r) => r.title)).toEqual(['Lahmacuncu J Usta', 'Lahmacuncu K Usta', 'Listenin başı']);
    expect(rows2.at(-1)!.id).toBe(`shops:m:${first!.id}:1`);
    const all = [...rows1.slice(0, 9), ...rows2.slice(0, 2)].map((r) => r.id);
    expect(new Set(all)).toEqual(new Set(lahm.map((l) => `shop:${l.tenantId}`)));

    // Liste kimliği yalnız kendi kişisinde geçerli
    const other = nextPhone();
    await sharedInbound(ctx, { phone: other }, list(next.id), { now: plus(t0, MIN) });
    const otherRows = listRows((await platformRows(other)).at(-1));
    expect(otherRows.some((r) => r.title.startsWith('Tatlıcı') || r.title === 'Bozok Pide Salonu')).toBe(true);

    await sharedInbound(ctx, { phone }, list(rows2[1]!.id), { now: plus(t0, 2 * MIN) });
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: lahm[10]!.tenantId });
  });
});
