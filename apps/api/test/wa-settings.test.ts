// Panel WhatsApp ayarları: GET/PUT (owner), şifreli API anahtarı, webhook adresi, test mesajı; yetki ve yalıtım.

import { auditLog, messages, tenants, users, waAccounts } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildInboundPayload } from '../src/services/messaging/dev-payload';
import { loadVerificationChannels } from '../src/services/orders/verification';
import { setHttpFetch } from '../src/wa/index';
import { createTestContext, expectError, type TestContext, type TestTenant } from './helpers';
import { conversationFor, flushOutbound, inbound, threadRows } from './wa-helpers';

let ctx: TestContext;
let a: TestTenant;
let b: TestTenant;

beforeAll(async () => {
  ctx = await createTestContext();
  a = await ctx.createTenantWithOwner({ name: 'Ayar Pide' });
  b = await ctx.createTenantWithOwner({ name: 'Diğer Döner' });
  await ctx.db.update(users).set({ phone: '+905361112233' }).where(eq(users.id, a.owner.id));
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => setHttpFetch(null));

describe('GET/PUT /panel/whatsapp', () => {
  it('hesap yokken: bağlı değil + WhatsApp\'sız mod açıklaması', async () => {
    const res = await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp', cookie: a.ownerCookie });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { account: null; health: { level: string; message: string }; smsFallback: { active: boolean } };
    expect(body.account).toBeNull();
    expect(body.health.level).toBe('none');
    expect(body.smsFallback.active).toBe(true);
  });

  it('owner dışı 403 (manager, cashier)', async () => {
    const manager = await ctx.createStaff(a.tenantId, 'manager');
    const cashier = await ctx.createStaff(a.tenantId, 'cashier');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp', cookie: manager.cookie }), 403, 'forbidden');
    expectError(await ctx.request({ method: 'PUT', url: '/api/v1/panel/whatsapp', cookie: cashier.cookie, body: { provider: 'mock', displayPhone: '05550000001' } }), 403, 'forbidden');
    expectError(await ctx.request({ method: 'POST', url: '/api/v1/panel/whatsapp/test', cookie: manager.cookie, body: {} }), 403, 'forbidden');
  });

  it('doğrulama: cloud için phone number ID ve anahtar zorunlu; geçersiz numara', async () => {
    expectError(await ctx.request({ method: 'PUT', url: '/api/v1/panel/whatsapp', cookie: a.ownerCookie, body: { provider: 'cloud', displayPhone: '05321234567', apiKey: 'x' } }), 400, 'bad_request');
    expectError(await ctx.request({ method: 'PUT', url: '/api/v1/panel/whatsapp', cookie: a.ownerCookie, body: { provider: 'd360', displayPhone: '05321234567' } }), 400, 'bad_request');
    expectError(await ctx.request({ method: 'PUT', url: '/api/v1/panel/whatsapp', cookie: a.ownerCookie, body: { provider: 'mock', displayPhone: 'abc' } }), 400, 'bad_request');
  });

  it('360dialog kaydı: anahtar şifreli saklanır, maskeli döner, webhook adresi', async () => {
    const res = await ctx.request({
      method: 'PUT',
      url: '/api/v1/panel/whatsapp',
      cookie: a.ownerCookie,
      body: { provider: 'd360', displayPhone: '0532 123 45 67', apiKey: 'D360-SECRET-KEY-9876' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { account: Record<string, unknown>; health: { level: string } };
    expect(body.account).toMatchObject({
      provider: 'd360',
      providerLabel: '360dialog',
      displayPhone: '+905321234567',
      hasApiKey: true,
      apiKeyMasked: '••••9876',
      status: 'connected',
    });
    expect(String(body.account.webhookUrl)).toMatch(/^http:\/\/localhost:3000\/api\/v1\/webhooks\/wa\/[A-Za-z0-9_-]{20,}$/);
    expect(JSON.stringify(body)).not.toContain('D360-SECRET-KEY-9876');
    const [row] = await ctx.db.select().from(waAccounts).where(eq(waAccounts.tenantId, a.tenantId));
    expect(row!.apiKeyEnc).toMatch(/^v1:/);
    expect(row!.apiKeyEnc).not.toContain('D360-SECRET');
    // Anahtar verilmeden güncelleme mevcut anahtarı korur
    const again = await ctx.request({ method: 'PUT', url: '/api/v1/panel/whatsapp', cookie: a.ownerCookie, body: { provider: 'd360', displayPhone: '05321234567' } });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { account: { apiKeyMasked: string } }).account.apiKeyMasked).toBe('••••9876');
  });

  it('test mesajı: 360dialog (fetch sahte) → 200 + kayıt; 190 → 502 ve hesap error', async () => {
    const calls: string[] = [];
    setHttpFetch(async (url, init) => {
      calls.push(`${url} ${(init?.headers as Record<string, string>)['D360-API-KEY']}`);
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST1' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const ok = await ctx.request({ method: 'POST', url: '/api/v1/panel/whatsapp/test', cookie: a.ownerCookie, body: {} });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, wamid: 'wamid.TEST1', to: '+905361112233' });
    expect(calls[0]).toBe('https://waba-v2.360dialog.io/messages D360-SECRET-KEY-9876');
    const [m] = await ctx.db.select().from(messages).where(eq(messages.wamid, 'wamid.TEST1'));
    expect(m).toMatchObject({ direction: 'out', sentBy: 'user', status: 'sent' });

    setHttpFetch(async () => new Response(JSON.stringify({ error: { code: 190, message: 'Invalid token' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    const bad = await ctx.request({ method: 'POST', url: '/api/v1/panel/whatsapp/test', cookie: a.ownerCookie, body: { to: '0532 999 88 77' } });
    expectError(bad, 502, 'wa_send_failed');
    const health = await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp', cookie: a.ownerCookie });
    expect((health.json() as { account: { status: string }; health: { level: string } })).toMatchObject({ account: { status: 'error' }, health: { level: 'error' } });
  });

  it('mock sağlayıcıya geçiş ve test mesajı (ağ yok)', async () => {
    const res = await ctx.request({ method: 'PUT', url: '/api/v1/panel/whatsapp', cookie: a.ownerCookie, body: { provider: 'mock', displayPhone: '05550000077' } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { health: { level: string } }).health.level).toBe('ok');
    const t = await ctx.request({ method: 'POST', url: '/api/v1/panel/whatsapp/test', cookie: a.ownerCookie, body: { to: '05321112299' } });
    expect(t.statusCode, t.body).toBe(200);
    expect((t.json() as { wamid: string }).wamid).toMatch(/^mock\./);
  });

  it('yalıtım: diğer tenant kendi (boş) bağlantısını görür', async () => {
    const res = await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp', cookie: b.ownerCookie });
    expect((res.json() as { account: unknown }).account).toBeNull();
    expectError(await ctx.request({ method: 'POST', url: '/api/v1/panel/whatsapp/test', cookie: b.ownerCookie, body: {} }), 409, 'wa_not_connected');
  });
});

describe('bağlantıyı kes ve webhook adresini yenile (owner)', () => {
  let c: TestTenant;
  let d: TestTenant;
  const API = '/api/v1/panel/whatsapp';
  const CUSTOMER = '+905367770001';

  const accountOf = async (tenantId: string) => (await ctx.db.select().from(waAccounts).where(eq(waAccounts.tenantId, tenantId)))[0]!;
  const tokenOf = (url: string) => url.split('/').pop()!;
  const postWebhook = async (token: string, tenantId: string) => {
    const { payload } = buildInboundPayload(await accountOf(tenantId), { phone: '+905367770099' }, { type: 'text', text: 'webhook denemesi' });
    return ctx.app.inject({ method: 'POST', url: `/api/v1/webhooks/wa/${token}`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
  };
  const store = async (slug: string) => (await ctx.request({ method: 'GET', url: `/api/v1/store/${slug}` })).json() as { tenant: { whatsappPhone: string | null } };

  beforeAll(async () => {
    c = await ctx.createTenantWithOwner({ name: 'Kesilen Kebap' });
    d = await ctx.createTenantWithOwner({ name: 'Komşu Lahmacun' });
    for (const [t, phone, key] of [
      [c, '0532 700 00 01', 'D360-KEY-CCCC-1111'],
      [d, '0532 700 00 02', 'D360-KEY-DDDD-2222'],
    ] as const) {
      const res = await ctx.request({ method: 'PUT', url: API, cookie: t.ownerCookie, body: { provider: 'd360', displayPhone: phone, phoneNumberId: `pn-${t.tenantId.slice(0, 8)}`, apiKey: key } });
      expect(res.statusCode, res.body).toBe(200);
    }
  });

  it('yetki: manager, cashier 403; oturumsuz 401; salt-okunur 403; hesap yokken 409', async () => {
    const manager = await ctx.createStaff(c.tenantId, 'manager');
    const cashier = await ctx.createStaff(c.tenantId, 'cashier');
    for (const path of ['disconnect', 'rotate-webhook-token']) {
      expectError(await ctx.request({ method: 'POST', url: `${API}/${path}`, cookie: manager.cookie, body: {} }), 403, 'forbidden');
      expectError(await ctx.request({ method: 'POST', url: `${API}/${path}`, cookie: cashier.cookie, body: {} }), 403, 'forbidden');
      expectError(await ctx.request({ method: 'POST', url: `${API}/${path}`, body: {} }), 401, 'unauthorized');
      const ro = await ctx.sessionCookie(c.owner.id, { tenantId: c.tenantId, readOnly: true });
      expectError(await ctx.request({ method: 'POST', url: `${API}/${path}`, cookie: ro, body: {} }), 403, 'read_only_session');
      expectError(await ctx.request({ method: 'POST', url: `${API}/${path}`, cookie: b.ownerCookie, body: {} }), 409, 'wa_not_connected');
    }
    const acc = await accountOf(c.tenantId);
    expect(acc.status).toBe('connected');
    expect(acc.apiKeyEnc).toBeTruthy();
  });

  it('webhook adresini yenile: yeni adres yanıtta; eski belirteç hemen 404, yeni kabul; diğer tenant etkilenmez; audit belirteç içermez', async () => {
    const oldToken = (await accountOf(c.tenantId)).webhookToken;
    const dToken = (await accountOf(d.tenantId)).webhookToken;
    expect((await postWebhook(oldToken, c.tenantId)).statusCode).toBe(200);

    const res = await ctx.request({ method: 'POST', url: `${API}/rotate-webhook-token`, cookie: c.ownerCookie, body: {} });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { webhookUrl: string; account: { webhookUrl: string; status: string; hasApiKey: boolean } };
    expect(body.webhookUrl).toMatch(/^http:\/\/localhost:3000\/api\/v1\/webhooks\/wa\/[A-Za-z0-9_-]{20,}$/);
    expect(body.account).toMatchObject({ webhookUrl: body.webhookUrl, status: 'connected', hasApiKey: true });
    const newToken = tokenOf(body.webhookUrl);
    expect(newToken).not.toBe(oldToken);
    expect((await accountOf(c.tenantId)).webhookToken).toBe(newToken);

    expectError(await postWebhook(oldToken, c.tenantId), 404, 'not_found');
    expectError(await ctx.request({ method: 'GET', url: `/api/v1/webhooks/wa/${oldToken}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1` }), 404, 'not_found');
    expect((await postWebhook(newToken, c.tenantId)).statusCode).toBe(200);

    // Yalıtım: yalnız kendi hesabı
    expect((await accountOf(d.tenantId)).webhookToken).toBe(dToken);
    expect((await postWebhook(dToken, d.tenantId)).statusCode).toBe(200);

    const logs = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, c.tenantId), eq(auditLog.action, 'whatsapp.webhook_token_rotate')));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorUserId: c.owner.id, entityType: 'wa_account' });
    expect(JSON.stringify(logs[0])).not.toContain(newToken);
    expect(JSON.stringify(logs[0])).not.toContain(oldToken);
  });

  it('bağlantıyı kes: disconnected, anahtar silinir, satır ve sohbet geçmişi kalır; vitrin ve Akış B WhatsApp’sız; kuyruktaki gönderim temiz başarısız; webhook 404', async () => {
    expect((await store(c.slug)).tenant.whatsappPhone).toBe('+905327000001');
    const before = await accountOf(c.tenantId);
    // Bağlıyken gelen müşteri mesajı: karşılama kuyrukta bekliyor (henüz gönderilmedi)
    await inbound(ctx, before, { phone: CUSTOMER, name: 'Deniz' }, { type: 'text', text: 'merhaba' });
    const conv = (await conversationFor(ctx.db, before, CUSTOMER))!;
    expect((await threadRows(ctx.db, conv.id)).some((m) => m.direction === 'out' && m.status === 'queued')).toBe(true);

    const res = await ctx.request({ method: 'POST', url: `${API}/disconnect`, cookie: c.ownerCookie, body: {} });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      account: Record<string, unknown>;
      health: { level: string };
      smsFallback: { active: boolean };
    };
    expect(body.account).toMatchObject({ id: before.id, status: 'disconnected', hasApiKey: false, apiKeyMasked: null, phoneNumberId: null, displayPhone: '+905327000001' });
    expect(body.health.level).toBe('warning');
    expect(body.smsFallback.active).toBe(true);

    const after = await accountOf(c.tenantId);
    expect(after).toMatchObject({ id: before.id, status: 'disconnected', apiKeyEnc: null, phoneNumberId: null, displayPhone: '+905327000001' });
    expect(after.webhookToken).not.toBe(before.webhookToken);

    // Vitrin numarayı göstermez; Akış B SMS OTP'ye düşer (platform + işletme SMS yedeği açık)
    expect((await store(c.slug)).tenant.whatsappPhone).toBeNull();
    const [tenantRow] = await ctx.db.select().from(tenants).where(eq(tenants.id, c.tenantId));
    expect(await loadVerificationChannels(ctx.db, tenantRow!, c.branchId)).toEqual({ waConnected: false, waDisplayPhone: null, waLink: null, smsAvailable: true });

    // Kuyruktaki gönderim işi çökmez: mesaj 'account_unavailable' ile başarısız
    await flushOutbound(ctx);
    const outs = (await threadRows(ctx.db, conv.id)).filter((m) => m.direction === 'out');
    expect(outs.length).toBeGreaterThan(0);
    expect(outs.every((m) => m.status === 'failed' && m.errorCode === 'account_unavailable')).toBe(true);

    // Webhook: ne eski ne yeni belirteç olay kabul eder
    expectError(await postWebhook(before.webhookToken, c.tenantId), 404, 'not_found');
    expectError(await postWebhook(after.webhookToken, c.tenantId), 404, 'not_found');

    // Sohbet geçmişi panelde kalır; yanıt ve test mesajı 409
    const list = await ctx.request({ method: 'GET', url: '/api/v1/panel/conversations', cookie: c.ownerCookie });
    expect((list.json() as { items: Array<{ id: string }> }).items.map((i) => i.id)).toContain(conv.id);
    expectError(await ctx.request({ method: 'POST', url: `/api/v1/panel/conversations/${conv.id}/messages`, cookie: c.ownerCookie, body: { text: 'Merhaba' } }), 409, 'wa_not_connected');
    expectError(await ctx.request({ method: 'POST', url: `${API}/test`, cookie: c.ownerCookie, body: {} }), 409, 'wa_not_connected');

    // Audit: eski numara kimliği geçmiş için; anahtar yok
    const logs = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, c.tenantId), eq(auditLog.action, 'whatsapp.account_disconnect')));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.data).toMatchObject({ provider: 'd360', phoneNumberId: before.phoneNumberId, previousStatus: 'connected' });
    expect(JSON.stringify(logs[0])).not.toContain('D360-KEY');

    // Tekrar kesmek bir şey değiştirmez
    const again = await ctx.request({ method: 'POST', url: `${API}/disconnect`, cookie: c.ownerCookie, body: {} });
    expect(again.statusCode).toBe(200);
    expect((await accountOf(c.tenantId)).webhookToken).toBe(after.webhookToken);
    expect(await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, c.tenantId), eq(auditLog.action, 'whatsapp.account_disconnect')))).toHaveLength(1);

    // Diğer tenant bağlı kalır
    const other = await accountOf(d.tenantId);
    expect(other).toMatchObject({ status: 'connected' });
    expect(other.apiKeyEnc).toBeTruthy();
    expect((await store(d.slug)).tenant.whatsappPhone).toBe('+905327000002');
  });

  it('yeniden bağlama: anahtar girilince connected; webhook yeni adresle çalışır', async () => {
    const res = await ctx.request({ method: 'PUT', url: API, cookie: c.ownerCookie, body: { provider: 'd360', displayPhone: '0532 700 00 01', apiKey: 'D360-KEY-CCCC-3333' } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { account: { status: string; webhookUrl: string; apiKeyMasked: string } };
    expect(body.account).toMatchObject({ status: 'connected', apiKeyMasked: '••••3333' });
    expect((await postWebhook(tokenOf(body.account.webhookUrl), c.tenantId)).statusCode).toBe(200);
    expect((await store(c.slug)).tenant.whatsappPhone).toBe('+905327000001');
  });
});
