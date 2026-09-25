// Panel sohbet uçları: liste, mesajlar (cursor), yanıt (24 sa penceresi), mod, okundu; roller ve tenant yalıtımı.

import { conversations } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, expectError, expectIsolated, type TestContext } from './helpers';
import { HOUR, conversationFor, flushOutbound, getConversation, inbound, setupWaTenant, threadRows, type WaSetup } from './wa-helpers';

let ctx: TestContext;
let t: WaSetup;
let other: WaSetup;
let convId: string;
const PHONE = '+905351234567';

beforeAll(async () => {
  ctx = await createTestContext();
  t = await setupWaTenant(ctx, { name: 'Sohbet Pide' });
  other = await setupWaTenant(ctx, { name: 'Başka İşletme' });
  await inbound(ctx, t.account, { phone: PHONE, name: 'Zeynep Kaya' }, { type: 'text', text: 'merhaba' });
  await inbound(ctx, t.account, { phone: PHONE }, { type: 'text', text: 'paket servisiniz var mı' });
  await flushOutbound(ctx);
  convId = (await conversationFor(ctx.db, t.account, PHONE))!.id;
  await inbound(ctx, other.account, { phone: '+905359999999' }, { type: 'text', text: 'selam' });
});
afterAll(async () => {
  await ctx.close();
});

describe('GET /panel/conversations', () => {
  it('liste: müşteri adı, maskeli telefon, okunmamış, mod, pencere', async () => {
    const res = await ctx.request({ method: 'GET', url: '/api/v1/panel/conversations', cookie: t.ownerCookie });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { items: Array<Record<string, unknown> & { customer: Record<string, unknown> }> };
    expect(body.items).toHaveLength(1);
    const c = body.items[0]!;
    expect(c).toMatchObject({ id: convId, mode: 'bot', unreadCount: 2, windowOpen: true, optedOut: false });
    expect(c.customer).toMatchObject({ name: 'Zeynep Kaya', phoneMasked: '0*** *** 45 67' });
    expect(JSON.stringify(body)).not.toContain('5351234567');
    expect(typeof c.lastMessagePreview).toBe('string');
  });

  it('arama ve filtre', async () => {
    const hit = await ctx.request({ method: 'GET', url: '/api/v1/panel/conversations?q=zeynep', cookie: t.ownerCookie });
    expect((hit.json() as { items: unknown[] }).items).toHaveLength(1);
    const miss = await ctx.request({ method: 'GET', url: '/api/v1/panel/conversations?q=yokboyle', cookie: t.ownerCookie });
    expect((miss.json() as { items: unknown[] }).items).toHaveLength(0);
    const human = await ctx.request({ method: 'GET', url: '/api/v1/panel/conversations?filter=human', cookie: t.ownerCookie });
    expect((human.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('roller: kasiyer görür, mutfak ve kurye 403', async () => {
    const cashier = await ctx.createStaff(t.tenantId, 'cashier');
    expect((await ctx.request({ method: 'GET', url: '/api/v1/panel/conversations', cookie: cashier.cookie })).statusCode).toBe(200);
    const kitchen = await ctx.createStaff(t.tenantId, 'kitchen');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/panel/conversations', cookie: kitchen.cookie }), 403, 'forbidden');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/panel/conversations' }), 401, 'unauthorized');
  });
});

describe('mesajlar ve yanıt', () => {
  it('mesajlar yeniden eskiye, cursor ile sayfalama', async () => {
    const first = await ctx.request({ method: 'GET', url: `/api/v1/panel/conversations/${convId}/messages?limit=2`, cookie: t.ownerCookie });
    expect(first.statusCode, first.body).toBe(200);
    const page1 = first.json() as { items: Array<{ id: string; direction: string; createdAt: string; cta?: { label: string } }>; nextCursor?: string };
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const second = await ctx.request({ method: 'GET', url: `/api/v1/panel/conversations/${convId}/messages?limit=2&cursor=${page1.nextCursor}`, cookie: t.ownerCookie });
    const page2 = second.json() as { items: Array<{ id: string; direction: string; cta?: { label: string } }> };
    const all = [...page1.items, ...page2.items];
    expect(new Set(all.map((m) => m.id)).size).toBe(all.length);
    const welcome = all.find((m) => m.direction === 'out');
    expect(welcome?.cta?.label).toBe('Menüyü aç');
  });

  it('yanıt gönder → 201, sent_by user, kuyruğa alınır; bot 30 dk susar; okunmamış sıfırlanır', async () => {
    const res = await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${convId}/messages`, cookie: t.ownerCookie, body: { text: 'Evet, paket servisimiz var.' } });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { message: { direction: string; sentBy: string; status: string; body: string; sentByName: string }; conversation: { mode: string; unreadCount: number; humanActive: boolean } };
    expect(body.message).toMatchObject({ direction: 'out', sentBy: 'user', status: 'queued', body: 'Evet, paket servisimiz var.', sentByName: 'Test Sahip' });
    expect(body.conversation).toMatchObject({ mode: 'human', unreadCount: 0, humanActive: true });
    await flushOutbound(ctx);
    const rows = await threadRows(ctx.db, convId);
    expect(rows.find((r) => r.body === 'Evet, paket servisimiz var.')!.status).toBe('sent');
  });

  it('boş metin 400; 24 sa penceresi kapalıysa 409 window_closed', async () => {
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${convId}/messages`, cookie: t.ownerCookie, body: { text: '   ' } }), 400, 'bad_request');
    await ctx.db.update(conversations).set({ lastInboundAt: new Date(Date.now() - 25 * HOUR) }).where(eq(conversations.id, convId));
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${convId}/messages`, cookie: t.ownerCookie, body: { text: 'Merhaba' } }), 409, 'window_closed');
    await ctx.db.update(conversations).set({ lastInboundAt: new Date() }).where(eq(conversations.id, convId));
  });

  it('mod: human (süresiz) / bot', async () => {
    const human = await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${convId}/mode`, cookie: t.ownerCookie, body: { mode: 'human' } });
    expect(human.statusCode, human.body).toBe(200);
    expect(human.json()).toMatchObject({ mode: 'human', humanUntil: null, humanActive: true });
    const bot = await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${convId}/mode`, cookie: t.ownerCookie, body: { mode: 'bot' } });
    expect(bot.json()).toMatchObject({ mode: 'bot', humanActive: false });
  });

  it('okundu → unread 0', async () => {
    await inbound(ctx, t.account, { phone: PHONE }, { type: 'text', text: 'tamam' });
    expect((await getConversation(ctx.db, convId)).unreadCount).toBe(1);
    const res = await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${convId}/read`, cookie: t.ownerCookie });
    expect(res.json()).toMatchObject({ unreadCount: 0 });
  });
});

describe('tenant yalıtımı', () => {
  it('başka tenant\'ın sohbeti 404 (liste, detay, mesajlar, yanıt, mod, okundu)', async () => {
    const list = await ctx.request({ method: 'GET', url: '/api/v1/panel/conversations', cookie: other.ownerCookie });
    expect((list.json() as { items: Array<{ id: string }> }).items.map((i) => i.id)).not.toContain(convId);
    expectIsolated(await ctx.request({ method: 'GET', url: `/api/v1/panel/conversations/${convId}`, cookie: other.ownerCookie }));
    expectIsolated(await ctx.request({ method: 'GET', url: `/api/v1/panel/conversations/${convId}/messages`, cookie: other.ownerCookie }));
    expectIsolated(await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${convId}/messages`, cookie: other.ownerCookie, body: { text: 'x' } }));
    expectIsolated(await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${convId}/mode`, cookie: other.ownerCookie, body: { mode: 'human' } }));
    expectIsolated(await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${convId}/read`, cookie: other.ownerCookie }));
    expect((await getConversation(ctx.db, convId)).mode).toBe('bot');
  });

  it('salt-okunur oturum yazamaz', async () => {
    const ro = await ctx.sessionCookie(t.owner.id, { tenantId: t.tenantId, readOnly: true });
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${convId}/mode`, cookie: ro, body: { mode: 'human' } }), 403, 'read_only_session');
  });
});

describe('KVKK silme: silinmiş müşterinin sohbeti panelde görünmez (müşteri listesiyle aynı)', () => {
  it('liste, arama, detay, mesajlar, yanıt, mod, okundu → yok/404; önizleme silinir; aynı numara yazınca yeni sohbet', async () => {
    const phone = '+905357770011';
    await inbound(ctx, t.account, { phone, name: 'Elif Demir' }, { type: 'text', text: 'Adresim Lise Cad. 12' });
    const conv = (await conversationFor(ctx.db, t.account, phone))!;
    const list = async (q = '') => {
      const res = await ctx.request({ method: 'GET', url: `/api/v1/panel/conversations${q}`, cookie: t.ownerCookie });
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as { items: Array<{ id: string }> };
    };
    expect((await list()).items.map((i) => i.id)).toContain(conv.id);
    expect((await list('?q=Elif')).items.map((i) => i.id)).toContain(conv.id);

    const erase = await ctx.request({ method: 'POST', url: `/api/v1/panel/customers/${conv.customerId}/erase`, cookie: t.ownerCookie, body: {} });
    expect(erase.statusCode, erase.body).toBe(200);

    const after = await list();
    expect(after.items.map((i) => i.id)).not.toContain(conv.id);
    expect(after.items.map((i) => i.id)).toContain(convId); // diğer sohbetler etkilenmez
    expect(JSON.stringify(after)).not.toContain('Elif');
    expect((await list('?q=Elif')).items).toHaveLength(0);
    expect((await list('?q=Lise')).items).toHaveLength(0);
    expect((await list('?q=Silinmi')).items).toHaveLength(0);
    expectError(await ctx.request({ method: 'GET', url: `/api/v1/panel/conversations/${conv.id}`, cookie: t.ownerCookie }), 404, 'not_found');
    expectError(await ctx.request({ method: 'GET', url: `/api/v1/panel/conversations/${conv.id}/messages`, cookie: t.ownerCookie }), 404, 'not_found');
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${conv.id}/messages`, cookie: t.ownerCookie, body: { text: 'x' } }), 404, 'not_found');
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${conv.id}/mode`, cookie: t.ownerCookie, body: { mode: 'human' } }), 404, 'not_found');
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${conv.id}/read`, cookie: t.ownerCookie }), 404, 'not_found');
    const row = await getConversation(ctx.db, conv.id);
    expect(row.lastMessagePreview).toBeNull();
    expect(row.unreadCount).toBe(0);
    expect((await threadRows(ctx.db, conv.id)).every((m) => m.body === null)).toBe(true);

    // Aynı numara yeniden yazar → yeni müşteri + yeni sohbet; eski içerik görünmez
    await inbound(ctx, t.account, { phone }, { type: 'text', text: 'tekrar merhaba' });
    const fresh = (await conversationFor(ctx.db, t.account, phone))!;
    expect(fresh.id).not.toBe(conv.id);
    expect(fresh.customerId).not.toBe(conv.customerId);
    expect((await list()).items.map((i) => i.id)).toContain(fresh.id);
    const msgs = await ctx.request({ method: 'GET', url: `/api/v1/panel/conversations/${fresh.id}/messages`, cookie: t.ownerCookie });
    expect(msgs.statusCode).toBe(200);
    expect(JSON.stringify(msgs.json())).not.toContain('Lise');
  });
});
