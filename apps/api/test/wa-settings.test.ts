// Panel WhatsApp ayarları: GET/PUT (owner), şifreli API anahtarı, webhook adresi, test mesajı; yetki ve yalıtım.

import { messages, users, waAccounts } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setHttpFetch } from '../src/wa/index';
import { createTestContext, expectError, type TestContext, type TestTenant } from './helpers';

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
