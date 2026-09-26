// Ortak numara (00 §12a madde 8) uç noktaları: ortak webhook (doğrulama, imza, ham olay + iş, hemen 200), panel
// WhatsApp ayarları (mod, kod, QR, 409 wa_shared_mode, yalıtım), vitrin (ortak numara + #KOD bağlantısı), Akış B
// storefront bağlantısı ve takip sayfası, admin kod/mod değişikliği (tekillik, doğrulama, yetki, audit), kayıtta kod
// üretimi, dev simülatörü (ortak sohbet) ve saklama/KVKK (yönlendirme kaydı).

import { sharedPrefillText } from '@siparis/core';
import { auditLog, customers, jobs, retentionRuns, sharedWaMessages, sharedWaRoutes, tenants, users, waAccounts, waWebhookEvents } from '@siparis/db';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import { runRetention } from '../src/jobs/system/index';
import { buildInboundPayload } from '../src/services/messaging/dev-payload';
import { applyWaMode, ensureSharedWaAccount, sharedLinkInfo, whatsappLinkFor } from '../src/services/messaging/shared';
import { loadVerificationChannels } from '../src/services/orders/verification';
import { findSharedRoute } from '../src/services/messaging/shared-router';
import { signMetaPayload } from '../src/wa/signature';
import { createPlatformUsers, type PlatformUsers } from './admin-helpers';
import { cookieFrom, createTestContext, expectError, testConfig, type TestContext } from './helpers';
import { orderBody, placeOrder, setupStore, type StoreFixture } from './orders-helpers';
import { SHARED_DEV_ACCOUNT, conversationFor, setupSharedTenant, setupWaTenant, sharedInbound, silentLog, type WaSetup } from './wa-helpers';

const SECRET = 'shared-app-secret';
const TOKEN = 'shared-hook-token-0123456789';
let ctx: TestContext;
let A: WaSetup;
let B: WaSetup;
let own: WaSetup;
let p: PlatformUsers;

let seq = 7000;
const nextPhone = () => `+90537${String(1000000 + seq++).slice(-7)}`;

beforeAll(async () => {
  ctx = await createTestContext({
    config: testConfig({ WA_APP_SECRET: SECRET, WA_VERIFY_TOKEN: 'verify-me', PLATFORM_WA_WEBHOOK_TOKEN: TOKEN, PLATFORM_WA_DISPLAY_PHONE: '+905550000000' }),
  });
  A = await setupSharedTenant(ctx, { name: 'Bozok Pide Salonu', code: 'BOZOK' });
  B = await setupSharedTenant(ctx, { name: 'Çamlık Döner', code: 'DONER' });
  own = await setupWaTenant(ctx, { name: 'Kendi Numaralı Lokanta' });
  p = await createPlatformUsers(ctx);
});
afterAll(async () => {
  await ctx.close();
});

// ---------------------------------------------------------------------------
describe('ortak webhook /webhooks/wa/shared/:token', () => {
  const post = (token: string, body: unknown, opts: { sign?: boolean } = {}) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.sign !== false) headers['x-hub-signature-256'] = signMetaPayload(raw, SECRET);
    return ctx.app.inject({ method: 'POST', url: `/api/v1/webhooks/wa/shared/${token}`, headers, payload: raw });
  };

  it('GET doğrulama: doğru belirteçle challenge; yanlış yol belirteci 404, yanlış doğrulama belirteci 403', async () => {
    const ok = await ctx.request({ method: 'GET', url: `/api/v1/webhooks/wa/shared/${TOKEN}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=777` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('777');
    expectError(await ctx.request({ method: 'GET', url: `/api/v1/webhooks/wa/shared/yanlis-belirtec-000?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1` }), 404, 'not_found');
    expectError(await ctx.request({ method: 'GET', url: `/api/v1/webhooks/wa/shared/${TOKEN}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1` }), 403, 'invalid_verify_token');
  });

  it('POST: imzasız 401, bozuk JSON 400, yanlış belirteç 404; geçerli olay → ham kayıt (provider shared) + iş + hemen 200', async () => {
    const { payload } = buildInboundPayload(SHARED_DEV_ACCOUNT, { phone: nextPhone() }, { type: 'text', text: '#BOZOK' });
    expectError(await post(TOKEN, payload, { sign: false }), 401, 'invalid_signature');
    expectError(await post(TOKEN, '{bozuk'), 400, 'invalid_json');
    expectError(await post('baska-belirtec-00000', payload), 404, 'not_found');
    const before = (await ctx.db.select().from(waWebhookEvents).where(eq(waWebhookEvents.provider, 'shared'))).length;
    const res = await post(TOKEN, payload);
    expect(res.statusCode).toBe(200);
    const events = await ctx.db.select().from(waWebhookEvents).where(eq(waWebhookEvents.provider, 'shared'));
    expect(events).toHaveLength(before + 1);
    const ev = events.at(-1)!;
    expect(ev).toMatchObject({ waAccountId: null, tenantId: null, processedAt: null });
    const [job] = await ctx.db.select().from(jobs).where(eq(jobs.dedupeKey, `wa_in:${ev.id}`));
    expect(job).toMatchObject({ type: 'wa.process_inbound', queue: 'wa-inbound', status: 'pending' });
  });

  it('ortak numara satırının işletmeye özel webhook adresi yoktur (404)', async () => {
    const { payload } = buildInboundPayload(SHARED_DEV_ACCOUNT, { phone: nextPhone() }, { type: 'text', text: 'x' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/wa/${A.account.webhookToken}`,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signMetaPayload(JSON.stringify(payload), SECRET) },
      payload: JSON.stringify(payload),
    });
    expectError(res, 404, 'not_found');
  });

  it('yanlış belirteçli taşkın doğru belirtecin kovasını boşaltmaz: IP başına 429, gerçek teslim 200', async () => {
    // Taze sınırlayıcılar için ayrı uygulama örneği (aynı veritabanı)
    const app = await buildApp({ config: ctx.config, db: ctx.handle, logger: false });
    try {
      const junk = (i: number, ip: string) =>
        app.inject({ method: 'POST', url: `/api/v1/webhooks/wa/shared/yanlis-${i}`, headers: { 'content-type': 'application/json' }, payload: '{}', remoteAddress: ip });
      const counts: Record<number, number> = {};
      for (let i = 0; i < 100; i++) {
        const r = await junk(i, '203.0.113.7');
        counts[r.statusCode] = (counts[r.statusCode] ?? 0) + 1;
      }
      expect(counts[404]).toBeGreaterThanOrEqual(60);
      expect(counts[404]).toBeLessThan(70);
      expect(counts[429]).toBeGreaterThan(0);
      // Dağıtık taşkın: doğru belirtecin dakikalık kovasından (12.000) fazla istek, her biri ayrı IP'den
      for (let i = 0; i < 12_100; i++) await junk(i, `198.51.${(i >> 8) & 255}.${i & 255}`);
      const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
      const ok = await app.inject({
        method: 'POST',
        url: `/api/v1/webhooks/wa/shared/${TOKEN}`,
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signMetaPayload(raw, SECRET) },
        payload: raw,
        remoteAddress: '203.0.113.7',
      });
      expect(ok.statusCode, ok.body).toBe(200);
    } finally {
      await app.close();
    }
  }, 120_000);

  it('PLATFORM_WA_WEBHOOK_TOKEN tanımsızsa ortak webhook kapalı (404)', async () => {
    const other = await buildApp({ config: testConfig({ WA_VERIFY_TOKEN: 'verify-me' }), db: ctx.handle, logger: false });
    try {
      const res = await other.inject({ method: 'GET', url: `/api/v1/webhooks/wa/shared/${TOKEN}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1` });
      expectError(res, 404, 'not_found');
    } finally {
      await other.close();
    }
  });
});

// ---------------------------------------------------------------------------
describe('panel WhatsApp ayarları (ortak numara)', () => {
  const get = (cookie: string) => ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp', cookie });

  it('GET: mod, kod, ortak numara, ön-dolu metin, wa.me bağlantısı, QR (SVG); hesap shared, webhook yok', async () => {
    const res = await get(A.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      mode: 'shared',
      code: 'BOZOK',
      shared: {
        code: 'BOZOK',
        displayName: 'Siparişin Önünde',
        displayPhone: '+905550000000',
        displayPhoneFormatted: '0555 000 00 00',
        prefillText: 'Merhaba, Bozok Pide Salonu için sipariş vermek istiyorum. #BOZOK',
        waLink: `https://wa.me/905550000000?text=${encodeURIComponent('Merhaba, Bozok Pide Salonu için sipariş vermek istiyorum. #BOZOK')}`,
        selectable: true,
        selectableReason: null,
        canEditCode: false,
      },
      account: { provider: 'shared', providerLabel: 'Ortak numara', status: 'connected', displayPhone: '+905550000000', webhookUrl: null, hasApiKey: false },
      health: { level: 'ok' },
      smsFallback: { active: false },
    });
    expect(body.shared.qrSvg).toMatch(/^<svg/);
    expect(body.providers.map((x: { value: string }) => x.value)).toEqual(['mock', 'd360', 'cloud']);
  });

  it('canlı değilse listede görünmez uyarısı; kendi numara modunda shared null', async () => {
    await ctx.db.update(tenants).set({ webLiveAt: null }).where(eq(tenants.id, B.tenantId));
    const res = (await get(B.ownerCookie)).json();
    expect(res.shared).toMatchObject({ selectable: false, selectableReason: 'Canlıya geçince ortak numaradaki dükkan listesinde görünürsünüz.' });
    expect(res.health.level).toBe('warning');
    await ctx.db.update(tenants).set({ webLiveAt: new Date() }).where(eq(tenants.id, B.tenantId));
    const o = (await get(own.ownerCookie)).json();
    expect(o).toMatchObject({ mode: 'own', shared: null, account: { provider: 'mock' } });
  });

  it('ortak numarada kendi numara ayarları 409 wa_shared_mode (PUT, bağlantıyı kes, webhook yenile)', async () => {
    expectError(await ctx.request({ method: 'PUT', url: '/api/v1/panel/whatsapp', cookie: A.ownerCookie, body: { provider: 'd360', displayPhone: '05321112233', apiKey: 'k' } }), 409, 'wa_shared_mode');
    expectError(await ctx.request({ method: 'POST', url: '/api/v1/panel/whatsapp/disconnect', cookie: A.ownerCookie }), 409, 'wa_shared_mode');
    expectError(await ctx.request({ method: 'POST', url: '/api/v1/panel/whatsapp/rotate-webhook-token', cookie: A.ownerCookie }), 409, 'wa_shared_mode');
    expectError(await ctx.request({ method: 'PUT', url: '/api/v1/panel/whatsapp', cookie: A.ownerCookie, body: { provider: 'shared', displayPhone: '05321112233' } }), 400, 'validation_error');
    const [acc] = await ctx.db.select().from(waAccounts).where(eq(waAccounts.id, A.account.id));
    expect(acc).toMatchObject({ provider: 'shared', status: 'connected' });
  });

  it('QR indirme: SVG ve PNG (owner, manager); kasiyer 403; kendi işletmesinin kodu', async () => {
    const svg = await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp/qr?format=svg', cookie: A.ownerCookie });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
    expect(svg.headers['content-disposition']).toBe('attachment; filename="whatsapp-qr-bozok.svg"');
    expect(svg.body).toMatch(/^<svg/);
    const manager = await ctx.createStaff(B.tenantId, 'manager');
    const png = await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp/qr?format=png', cookie: manager.cookie });
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['content-disposition']).toBe('attachment; filename="whatsapp-qr-doner.png"');
    expect(png.rawPayload.subarray(1, 4).toString()).toBe('PNG');
    const cashier = await ctx.createStaff(A.tenantId, 'cashier');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp/qr', cookie: cashier.cookie }), 403, 'forbidden');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp', cookie: manager.cookie }), 403, 'forbidden');
  });

  it('test mesajı: ortak numarada yalnız hesaptaki telefona ya da son 24 saatte bu dükkana yazmış müşteriye; dükkan başına sınırlı', async () => {
    const T = await setupSharedTenant(ctx, { name: 'Test Mesajı Dükkanı', code: 'TESTMSJ', ownerPhone: '+905551230001' });
    const send = (to?: string) => ctx.request({ method: 'POST', url: '/api/v1/panel/whatsapp/test', cookie: T.ownerCookie, body: to ? { to } : {} });
    const custCount = async () => (await ctx.db.select({ id: customers.id }).from(customers).where(eq(customers.tenantId, T.tenantId))).length;
    const before = await custCount();
    // Rastgele numara: gönderilmez, müşteri kaydı açılmaz
    expectError(await send('0555 999 88 77'), 400, 'test_recipient_not_allowed');
    expect(await custCount()).toBe(before);
    // Başka dükkana yazmış olmak yetmez (durum olayı başka dükkanların penceresini sızdırmasın)
    const stranger = nextPhone();
    await sharedInbound(ctx, { phone: stranger }, { type: 'text', text: '#DONER' });
    expectError(await send(stranger), 400, 'test_recipient_not_allowed');
    // Hesaptaki telefon
    const mine = await send();
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.json().to).toBe('+905551230001');
    // Son 24 saatte bu dükkana yazmış müşteri
    const cust = nextPhone();
    await sharedInbound(ctx, { phone: cust }, { type: 'text', text: '#TESTMSJ' });
    expect((await send(cust)).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    // 10 dakikada en çok 3
    expectError(await send(), 429, 'rate_limited');
    // Kendi numaralı işletmede davranış aynı (sınır yok, istenen numaraya)
    await ctx.db.update(users).set({ phone: '+905551230002' }).where(eq(users.id, own.owner.id));
    for (let i = 0; i < 4; i++) expect((await ctx.request({ method: 'POST', url: '/api/v1/panel/whatsapp/test', cookie: own.ownerCookie, body: { to: '0532 999 88 7' + i } })).statusCode).toBe(200);
  });

  it('eksik ortak numara satırı GET ile kendiliğinden tamamlanır', async () => {
    const t = await ctx.createTenantWithOwner({ name: 'Satırsız Dükkan', waMode: 'shared', waCode: 'SATIRSIZ' });
    expect(await ctx.db.select().from(waAccounts).where(eq(waAccounts.tenantId, t.tenantId))).toHaveLength(0);
    const res = (await get(t.ownerCookie)).json();
    expect(res.account).toMatchObject({ provider: 'shared', status: 'connected', branchId: t.branchId });
  });
});

// ---------------------------------------------------------------------------
describe('üretimde taklit (mock) ortak numara', () => {
  it('geliştirme numarası gösterilmez: bağlantı ve QR yok, Akış B WhatsApp onayı sunmaz', async () => {
    const prodMock = { ...ctx.config, NODE_ENV: 'production', DEPLOY_ENV: 'production', PLATFORM_WA_DISPLAY_PHONE: undefined } as Config;
    const T = await setupSharedTenant(ctx, { name: 'Üretim Dükkanı', code: 'URETIM' });
    expect(sharedLinkInfo(prodMock, { name: 'Üretim Dükkanı', waCode: 'URETIM' })).toMatchObject({ code: 'URETIM', displayPhone: null, waLink: null });
    const acc = await ensureSharedWaAccount(ctx.db, prodMock, T.tenantId);
    expect(acc).toMatchObject({ provider: 'shared', displayPhone: null });
    expect(whatsappLinkFor(acc!, { name: 'Üretim Dükkanı', waCode: 'URETIM' })).toBeNull();
    const [t] = await ctx.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    expect(await loadVerificationChannels(ctx.db, t!, T.branchId)).toMatchObject({ waConnected: false, waDisplayPhone: null, waLink: null });
    // Dev dağıtımında (simülatör) geliştirme numarası kullanılır
    const dev = await ensureSharedWaAccount(ctx.db, { ...prodMock, DEPLOY_ENV: 'dev' } as Config, T.tenantId);
    expect(dev!.displayPhone).toBe('+905550000000');
  });
});

// ---------------------------------------------------------------------------
describe('vitrin, Akış B ve takip', () => {
  let s: StoreFixture;

  beforeAll(async () => {
    s = await setupStore(ctx, { wa: 'none' });
    await ctx.db.update(tenants).set({ name: 'Vitrin Pide', waCode: 'VITRIN' }).where(eq(tenants.id, s.tenantId));
    await applyWaMode(ctx.db, ctx.config, s.tenantId, 'shared');
  });

  it('vitrin: whatsappPhone ortak numara, bağlantı #KOD ön-dolu; kendi numarada yalın wa.me', async () => {
    const view = (await ctx.request({ method: 'GET', url: `/api/v1/store/${s.slug}` })).json();
    expect(view.tenant).toMatchObject({
      whatsappPhone: '+905550000000',
      whatsappMode: 'shared',
      whatsappCode: 'VITRIN',
      whatsappPrefillText: sharedPrefillText('Vitrin Pide', 'VITRIN'),
      whatsappLink: `https://wa.me/905550000000?text=${encodeURIComponent(sharedPrefillText('Vitrin Pide', 'VITRIN'))}`,
    });
    const o = (await ctx.request({ method: 'GET', url: `/api/v1/store/${own.slug}` })).json();
    expect(o.tenant).toMatchObject({ whatsappPhone: '+905550000099', whatsappMode: 'own', whatsappCode: null, whatsappLink: 'https://wa.me/905550000099' });
  });

  it('Akış B: "WhatsApp ile onayla" ortak numaraya kodla; ortak numaraya gelen kod siparişi doğrular; takip bağlantısı #KOD\'lu', async () => {
    const res = await placeOrder(ctx, s.slug, orderBody(s));
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: 'awaiting_customer', verification: { required: true, method: 'wa_code' } });
    expect(body.verification.waLink).toBe(`https://wa.me/905550000000?text=${encodeURIComponent(`Sipariş kodu: ${body.verification.code}`)}`);
    const phone = nextPhone();
    await sharedInbound(ctx, { phone, name: 'Deniz' }, { type: 'text', text: `Sipariş kodu: ${body.verification.code}` });
    const track = (await ctx.request({ method: 'GET', url: body.trackingUrl.replace('http://localhost:3000/t/', '/api/v1/store/track/') })).json();
    expect(track.order.status).toBe('new');
    expect(track.business).toMatchObject({
      waPhone: '+905550000000',
      waLink: `https://wa.me/905550000000?text=${encodeURIComponent(sharedPrefillText('Vitrin Pide', 'VITRIN'))}`,
    });
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: s.tenantId });
  });
});

// ---------------------------------------------------------------------------
describe('admin: dükkan kodu ve WhatsApp modu', () => {
  const patch = (id: string, cookie: string, body: Record<string, unknown>) =>
    ctx.request({ method: 'PATCH', url: `/api/v1/admin/tenants/${id}`, cookie, body: { reason: 'Dükkan kodu düzenlemesi', ...body } });

  it('kod normalize edilir, audit\'e yazılır; detay ve listede mod/kod/QR bağlantısı', async () => {
    const res = await patch(A.tenantId, p.platform_admin.cookie, { waCode: 'bozok pide' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tenant).toMatchObject({
      waCode: 'BOZOKPIDE',
      waMode: 'shared',
      sharedWaLink: `https://wa.me/905550000000?text=${encodeURIComponent(sharedPrefillText('Bozok Pide Salonu', 'BOZOKPIDE'))}`,
    });
    const [log] = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, A.tenantId), eq(auditLog.action, 'admin.tenant_update')));
    expect((log!.data as { changes: Record<string, unknown> }).changes).toMatchObject({ waCode: { from: 'BOZOK', to: 'BOZOKPIDE' } });
    const list = (await ctx.request({ method: 'GET', url: '/api/v1/admin/tenants?q=bozok', cookie: p.platform_admin.cookie })).json();
    expect(list.items.find((x: { id: string }) => x.id === A.tenantId)).toMatchObject({ waMode: 'shared', waCode: 'BOZOKPIDE' });
    // Eski kod artık dükkan seçmez, yenisi seçer
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, { type: 'text', text: '#BOZOKPIDE' });
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: A.tenantId });
  });

  it('tekillik 409; biçim/komut/sipariş koduna benzeyen 400; yetkisiz rol 403', async () => {
    expectError(await patch(B.tenantId, p.platform_admin.cookie, { waCode: 'bozokpide' }), 409, 'wa_code_taken');
    expectError(await patch(B.tenantId, p.platform_admin.cookie, { waCode: 'ab' }), 400, 'invalid_wa_code');
    expectError(await patch(B.tenantId, p.platform_admin.cookie, { waCode: 'liste' }), 400, 'invalid_wa_code');
    expectError(await patch(B.tenantId, p.platform_admin.cookie, { waCode: 'K7M2Q9' }), 400, 'invalid_wa_code');
    // Yalnız rakam: sipariş numarasıyla (#1047) karışır
    const digits = await patch(B.tenantId, p.platform_admin.cookie, { waCode: '1453' });
    expectError(digits, 400, 'invalid_wa_code');
    expect(digits.json().error.message).toContain('en az bir harf');
    expectError(await patch(B.tenantId, p.support_agent.cookie, { waCode: 'DONER2' }), 403, 'forbidden');
    expectError(await patch(B.tenantId, p.finance.cookie, { waMode: 'own' }), 403, 'forbidden');
    const [b] = await ctx.db.select().from(tenants).where(eq(tenants.id, B.tenantId));
    expect(b!.waCode).toBe('DONER');
  });

  it('mod: own → ortak numara satırı kapanır (bağlantısız), shared → satır ortak numaraya çevrilir; seçicide görünürlük', async () => {
    const off = await patch(B.tenantId, p.platform_owner.cookie, { waMode: 'own' });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().tenant).toMatchObject({ waMode: 'own', sharedWaLink: null });
    const [acc1] = await ctx.db.select().from(waAccounts).where(eq(waAccounts.tenantId, B.tenantId));
    expect(acc1).toMatchObject({ id: B.account.id, provider: 'mock', status: 'disconnected', displayPhone: null });
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, { type: 'text', text: '#DONER' });
    const [pm] = await ctx.db.select().from(sharedWaMessages).where(and(eq(sharedWaMessages.direction, 'out'), sql`${sharedWaMessages.payload}->>'code' = 'P03'`));
    expect(pm!.body).toBe('Çamlık Döner şu an bu numaradan sipariş almıyor. Başka bir dükkan için "dükkanlar" yazabilirsin.');
    const on = await patch(B.tenantId, p.platform_owner.cookie, { waMode: 'shared' });
    expect(on.statusCode, on.body).toBe(200);
    const [acc2] = await ctx.db.select().from(waAccounts).where(eq(waAccounts.tenantId, B.tenantId));
    expect(acc2).toMatchObject({ id: B.account.id, provider: 'shared', status: 'connected', displayPhone: '+905550000000', apiKeyEnc: null });
    const logs = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, B.tenantId), eq(auditLog.action, 'admin.tenant_update')));
    expect(logs.map((l) => (l.data as { changes: Record<string, unknown> }).changes.waMode)).toEqual([{ from: 'shared', to: 'own' }, { from: 'own', to: 'shared' }]);
  });
});

describe('admin: WhatsApp sağlığı ortak numara özeti', () => {
  it('GET /admin/whatsapp: numara, sağlayıcı, maskeli webhook, dükkan sayıları, platform mesajları (24 sa); belirteç sızmaz', async () => {
    const res = await ctx.request({ method: 'GET', url: '/api/v1/admin/whatsapp', cookie: p.support_agent.cookie });
    expect(res.statusCode, res.body).toBe(200);
    const s = res.json().sharedNumber;
    expect(s).toMatchObject({
      displayName: 'Siparişin Önünde',
      displayPhone: '+905550000000',
      provider: 'mock',
      webhookConfigured: true,
      health: 'yellow',
    });
    expect(s.webhookUrlMasked).toMatch(/\/api\/v1\/webhooks\/wa\/shared\/••••6789$/);
    expect(res.body).not.toContain(TOKEN);
    expect(s.lastWebhookAt).not.toBeNull();
    expect(s.shops.total).toBeGreaterThanOrEqual(2);
    expect(s.shops.selectable).toBeGreaterThanOrEqual(2);
    expect(s.shops.selectable).toBeLessThanOrEqual(s.shops.total);
    expect(s.platform24h.inbound).toBeGreaterThan(0);
    expect(s.platform24h.outbound).toBeGreaterThan(0);
    expect(s.problems.some((x: string) => x.includes('simülatör'))).toBe(true);
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/admin/whatsapp', cookie: p.finance.cookie }), 403, 'forbidden');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/admin/whatsapp', cookie: A.ownerCookie }), 403, 'forbidden');
  });

  it('webhook belirteci ya da numara tanımsızsa kırmızı ve Türkçe sorun satırı', async () => {
    // Numara ve webhook belirteci tanımsız, gerçek sağlayıcı (üretimde productionConfigErrors açılışı zaten durdurur)
    const app = await buildApp({ config: testConfig({ PLATFORM_WA_PROVIDER: 'd360', PLATFORM_WA_API_KEY: 'k' }), db: ctx.handle, logger: false });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/whatsapp', headers: { cookie: p.platform_admin.cookie } });
      expect(res.statusCode, res.body).toBe(200);
      const s = res.json().sharedNumber;
      expect(s).toMatchObject({ provider: 'd360', providerLabel: '360dialog', displayPhone: null, webhookConfigured: false, webhookUrlMasked: null, health: 'red' });
      expect(s.problems.join(' ')).toMatch(/PLATFORM_WA_DISPLAY_PHONE[\s\S]*PLATFORM_WA_WEBHOOK_TOKEN/);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
describe('kayıt: dükkan kodu ve ortak numara satırı', () => {
  it('slug\'dan kod, çakışmada rakam soneki; ortak numara satırı bağlı', async () => {
    const signup = (email: string, phone: string) =>
      ctx.request({
        method: 'POST',
        url: '/api/v1/auth/signup',
        headers: { 'x-forwarded-for': `10.77.0.${seq++ % 250}` },
        body: { businessName: 'Sorgun Kebap', ownerName: 'Ali Usta', phone, email, password: 'sorgun1234', acceptTerms: true },
      });
    const r1 = await signup('ali1@sorgun.test', '0532 111 22 01');
    const r2 = await signup('ali2@sorgun.test', '0532 111 22 02');
    expect(r1.statusCode, r1.body).toBe(201);
    expect(r2.statusCode, r2.body).toBe(201);
    const [t1] = await ctx.db.select().from(tenants).where(eq(tenants.id, r1.json().tenant.id));
    const [t2] = await ctx.db.select().from(tenants).where(eq(tenants.id, r2.json().tenant.id));
    expect([t1!.waCode, t2!.waCode, t1!.waMode]).toEqual(['SORGUN', 'SORGUN2', 'shared']);
    const [acc] = await ctx.db.select().from(waAccounts).where(eq(waAccounts.tenantId, t1!.id));
    expect(acc).toMatchObject({ provider: 'shared', status: 'connected', displayPhone: '+905550000000' });
    const me = await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp', cookie: cookieFrom(r1) });
    expect(me.json()).toMatchObject({ mode: 'shared', code: 'SORGUN', shared: { selectable: false } });
  });

  it('rakamla başlayan işletme adı harfli kod alır ("1453 Kebap" → 1453KEBAP)', async () => {
    const r = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/signup',
      headers: { 'x-forwarded-for': `10.78.0.${seq++ % 250}` },
      body: { businessName: '1453 Kebap', ownerName: 'Fatih Usta', phone: '0532 111 22 03', email: 'fatih@1453.test', password: 'kebap1453', acceptTerms: true },
    });
    expect(r.statusCode, r.body).toBe(201);
    const [t] = await ctx.db.select().from(tenants).where(eq(tenants.id, r.json().tenant.id));
    expect(t!.waCode).toBe('1453KEBAP');
  });

  it('migration 0901: var olan rakamsal kodlar harfli koda çevrilir (core kuralıyla aynı)', async () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/db/migrations/0901_wa_code_letter.sql');
    const [repair] = readFileSync(file, 'utf8').split('--> statement-breakpoint').map((x) => x.trim());
    const t1 = await ctx.createTenantWithOwner({ name: 'Eski 1453', slug: '1453-lahmacun-evi', waMode: 'shared', waCode: 'ESKIA' });
    const t2 = await ctx.createTenantWithOwner({ name: 'Eski 07', slug: '07-06', waMode: 'shared', waCode: 'ESKIB' });
    const Rollback = new Error('geri al');
    await expect(
      ctx.db.transaction(async (tx) => {
        // Eski kısıtla üretilmiş rakamsal kodlar (0900 öncesi kural)
        await tx.execute(sql`alter table tenants drop constraint tenants_wa_code_ck`);
        await tx.update(tenants).set({ waCode: '1453' }).where(eq(tenants.id, t1.tenantId));
        await tx.update(tenants).set({ waCode: '0706' }).where(eq(tenants.id, t2.tenantId));
        await tx.execute(sql.raw(repair!));
        const rows = await tx.select({ id: tenants.id, waCode: tenants.waCode }).from(tenants).where(sql`${tenants.id} in (${t1.tenantId}, ${t2.tenantId})`);
        expect(Object.fromEntries(rows.map((r) => [r.id, r.waCode]))).toEqual({ [t1.tenantId]: '1453LAHMAC', [t2.tenantId]: '0706DKN' });
        throw Rollback;
      }),
    ).rejects.toBe(Rollback);
    // Kısıt yerinde: rakamsal kod yazılamaz
    await expect(ctx.db.update(tenants).set({ waCode: '1453' }).where(eq(tenants.id, t1.tenantId))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe('dev simülatörü (ortak numara)', () => {
  it('shared: true ile yazılır, ortak sohbet tüm dükkanları ve platform seçicisini tek akışta gösterir', async () => {
    const phone = nextPhone();
    const send = (message: Record<string, unknown>, extra: Record<string, unknown> = { shared: true }) =>
      ctx.request({ method: 'POST', url: '/api/v1/dev/wa/inbound?sync=1', body: { ...extra, from: { phone, name: 'Sim' }, message } });
    expect((await send({ type: 'text', text: 'selam' })).statusCode).toBe(200);
    // Ortak numara işletmesinin hesap kimliğiyle yazmak da ortak numaraya gider
    expect((await send({ type: 'text', text: '#DONER' }, { waAccountId: B.account.id })).statusCode).toBe(200);
    expect((await send({ type: 'text', text: '#BOZOKPIDE' })).statusCode).toBe(200);
    const thread = (await ctx.request({ method: 'GET', url: `/api/v1/dev/wa/thread?shared=1&phone=${encodeURIComponent(phone)}` })).json();
    expect(thread.shared).toBe(true);
    const seqs = thread.messages.map((m: { direction: string; platform: boolean; tenantName: string | null; code: string | null }) => [m.direction, m.platform ? 'platform' : m.tenantName, m.code]);
    expect(seqs).toEqual([
      ['in', 'platform', null],
      ['out', 'platform', 'P02'],
      ['in', 'Çamlık Döner', null],
      ['out', 'Çamlık Döner', 'M01'],
      ['in', 'Bozok Pide Salonu', null],
      ['out', 'Bozok Pide Salonu', 'M01'],
    ]);
    expect(thread.messages[1].list.rows.length).toBeGreaterThan(0);
    // Liste satırları bölüm başlığını taşır ("İlçe, Şehir"); giden mesajın wamid'i simülatörün yanıt bağlamı içindir
    expect(thread.messages[1].list.rows[0].section).toEqual(expect.any(String));
    expect(thread.messages[3].wamid).toEqual(expect.any(String));
    expect(thread.messages[3]).toMatchObject({ brand: 'Çamlık Döner', status: 'sent' });
    expect(thread.route).toMatchObject({ currentTenantId: A.tenantId, currentTenantName: 'Bozok Pide Salonu' });
    // Aynı görünüm hesap kimliğiyle
    const viaAcc = (await ctx.request({ method: 'GET', url: `/api/v1/dev/wa/thread?waAccountId=${A.account.id}&phone=${encodeURIComponent(phone)}` })).json();
    expect(viaAcc.messages).toHaveLength(6);
    // Hesap listesi: ortak numara ve dükkan kodları
    const accs = (await ctx.request({ method: 'GET', url: '/api/v1/dev/wa/accounts' })).json();
    expect(accs.sharedNumber).toMatchObject({ displayName: 'Siparişin Önünde', displayPhone: '+905550000000' });
    expect(accs.sharedNumber.shops.find((x: { tenantId: string }) => x.tenantId === B.tenantId)).toMatchObject({ code: 'DONER', selectable: true, waAccountId: B.account.id });
    expect(accs.items.find((x: { id: string }) => x.id === A.account.id)).toMatchObject({ mode: 'shared', provider: 'shared' });
    // Klasik simülatör akışı: dükkan hesabıyla yeni müşteri "merhaba" → o dükkanın QR'ından gelmiş sayılır → karşılama
    const walkIn = nextPhone();
    const r = await ctx.request({ method: 'POST', url: '/api/v1/dev/wa/inbound?sync=1', body: { waAccountId: B.account.id, from: { phone: walkIn }, message: { type: 'text', text: 'merhaba' } } });
    expect(r.statusCode, r.body).toBe(200);
    const t2 = (await ctx.request({ method: 'GET', url: `/api/v1/dev/wa/thread?waAccountId=${B.account.id}&phone=${encodeURIComponent(walkIn)}` })).json();
    expect(t2.messages.map((m: { tenantName: string | null; code: string | null }) => [m.tenantName, m.code])).toEqual([
      ['Çamlık Döner', null],
      ['Çamlık Döner', 'M01'],
    ]);
    expect(t2.messages[1].cta.label).toBe('Menüyü aç');
    // Ortak numarada echo yok
    expectError(
      await ctx.request({ method: 'POST', url: '/api/v1/dev/wa/echo', body: { waAccountId: A.account.id, to: { phone }, text: 'x' } }),
      409,
      'wa_shared_mode',
    );
  });
});

// ---------------------------------------------------------------------------
describe('saklama ve KVKK (yönlendirme kaydı)', () => {
  it('müşteri KVKK silmesi: yönlendirme kaydından yalnız o dükkan çıkar; başka dükkan kalmazsa kayıt silinir', async () => {
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, { type: 'text', text: '#BOZOKPIDE' });
    await sharedInbound(ctx, { phone }, { type: 'text', text: '#DONER' });
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: B.tenantId, recentTenantIds: [B.tenantId, A.tenantId] });
    const [bCust] = await ctx.db.select().from(customers).where(and(eq(customers.tenantId, B.tenantId), eq(customers.phoneE164, phone)));
    const r = await ctx.request({ method: 'POST', url: `/api/v1/panel/customers/${bCust!.id}/erase`, cookie: B.ownerCookie });
    expect(r.statusCode, r.body).toBe(200);
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: null, lastRoutedAt: null, recentTenantIds: [A.tenantId] });
    // Diğer dükkanın (A) müşterisi ve sohbeti yerinde
    expect(await conversationFor(ctx.db, A.account, phone)).toBeDefined();
    const [aCust] = await ctx.db.select().from(customers).where(and(eq(customers.tenantId, A.tenantId), eq(customers.phoneE164, phone)));
    const r2 = await ctx.request({ method: 'POST', url: `/api/v1/panel/customers/${aCust!.id}/erase`, cookie: A.ownerCookie });
    expect(r2.statusCode, r2.body).toBe(200);
    expect(await findSharedRoute(ctx.db, { phone })).toBeNull();
  });

  it('cron.retention: 24 ay hareketsiz yönlendirme ve 30 günlük platform mesajları silinir; tutanak yazılır', async () => {
    const oldPhone = nextPhone();
    const freshPhone = nextPhone();
    await sharedInbound(ctx, { phone: oldPhone }, { type: 'text', text: 'eski' });
    await sharedInbound(ctx, { phone: freshPhone }, { type: 'text', text: 'yeni' });
    const old = (await findSharedRoute(ctx.db, { phone: oldPhone }))!;
    const past = new Date(Date.now() - 25 * 30 * 86_400_000);
    await ctx.db.update(sharedWaRoutes).set({ createdAt: past, lastInboundAt: past, lastPickerAt: past }).where(eq(sharedWaRoutes.id, old.id));
    const fresh = (await findSharedRoute(ctx.db, { phone: freshPhone }))!;
    await ctx.db.update(sharedWaMessages).set({ createdAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(sharedWaMessages.routeId, fresh.id));
    await runRetention(ctx.db, silentLog);
    expect(await findSharedRoute(ctx.db, { phone: oldPhone })).toBeNull();
    expect(await findSharedRoute(ctx.db, { phone: freshPhone })).not.toBeNull();
    expect(await ctx.db.select().from(sharedWaMessages).where(eq(sharedWaMessages.routeId, fresh.id))).toHaveLength(0);
    const runs = await ctx.db.select().from(retentionRuns).where(sql`${retentionRuns.jobName} in ('retention.shared_wa_routes', 'retention.technical.shared_wa_messages')`);
    expect(Object.fromEntries(runs.map((r) => [r.jobName, r.affectedCount]))).toMatchObject({ 'retention.shared_wa_routes': 1 });
    expect(runs.find((r) => r.jobName === 'retention.technical.shared_wa_messages')!.affectedCount).toBeGreaterThanOrEqual(2);
    expect(runs.every((r) => r.error === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Son: demo verisi dükkan ekler (önceki testlerin listelerini etkilemesin)
describe('seed (dev ortamı her açılışta çalıştırır)', () => {
  it('Döner sahibinin e-postası başka hesaptaysa Döner atlanır; seed düşmez', async () => {
    const { seedDemo, DEMO } = await import('@siparis/db');
    const u = await ctx.createUser({ email: DEMO.doner.owner.email });
    const r = await seedDemo(ctx.db);
    expect(r.donerTenantId).toBeNull();
    expect(await ctx.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, DEMO.doner.slug))).toHaveLength(0);
    await ctx.db.delete(users).where(eq(users.id, u.id));
  });

  it('DONER kodu başka işletmedeyse Çamlık Döner boştaki kodu alır; tekrar çalıştırmak aynı işletmeyi bulur', async () => {
    const { seedDemo, DEMO } = await import('@siparis/db');
    const [b] = await ctx.db.select({ waCode: tenants.waCode }).from(tenants).where(eq(tenants.id, B.tenantId));
    expect(b!.waCode).toBe('DONER');
    const r = await seedDemo(ctx.db);
    expect(r.donerTenantId).not.toBeNull();
    const [doner] = await ctx.db.select().from(tenants).where(eq(tenants.slug, DEMO.doner.slug));
    expect(doner!.waCode).toBe('DONER2');
    const again = await seedDemo(ctx.db);
    expect(again.donerTenantId).toBe(doner!.id);
  });
});
