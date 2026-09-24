import { courierLoginLinks, featureFlags, legalAcceptances, memberships, sessions, subscriptions, tenants, users } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomToken, sha256Hex } from '../src/lib/tokens';
import { requirePlatform, requireTenantRole } from '../src/plugins/auth';
import { cookieFrom, createTestContext, expectError, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
  // Yetki yardımcılarını denemek için test rotaları (app hazır olmadan eklenir)
  ctx.app.post('/api/v1/panel/__test/write', { preHandler: requireTenantRole(['owner', 'manager']) }, async () => ({ ok: true }));
  ctx.app.get('/api/v1/panel/__test/read', { preHandler: requireTenantRole() }, async (req) => ({ role: req.auth?.role }));
  ctx.app.get('/api/v1/admin/__test', { preHandler: requirePlatform(['platform_admin']) }, async () => ({ ok: true }));
});

afterAll(async () => {
  await ctx.close();
});

const signupBody = (over: Record<string, unknown> = {}) => ({
  businessName: 'Çamlık Döner Salonu',
  ownerName: 'Ali Usta',
  phone: '0532 111 22 33',
  email: 'Ali@Example.com',
  password: 'guclu-parola-1',
  city: 'Yozgat',
  acceptTerms: true,
  ...over,
});

describe('POST /auth/signup', () => {
  it('tenant + şube + sahip + deneme aboneliği + yasal kabul oluşturur ve oturum açar', async () => {
    const res = await ctx.request({ method: 'POST', url: '/api/v1/auth/signup', body: signupBody(), headers: { 'x-forwarded-for': '10.9.0.1' } });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.user).toMatchObject({ name: 'Ali Usta', email: 'ali@example.com', phone: '+905321112233', isPlatformAdmin: false });
    expect(body.tenant).toMatchObject({ name: 'Çamlık Döner Salonu', slug: 'camlik-doner-salonu', lifecycleStage: 'trial', planCode: 'pro' });
    expect(body.tenant.defaultBranchId).toBeTruthy();

    const tenantId = body.tenant.id as string;
    const [sub] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
    expect(sub!.status).toBe('trialing');
    const days = (sub!.trialEndsAt!.getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    const [m] = await ctx.db.select().from(memberships).where(eq(memberships.tenantId, tenantId));
    expect(m!.role).toBe('owner');
    const legal = await ctx.db.select().from(legalAcceptances).where(eq(legalAcceptances.tenantId, tenantId));
    expect(legal.map((l) => l.document).sort()).toEqual(['abonelik', 'kvkk_aydinlatma']);

    const me = await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: cookieFrom(res) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ role: 'owner', tenant: { id: tenantId }, readOnly: false, impersonating: null });
    const setCookie = res.cookies.find((c) => c.name === 'sid')!;
    expect(setCookie.httpOnly).toBe(true);
    expect(setCookie.sameSite).toBe('Lax');
  });

  it('aynı e-posta ya da telefon → 409; aynı işletme adı benzersiz slug alır', async () => {
    const dupEmail = await ctx.request({ method: 'POST', url: '/api/v1/auth/signup', body: signupBody({ phone: '05321112299' }), headers: { 'x-forwarded-for': '10.9.0.2' } });
    expectError(dupEmail, 409, 'email_taken');
    const dupPhone = await ctx.request({ method: 'POST', url: '/api/v1/auth/signup', body: signupBody({ email: 'baska@example.com' }), headers: { 'x-forwarded-for': '10.9.0.2' } });
    expectError(dupPhone, 409, 'phone_taken');
    const second = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/signup',
      body: signupBody({ email: 'ikinci@example.com', phone: '05321112244' }),
      headers: { 'x-forwarded-for': '10.9.0.2' },
    });
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().tenant.slug).toBe('camlik-doner-salonu-2');
  });

  it('doğrulama hataları → 400 validation_error', async () => {
    const noTerms = await ctx.request({ method: 'POST', url: '/api/v1/auth/signup', body: signupBody({ acceptTerms: false }), headers: { 'x-forwarded-for': '10.9.0.3' } });
    expectError(noTerms, 400, 'validation_error');
    const badPhone = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/signup',
      body: signupBody({ email: 'x@example.com', phone: '0354 212 00 00' }),
      headers: { 'x-forwarded-for': '10.9.0.3' },
    });
    expectError(badPhone, 400, 'validation_error');
  });

  it('signup_open kapalıysa 403 signup_closed', async () => {
    await ctx.db.insert(featureFlags).values({ key: 'signup_open', enabled: false, kind: 'kill_switch' }).onConflictDoUpdate({
      target: featureFlags.key,
      set: { enabled: false },
    });
    const res = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/signup',
      body: signupBody({ email: 'kapali@example.com', phone: '05321119999' }),
      headers: { 'x-forwarded-for': '10.9.0.4' },
    });
    expectError(res, 403, 'signup_closed');
    await ctx.db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.key, 'signup_open'));
  });
});

describe('login / me / logout', () => {
  it('e-posta ve telefonla giriş; me; çıkış', async () => {
    const t = await ctx.createTenantWithOwner();
    await ctx.db.update(users).set({ phone: '+905559998877' }).where(eq(users.id, t.owner.id));

    const byEmail = await ctx.loginAs(t.owner.email.toUpperCase(), t.owner.password);
    const body = byEmail.res.json();
    expect(body.user.id).toBe(t.owner.id);
    expect(body.memberships).toEqual([
      expect.objectContaining({ tenantId: t.tenantId, role: 'owner', tenantSlug: t.slug }),
    ]);
    expect(body.isPlatformAdmin).toBe(false);

    const byPhone = await ctx.loginAs('0555 999 88 77', t.owner.password);
    const me = await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: byPhone.cookie });
    expect(me.json()).toMatchObject({ user: { id: t.owner.id }, role: 'owner', tenant: { id: t.tenantId, defaultBranchId: t.branchId } });

    const out = await ctx.request({ method: 'POST', url: '/api/v1/auth/logout', cookie: byPhone.cookie });
    expect(out.statusCode).toBe(200);
    expect(out.cookies.find((c) => c.name === 'sid')?.value).toBe('');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: byPhone.cookie }), 401, 'unauthorized');
    // Diğer oturum etkilenmez
    expect((await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: byEmail.cookie })).statusCode).toBe(200);
  });

  it('yanlış parola ve bilinmeyen kullanıcı → 401 invalid_credentials', async () => {
    const t = await ctx.createTenantWithOwner();
    const wrong = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { login: t.owner.email, password: 'yanlis-parola' },
      headers: { 'x-forwarded-for': '10.8.0.1' },
    });
    expectError(wrong, 401, 'invalid_credentials');
    expect(wrong.cookies.find((c) => c.name === 'sid')).toBeUndefined();
    const unknown = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { login: 'yok@test.local', password: 'x' },
      headers: { 'x-forwarded-for': '10.8.0.1' },
    });
    expectError(unknown, 401, 'invalid_credentials');
  });

  it('devre dışı kullanıcı giriş yapamaz, oturumu geçersiz olur', async () => {
    const t = await ctx.createTenantWithOwner();
    await ctx.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, t.owner.id));
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: t.ownerCookie }), 401, 'unauthorized');
  });

  it('oturumsuz me → 401; bozuk çerez → 401', async () => {
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/auth/me' }), 401, 'unauthorized');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: 'sid=bozuk' }), 401, 'unauthorized');
  });

  it('süresi dolmuş oturum → 401', async () => {
    const t = await ctx.createTenantWithOwner();
    const token = t.ownerCookie.slice('sid='.length);
    await ctx.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.tokenHash, sha256Hex(token)));
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: t.ownerCookie }), 401, 'unauthorized');
  });

  it('oturum süreleri: kişisel 30 gün, platform 8 saat, sadece kurye 12 saat', async () => {
    const t = await ctx.createTenantWithOwner();
    const ownerLogin = await ctx.loginAs(t.owner.email, t.owner.password);
    const exp = (res: typeof ownerLogin.res) => res.cookies.find((c) => c.name === 'sid')!.expires!.getTime() - Date.now();
    expect(exp(ownerLogin.res) / 86400000).toBeCloseTo(30, 0);

    const admin = await ctx.createUser({ isPlatformAdmin: true, platformRole: 'platform_admin' });
    const adminLogin = await ctx.loginAs(admin.email, admin.password);
    expect(exp(adminLogin.res) / 3600000).toBeCloseTo(8, 0);
    expect(adminLogin.res.json().isPlatformAdmin).toBe(true);

    const courier = await ctx.createUser();
    await ctx.addMember(t.tenantId, courier.id, 'courier');
    const courierLogin = await ctx.loginAs(courier.email, courier.password);
    expect(exp(courierLogin.res) / 3600000).toBeCloseTo(12, 0);
  });

  it('platform oturumu 30 dk hareketsizlikte kilitlenir', async () => {
    const admin = await ctx.createUser({ isPlatformAdmin: true, platformRole: 'platform_owner' });
    const cookie = await ctx.sessionCookie(admin.id);
    expect((await ctx.request({ method: 'GET', url: '/api/v1/admin/__test', cookie })).statusCode).toBe(200);
    await ctx.db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - 31 * 60_000) })
      .where(eq(sessions.tokenHash, sha256Hex(cookie.slice(4))));
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie }), 401, 'unauthorized');
  });

  it('giriş hız sınırı: 10/dk/IP → 429', async () => {
    let last;
    for (let i = 0; i < 11; i++) {
      last = await ctx.request({
        method: 'POST',
        url: '/api/v1/auth/login',
        body: { login: 'yok@test.local', password: 'x' },
        headers: { 'x-forwarded-for': '10.7.7.7' },
      });
    }
    expectError(last!, 429, 'rate_limited');
    expect(last!.headers['retry-after']).toBeDefined();
  });
});

describe('switch-tenant', () => {
  it('üyesi olunan tenant seçilir, olmayan 404', async () => {
    const a = await ctx.createTenantWithOwner();
    const b = await ctx.createTenantWithOwner();
    const c = await ctx.createTenantWithOwner();
    await ctx.addMember(b.tenantId, a.owner.id, 'manager');

    const sw = await ctx.request({ method: 'POST', url: '/api/v1/auth/switch-tenant', cookie: a.ownerCookie, body: { tenantId: b.tenantId } });
    expect(sw.statusCode, sw.body).toBe(200);
    expect(sw.json()).toMatchObject({ tenant: { id: b.tenantId }, role: 'manager' });
    expect(sw.json().memberships).toHaveLength(2);
    const me = await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: a.ownerCookie });
    expect(me.json().tenant.id).toBe(b.tenantId);

    const bad = await ctx.request({ method: 'POST', url: '/api/v1/auth/switch-tenant', cookie: a.ownerCookie, body: { tenantId: c.tenantId } });
    expectError(bad, 404, 'not_found');
  });
});

describe('kurye magic link', () => {
  async function makeLink(tenantId: string, userId: string, expiresInMs = 15 * 60_000) {
    const token = randomToken(24);
    await ctx.db.insert(courierLoginLinks).values({ tenantId, userId, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + expiresInMs) });
    return token;
  }

  it('tek kullanımlık link → 12 saatlik kurye oturumu', async () => {
    const t = await ctx.createTenantWithOwner();
    const { user } = await ctx.createStaff(t.tenantId, 'courier');
    const token = await makeLink(t.tenantId, user.id);

    const res = await ctx.request({ method: 'POST', url: '/api/v1/auth/courier/exchange', body: { token } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ role: 'courier', tenant: { id: t.tenantId }, user: { id: user.id } });
    const [s] = await ctx.db.select().from(sessions).where(eq(sessions.tokenHash, sha256Hex(cookieFrom(res).slice(4))));
    expect(s!.kind).toBe('courier');
    expect((s!.expiresAt.getTime() - Date.now()) / 3600000).toBeCloseTo(12, 0);

    const again = await ctx.request({ method: 'POST', url: '/api/v1/auth/courier/exchange', body: { token } });
    expectError(again, 400, 'invalid_link');
  });

  it('süresi dolmuş ya da kurye olmayan kullanıcının linki geçersiz', async () => {
    const t = await ctx.createTenantWithOwner();
    const { user } = await ctx.createStaff(t.tenantId, 'courier');
    const expired = await makeLink(t.tenantId, user.id, -1000);
    expectError(await ctx.request({ method: 'POST', url: '/api/v1/auth/courier/exchange', body: { token: expired } }), 400, 'invalid_link');
    const ownerLink = await makeLink(t.tenantId, t.owner.id);
    expectError(await ctx.request({ method: 'POST', url: '/api/v1/auth/courier/exchange', body: { token: ownerLink } }), 400, 'invalid_link');
  });
});

describe('yetki yardımcıları', () => {
  it('requireTenantRole rol listesi', async () => {
    const t = await ctx.createTenantWithOwner();
    const kitchen = await ctx.createStaff(t.tenantId, 'kitchen');
    expect((await ctx.request({ method: 'POST', url: '/api/v1/panel/__test/write', cookie: t.ownerCookie })).statusCode).toBe(200);
    expectError(await ctx.request({ method: 'POST', url: '/api/v1/panel/__test/write', cookie: kitchen.cookie }), 403, 'forbidden');
    expect((await ctx.request({ method: 'GET', url: '/api/v1/panel/__test/read', cookie: kitchen.cookie })).json()).toEqual({ role: 'kitchen' });
  });

  it('tenant seçilmemiş oturum → 403 tenant_required', async () => {
    const u = await ctx.createUser();
    const cookie = await ctx.sessionCookie(u.id, { tenantId: null });
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/panel/__test/read', cookie }), 403, 'tenant_required');
  });

  it('salt-okunur (impersonation) oturumda yazma → 403 read_only_session, okuma serbest', async () => {
    const t = await ctx.createTenantWithOwner();
    const admin = await ctx.createUser({ isPlatformAdmin: true, platformRole: 'support_agent' });
    const cookie = await ctx.sessionCookie(admin.id, { tenantId: t.tenantId, kind: 'impersonation', readOnly: true });
    await ctx.db.update(sessions).set({ impersonatorUserId: admin.id }).where(eq(sessions.tokenHash, sha256Hex(cookie.slice(4))));
    expectError(await ctx.request({ method: 'POST', url: '/api/v1/panel/__test/write', cookie }), 403, 'read_only_session');
    expect((await ctx.request({ method: 'GET', url: '/api/v1/panel/__test/read', cookie })).json()).toEqual({ role: 'owner' });
    const me = await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie });
    expect(me.json()).toMatchObject({ readOnly: true, impersonating: { tenantId: t.tenantId, impersonatorUserId: admin.id } });
    // Impersonation oturumuyla admin rotası kullanılamaz
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/admin/__test', cookie }), 403, 'forbidden');
  });

  it('requirePlatform: platform olmayan 403, rol uyumsuz 403, platform_owner geçer', async () => {
    const t = await ctx.createTenantWithOwner();
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/admin/__test', cookie: t.ownerCookie }), 403, 'forbidden');
    const finance = await ctx.createUser({ isPlatformAdmin: true, platformRole: 'finance' });
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/admin/__test', cookie: await ctx.sessionCookie(finance.id) }), 403, 'forbidden');
    const pa = await ctx.createUser({ isPlatformAdmin: true, platformRole: 'platform_admin' });
    expect((await ctx.request({ method: 'GET', url: '/api/v1/admin/__test', cookie: await ctx.sessionCookie(pa.id) })).statusCode).toBe(200);
  });

  it('bilinmeyen adres → 404 not_found (hata biçimi)', async () => {
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/yok-boyle-bir-yer' }), 404, 'not_found');
  });

  it('seed demo hesapları (sahip ve platform admini) giriş yapabilir', async () => {
    const { seedDemo, DEMO } = await import('@siparis/db');
    await seedDemo(ctx.db);
    const owner = DEMO.users.find((u) => u.role === 'owner')!;
    const login = await ctx.loginAs(owner.email, owner.password);
    const me = await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: login.cookie });
    expect(me.json()).toMatchObject({ role: 'owner', tenant: { slug: DEMO.tenantSlug } });
    const admin = await ctx.loginAs(DEMO.admin.email, DEMO.admin.password);
    expect(admin.res.json().isPlatformAdmin).toBe(true);
    const [t] = await ctx.db.select().from(tenants).where(eq(tenants.slug, DEMO.tenantSlug));
    expect(t!.orderSeq).toBeGreaterThan(1000);
  });
});
