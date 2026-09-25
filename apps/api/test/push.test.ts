// Web Push (00 §10 alarm t=0, 04 §4.5): panel abonelik uçları (yetki, tenant yalıtımı, destek oturumu) ve `push.send`
// işi (doğru abonelikler, rol bazlı yük, 404/410'da kapatma, yeniden deneme, canary/telefon siparişi yok).
// web-push modülü taklittir: gerçek itme servisine istek gitmez.

import { branches, jobs, memberships, orders, pushSubscriptions, sessions, type Database } from '@siparis/db';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPushConfigured, loadConfig, webPushConfigWarnings } from '../src/config';
import { processDueJobs } from '../src/lib/jobs';
import { insertOrderWithItems } from '../src/services/orders/create-order';
import { quoteForBranch } from '../src/services/orders/pricing-context';
import { handlePushSend } from '../src/services/push/send';
import { createTestContext, testConfig, type TestContext } from './helpers';
import { createHookedOrder, setupStore, type StoreFixture } from './orders-helpers';

const sendNotification = vi.hoisted(() => vi.fn());
vi.mock('web-push', () => ({ default: { sendNotification }, sendNotification }));

const VAPID = {
  VAPID_PUBLIC_KEY: 'BEIRDAhHyygHmkikexZb2oLuF-o5Wj2IeilLb8dNfIYUcFSTxncIIssodgVLvqJtTSBlXKP_AE6b-OGAfXe3ZEo',
  VAPID_PRIVATE_KEY: 'Iw5uGt4la3WgyCoi9xlPZIPFCfItfdBIwpRvk3TRgxU',
  VAPID_SUBJECT: 'mailto:destek@siparisinonunde.local',
};
/** Geçerli biçimde istemci anahtarları (taklit servis çözmez). */
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
const API = '/api/v1/panel/push';

let ctx: TestContext;
let s: StoreFixture;
let other: StoreFixture;

const endpoint = (host = 'fcm.googleapis.com') => `https://${host}/fcm/send/${randomUUID()}`;
const subscribe = (cookie: string, ep: string, headers?: Record<string, string>) =>
  ctx.request({ method: 'POST', url: `${API}/subscribe`, cookie, body: { endpoint: ep, expirationTime: null, keys: KEYS }, headers });
const subRow = async (ep: string) => (await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, ep)))[0];
/** Taklit gönderimde hedeflenen endpoint'ler ve yükler. */
const sentTo = () => sendNotification.mock.calls.map((c) => ({ endpoint: (c[0] as { endpoint: string }).endpoint, payload: JSON.parse(c[1] as string) }));

async function runPushJobs(offsetMs = 1_000): Promise<void> {
  const now = new Date(Date.now() + offsetMs);
  for (let i = 0; i < 10; i++) {
    const n = await processDueJobs({ db: ctx.db, config: ctx.config, log: ctx.app.log, now, where: sql`type = 'push.send'` });
    if (!n) break;
  }
}

beforeAll(async () => {
  ctx = await createTestContext({ config: testConfig(VAPID) });
  s = await setupStore(ctx);
  other = await setupStore(ctx);
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  await ctx.db.delete(pushSubscriptions);
  await ctx.sql`update jobs set status = 'cancelled' where status = 'pending'`;
});

describe('yapılandırma', () => {
  it('VAPID üçlüsü yoksa push kapalı; üretimde yalnız uyarı (açılış engellenmez)', () => {
    expect(ctx.config.pushEnabled).toBe(true);
    expect(testConfig().pushEnabled).toBe(false);
    expect(isPushConfigured({ VAPID_PUBLIC_KEY: VAPID.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined })).toBe(false);
    const prod = {
      ...Object.fromEntries(Object.entries(ctx.config).filter(([, v]) => typeof v === 'string')),
      NODE_ENV: 'production',
      SESSION_SECRET: 'q9Vd1x7Wm2Lp8Zr4Tn6Yb3Kc5Hs0Jf1Ga9Ue7Io2',
      TRACKING_SECRET: 'Rt5Yh8Nm2Kq7Wx3Zc9Vb1Lp4Sd6Fg0Hj8Aa',
      WA_VERIFY_TOKEN: '3f9c1a7e5b2d4c6e8a0b1c2d3e4f5a6b',
      DEV_TOOLS: '0',
      DATABASE_URL: 'postgres://x@localhost/x',
    } as Record<string, string>;
    const noPush = loadConfig({ ...prod, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' });
    expect(noPush.pushEnabled).toBe(false);
    expect(webPushConfigWarnings(noPush)).toEqual([expect.stringContaining('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT')]);
    expect(webPushConfigWarnings(loadConfig(prod))).toEqual([]);
    expect(() => loadConfig({ ...prod, VAPID_SUBJECT: 'destek@siparisinonunde.com' })).toThrow(/VAPID_SUBJECT/);
    expect(() => loadConfig({ ...prod, VAPID_PUBLIC_KEY: 'kisa' })).toThrow(/VAPID_PUBLIC_KEY/);
  });

  it('GET public-key: panel rolleri anahtarı alır; kurye ve oturumsuz alamaz', async () => {
    const res = await ctx.request({ method: 'GET', url: `${API}/public-key`, cookie: s.ownerCookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, publicKey: VAPID.VAPID_PUBLIC_KEY });
    const kitchen = await ctx.createStaff(s.tenantId, 'kitchen');
    expect((await ctx.request({ method: 'GET', url: `${API}/public-key`, cookie: kitchen.cookie })).statusCode).toBe(200);
    const courier = await ctx.createStaff(s.tenantId, 'courier');
    expect((await ctx.request({ method: 'GET', url: `${API}/public-key`, cookie: courier.cookie })).statusCode).toBe(403);
    expect((await ctx.request({ method: 'GET', url: `${API}/public-key` })).statusCode).toBe(401);
  });
});

describe('abonelik uçları', () => {
  it('subscribe: kullanıcı/işletme/oturuma bağlanır; aynı endpoint tekrar gelince güncellenir (tek satır)', async () => {
    const ep = endpoint();
    const res = await subscribe(s.ownerCookie, ep, { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Tablet' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, branchId: null });
    const row = await subRow(ep);
    expect(row).toMatchObject({ tenantId: s.tenantId, userId: s.owner.id, p256dh: KEYS.p256dh, auth: KEYS.auth, disabledAt: null });
    expect(row!.userAgent).toContain('Android');
    const [sess] = await ctx.db.select().from(sessions).where(eq(sessions.id, row!.sessionId!));
    expect(sess!.userId).toBe(s.owner.id);

    // Paylaşımlı tablet: aynı cihazda kasiyer oturum açıp abone olur → bağ kasiyere geçer; kapatılmış abonelik açılır
    await ctx.db.update(pushSubscriptions).set({ disabledAt: new Date(), lastError: 'HTTP 410' }).where(eq(pushSubscriptions.endpoint, ep));
    const cashier = await ctx.createStaff(s.tenantId, 'cashier');
    expect((await subscribe(cashier.cookie, ep)).statusCode).toBe(200);
    const rows = await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, ep));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: cashier.user.id, disabledAt: null, lastError: null });
  });

  it('şube kısıtlı üyelik aboneliği o şubeye bağlar; mutfak abone olabilir, kurye olamaz', async () => {
    const cashier = await ctx.createStaff(s.tenantId, 'cashier', { branchId: s.branchId });
    const res = await subscribe(cashier.cookie, endpoint());
    expect(res.statusCode).toBe(200);
    expect(res.json().branchId).toBe(s.branchId);
    const kitchen = await ctx.createStaff(s.tenantId, 'kitchen');
    expect((await subscribe(kitchen.cookie, endpoint())).statusCode).toBe(200);
    const courier = await ctx.createStaff(s.tenantId, 'courier');
    expect((await subscribe(courier.cookie, endpoint())).statusCode).toBe(403);
    expect((await subscribe('', endpoint())).statusCode).toBe(401);
  });

  it('bilinmeyen itme servisi ve geçersiz anahtar reddedilir (SSRF önlemi)', async () => {
    for (const bad of ['http://fcm.googleapis.com/fcm/send/x', 'https://169.254.169.254/latest', 'https://evil.example/fcm.googleapis.com', 'https://api:4000/x']) {
      const res = await subscribe(s.ownerCookie, bad);
      expect(res.statusCode, bad).toBe(400);
    }
    const res = await ctx.request({ method: 'POST', url: `${API}/subscribe`, cookie: s.ownerCookie, body: { endpoint: endpoint(), keys: { p256dh: 'x', auth: KEYS.auth } } });
    expect(res.statusCode).toBe(400);
    for (const host of ['updates.push.services.mozilla.com', 'web.push.apple.com', 'wns2-am3p.notify.windows.com']) {
      expect((await subscribe(s.ownerCookie, endpoint(host))).statusCode, host).toBe(200);
    }
    expect(await ctx.db.select().from(pushSubscriptions)).toHaveLength(3);
  });

  it('destek oturumu (impersonation) abone olamaz, kapatamaz, test gönderemez', async () => {
    const admin = await ctx.createUser({ isPlatformAdmin: true, platformRole: 'support_agent' });
    const ro = await ctx.sessionCookie(admin.id, { tenantId: s.tenantId, kind: 'impersonation' });
    const rw = await ctx.sessionCookie(admin.id, { tenantId: s.tenantId, kind: 'impersonation', readOnly: false });
    const ro403 = await subscribe(ro, endpoint());
    expect(ro403.statusCode).toBe(403);
    expect(ro403.json().error.code).toBe('read_only_session');
    const rw403 = await subscribe(rw, endpoint());
    expect(rw403.statusCode).toBe(403);
    expect(rw403.json().error.code).toBe('impersonation_not_allowed');
    const ep = endpoint();
    await subscribe(s.ownerCookie, ep);
    expect((await ctx.request({ method: 'POST', url: `${API}/unsubscribe`, cookie: rw, body: { endpoint: ep } })).statusCode).toBe(403);
    expect((await ctx.request({ method: 'POST', url: `${API}/test`, cookie: rw, body: { endpoint: ep } })).statusCode).toBe(403);
    expect(await subRow(ep)).toBeDefined();
    expect(await ctx.db.select().from(pushSubscriptions)).toHaveLength(1);
  });

  it('unsubscribe yalnız kendi aboneliğini siler; başka işletme ya da başka kullanıcı silemez (yalıtım)', async () => {
    const ep = endpoint();
    await subscribe(s.ownerCookie, ep);
    const foreign = await ctx.request({ method: 'POST', url: `${API}/unsubscribe`, cookie: other.ownerCookie, body: { endpoint: ep } });
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json()).toEqual({ ok: true, removed: false });
    const manager = await ctx.createStaff(s.tenantId, 'manager');
    expect((await ctx.request({ method: 'POST', url: `${API}/unsubscribe`, cookie: manager.cookie, body: { endpoint: ep } })).json().removed).toBe(false);
    expect(await subRow(ep)).toBeDefined();
    const own = await ctx.request({ method: 'POST', url: `${API}/unsubscribe`, cookie: s.ownerCookie, body: { endpoint: ep } });
    expect(own.json()).toEqual({ ok: true, removed: true });
    expect(await subRow(ep)).toBeUndefined();
  });

  it('oturum silinince (çıkış) abonelik de silinir', async () => {
    const staff = await ctx.createStaff(s.tenantId, 'manager');
    const ep = endpoint();
    await subscribe(staff.cookie, ep);
    const out = await ctx.request({ method: 'POST', url: '/api/v1/auth/logout', cookie: staff.cookie, body: {} });
    expect(out.statusCode).toBeLessThan(300);
    expect(await subRow(ep)).toBeUndefined();
  });

  it('test bildirimi: yalnız kendi cihazına; başkasının endpoint\'i bulunamaz; 410 aboneliği kapatır', async () => {
    const ep = endpoint();
    await subscribe(s.ownerCookie, ep);
    const ok = await ctx.request({ method: 'POST', url: `${API}/test`, cookie: s.ownerCookie, body: { endpoint: ep } });
    expect(ok.json()).toEqual({ sent: true, reason: null });
    expect(sentTo()).toEqual([{ endpoint: ep, payload: expect.objectContaining({ kind: 'test', title: 'Bildirimler açık', orderId: null }) }]);
    expect((await subRow(ep))!.lastSuccessAt).not.toBeNull();

    const foreign = await ctx.request({ method: 'POST', url: `${API}/test`, cookie: other.ownerCookie, body: { endpoint: ep } });
    expect(foreign.json()).toEqual({ sent: false, reason: 'not_found' });

    sendNotification.mockRejectedValueOnce(Object.assign(new Error('Received unexpected response code'), { statusCode: 410 }));
    const gone = await ctx.request({ method: 'POST', url: `${API}/test`, cookie: s.ownerCookie, body: { endpoint: ep } });
    expect(gone.json()).toEqual({ sent: false, reason: 'disabled' });
    expect((await subRow(ep))!.disabledAt).not.toBeNull();
  });
});

/** Doğrudan abonelik satırı (API dışı durumlar: süresi dolmuş oturum, devre dışı üyelik …). */
async function insertSub(tenantId: string, userId: string, opts: { sessionId?: string | null; branchId?: string | null } = {}): Promise<string> {
  const ep = endpoint();
  await ctx.db.insert(pushSubscriptions).values({
    tenantId,
    userId,
    branchId: opts.branchId ?? null,
    sessionId: opts.sessionId ?? null,
    endpoint: ep,
    p256dh: KEYS.p256dh,
    auth: KEYS.auth,
  });
  return ep;
}

/** Telefon siparişi (kancalar dahil): alarm zinciri ve push kurulmaz. */
async function createManualOrder(st: StoreFixture) {
  const [branch] = await ctx.db.select().from(branches).where(eq(branches.id, st.branchId));
  const { quote } = await quoteForBranch(ctx.db, {
    tenantId: st.tenantId,
    branch: branch!,
    request: { items: [{ productId: st.pideId, quantity: 1, optionIds: [st.acisizId] }], fulfillmentType: 'pickup' },
  });
  if (!quote.ok) throw new Error('quote');
  return ctx.db.transaction((tx: Database) =>
    insertOrderWithItems(
      tx,
      {
        tenantId: st.tenantId,
        branchId: st.branchId,
        status: 'new',
        channel: 'manual',
        fulfillmentType: 'pickup',
        quote,
        zone: null,
        neighborhood: null,
        addressLine: null,
        directions: null,
        lat: null,
        lng: null,
        customerId: null,
        customerName: 'Telefon Müşteri',
        customerPhone: '+905321234568',
        paymentMethod: 'pay_at_counter',
        mealCardBrand: null,
        changeForKurus: null,
        wantsCutlery: false,
        note: null,
        verificationMethod: null,
        verifiedAt: null,
        statusNotifyChannel: 'whatsapp',
        testKind: null,
      },
      { type: 'user', userId: st.owner.id },
    ),
  );
}

describe('push.send işi', () => {
  it('yeni sipariş: şubeye erişen panel kullanıcılarının cihazlarına; mutfakta tutar yok; kişisel veri yok', async () => {
    const ownerEp = endpoint();
    await subscribe(s.ownerCookie, ownerEp);
    const cashier = await ctx.createStaff(s.tenantId, 'cashier');
    const cashierEp = endpoint('updates.push.services.mozilla.com');
    await subscribe(cashier.cookie, cashierEp);
    const kitchen = await ctx.createStaff(s.tenantId, 'kitchen');
    const kitchenEp = endpoint('web.push.apple.com');
    await subscribe(kitchen.cookie, kitchenEp);

    // Almaması gerekenler: kurye, devre dışı üyelik, başka şubeye kısıtlı üyelik, süresi dolmuş oturum, başka işletme
    const courier = await ctx.createStaff(s.tenantId, 'courier');
    const courierEp = await insertSub(s.tenantId, courier.user.id);
    const gone = await ctx.createStaff(s.tenantId, 'cashier');
    const goneEp = await insertSub(s.tenantId, gone.user.id);
    await ctx.db.update(memberships).set({ disabledAt: new Date() }).where(eq(memberships.userId, gone.user.id));
    const [branch2] = await ctx.db.insert(branches).values({ tenantId: s.tenantId, name: 'Şube 2', isDefault: false }).returning();
    const b2 = await ctx.createStaff(s.tenantId, 'cashier', { branchId: branch2!.id });
    const b2Ep = await insertSub(s.tenantId, b2.user.id, { branchId: branch2!.id });
    const expired = await ctx.createStaff(s.tenantId, 'manager');
    const expiredEp = endpoint();
    await subscribe(expired.cookie, expiredEp);
    await ctx.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, expired.user.id));
    const foreignEp = endpoint();
    await subscribe(other.ownerCookie, foreignEp);

    const o = await createHookedOrder(ctx, s);
    const [job] = await ctx.db.select().from(jobs).where(and(eq(jobs.type, 'push.send'), sql`${jobs.payload}->>'orderId' = ${o.id}`));
    expect(job).toMatchObject({ queue: 'notify', status: 'pending', dedupeKey: `push:new_order:${o.id}`, maxAttempts: 3, tenantId: s.tenantId });

    await runPushJobs();
    const calls = sentTo();
    expect(calls.map((c) => c.endpoint).sort()).toEqual([ownerEp, cashierEp, kitchenEp].sort());
    for (const ep of [courierEp, goneEp, b2Ep, expiredEp, foreignEp]) expect(calls.some((c) => c.endpoint === ep)).toBe(false);

    const byEp = Object.fromEntries(calls.map((c) => [c.endpoint, c.payload]));
    expect(byEp[ownerEp]).toEqual({
      kind: 'new_order',
      title: `Yeni sipariş #${o.number}`,
      body: expect.stringMatching(/^1 ürün · [\d.,]+ TL$/),
      url: '/panel',
      tag: o.id,
      orderId: o.id,
    });
    expect(byEp[kitchenEp].body).toBe('1 ürün');
    const raw = sendNotification.mock.calls.map((c) => c[1] as string).join(' ');
    expect(raw).not.toContain('Test Müşteri');
    expect(raw).not.toContain('5321234567');
    expect(raw).not.toContain('Test Sk.');

    // Gönderim seçenekleri: VAPID, kısa TTL, yüksek öncelik, sipariş konusu
    const opts = sendNotification.mock.calls[0]![2] as Record<string, unknown>;
    expect(opts).toMatchObject({ urgency: 'high', TTL: 600, topic: o.id.replace(/-/g, ''), contentEncoding: 'aes128gcm' });
    expect(opts.vapidDetails).toEqual({ subject: VAPID.VAPID_SUBJECT, publicKey: VAPID.VAPID_PUBLIC_KEY, privateKey: VAPID.VAPID_PRIVATE_KEY });
    expect((await subRow(ownerEp))!.lastSuccessAt).not.toBeNull();

    // Sipariş başına tek iş (tekillik)
    await ctx.db.transaction(async (tx) => {
      const { enqueueNewOrderPush } = await import('../src/services/push/send');
      await enqueueNewOrderPush(tx, o);
    });
    expect(await ctx.db.select().from(jobs).where(eq(jobs.dedupeKey, `push:new_order:${o.id}`))).toHaveLength(1);
  });

  it('404/410 aboneliği kapatır; 5xx o abonelik için ayrı işle yeniden denenir', async () => {
    const goneEp = endpoint();
    await subscribe(s.ownerCookie, goneEp);
    const manager = await ctx.createStaff(s.tenantId, 'manager');
    const flakyEp = endpoint();
    await subscribe(manager.cookie, flakyEp);
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint === goneEp) throw Object.assign(new Error('Received unexpected response code'), { statusCode: 410 });
      if (sub.endpoint === flakyEp) throw Object.assign(new Error('Received unexpected response code'), { statusCode: 503 });
      return { statusCode: 201, body: '', headers: {} };
    });

    const o = await createHookedOrder(ctx, s);
    await runPushJobs();
    const gone = await subRow(goneEp);
    expect(gone!.disabledAt).not.toBeNull();
    expect(gone!.lastError).toBe('HTTP 410');
    const flaky = await subRow(flakyEp);
    expect(flaky!.disabledAt).toBeNull();
    expect(flaky!.failedAt).not.toBeNull();
    const retry = (await ctx.db.select().from(jobs).where(eq(jobs.type, 'push.send'))).filter(
      (j) => (j.payload as { orderId?: string }).orderId === o.id && (j.payload as { subscriptionId?: string }).subscriptionId,
    );
    expect(retry).toHaveLength(1);
    expect(retry[0]).toMatchObject({ status: 'pending', dedupeKey: `push:new_order:${o.id}:${flaky!.id}` });

    // Yeniden deneme yalnız o aboneliğe; servis yine hata verirse iş kurallarıyla geri çekilir, sonunda başarı
    sendNotification.mockClear();
    await runPushJobs(6_000);
    expect(sentTo().map((c) => c.endpoint)).toEqual([flakyEp]);
    const [again] = await ctx.db.select().from(jobs).where(eq(jobs.id, retry[0]!.id));
    expect(again).toMatchObject({ status: 'pending', attempts: 1 });
    expect(again!.lastError).toContain('PushRetryableError');

    sendNotification.mockClear();
    sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    await runPushJobs(60_000);
    expect(sentTo().map((c) => c.endpoint)).toEqual([flakyEp]);
    const [done] = await ctx.db.select().from(jobs).where(eq(jobs.id, retry[0]!.id));
    expect(done!.status).toBe('done');
    expect((await subRow(goneEp))!.disabledAt).not.toBeNull();
  });

  it('canary siparişte iş kurulmaz ve işleyici göndermez; telefon siparişinde push yok', async () => {
    await subscribe(s.ownerCookie, endpoint());
    const canary = await createHookedOrder(ctx, s, { testKind: 'canary' });
    expect(await ctx.db.select().from(jobs).where(eq(jobs.dedupeKey, `push:new_order:${canary.id}`))).toHaveLength(0);
    const direct = await handlePushSend({ db: ctx.db, config: ctx.config, log: ctx.app.log }, { orderId: canary.id, tenantId: s.tenantId });
    expect(direct).toMatchObject({ status: 'skipped', reason: 'canary', sent: 0 });

    const manual = await createManualOrder(s);
    expect(await ctx.db.select().from(jobs).where(eq(jobs.dedupeKey, `push:new_order:${manual.id}`))).toHaveLength(0);
    await runPushJobs();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('kurulum testi (onboarding_test) "TEST #" etiketiyle gider', async () => {
    await subscribe(s.ownerCookie, endpoint());
    const o = await createHookedOrder(ctx, s, { testKind: 'onboarding_test' });
    await runPushJobs();
    expect(sentTo()).toHaveLength(1);
    expect(sentTo()[0]!.payload.title).toBe(`Yeni sipariş TEST #${o.number}`);
  });

  it('iş çalışmadan onaylanan siparişte bildirim gitmez; push kapalıyken işleyici gönderim yapmaz', async () => {
    await subscribe(s.ownerCookie, endpoint());
    const o = await createHookedOrder(ctx, s);
    const acc = await ctx.request({ method: 'POST', url: `/api/v1/panel/orders/${o.id}/accept`, cookie: s.ownerCookie, body: { etaMinutes: 20 } });
    expect(acc.statusCode).toBe(200);
    await runPushJobs();
    expect(sendNotification).not.toHaveBeenCalled();

    const o2 = await createHookedOrder(ctx, s);
    const off = await handlePushSend({ db: ctx.db, config: { ...ctx.config, pushEnabled: false }, log: ctx.app.log }, { orderId: o2.id, tenantId: s.tenantId });
    expect(off.status).toBe('disabled');
    expect(sendNotification).not.toHaveBeenCalled();
    // Başka işletmenin kimliğiyle sipariş bulunmaz (tenant yalıtımı)
    const cross = await handlePushSend({ db: ctx.db, config: ctx.config, log: ctx.app.log }, { orderId: o2.id, tenantId: other.tenantId });
    expect(cross).toMatchObject({ status: 'skipped', reason: 'order_not_found' });
    expect(sendNotification).not.toHaveBeenCalled();
    await ctx.db.update(orders).set({ status: 'accepted' }).where(eq(orders.id, o2.id));
  });
});
