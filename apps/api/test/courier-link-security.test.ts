// Kurye magic link ile hesap devralma engeli: platform yöneticisi personel/kurye eklenemez; giriş bağlantısı
// yalnız "yalnız kurye" hesaplara verilir (üretimde ve kullanımda ayrı kontrol); kurye oturumu platform yetkisi
// taşımaz, açıldığı işletmeye bağlıdır; platform yöneticisi parolayla girişte TOTP'yi kurye üyeliğiyle atlayamaz.
// Uygulama ADMIN_TOTP_REQUIRED=1 ile kurulur.

import { users } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptTotpSecret, generateTotpSecret } from '../src/services/auth/totp';
import { cookieFrom, createTestContext, expectError, testConfig, type TestContext, type TestTenant, type TestUser } from './helpers';

let ctx: TestContext;
let victim: TestTenant;
let attacker: TestTenant;
let admin: TestUser;

let ipSeq = 1;
const nextIp = () => `10.77.${Math.floor(ipSeq / 250) % 250}.${(ipSeq++ % 250) + 1}`;

const panel = (method: 'GET' | 'POST', url: string, cookie: string, body?: unknown) =>
  ctx.request({ method, url: `/api/v1/panel${url}`, cookie, body });

async function linkToken(tenant: TestTenant, userId: string): Promise<string> {
  const res = await panel('POST', `/couriers/${userId}/login-link`, tenant.ownerCookie);
  expect(res.statusCode, res.body).toBe(201);
  return decodeURIComponent(new URL((res.json() as { url: string }).url).searchParams.get('t')!);
}

function exchange(token: string) {
  return ctx.request({ method: 'POST', url: '/api/v1/auth/courier/exchange', body: { token }, headers: { 'x-forwarded-for': nextIp() } });
}

beforeAll(async () => {
  ctx = await createTestContext({ config: testConfig({ ADMIN_TOTP_REQUIRED: '1' }) });
  victim = await ctx.createTenantWithOwner({ name: 'Mağdur Pide' });
  attacker = await ctx.createTenantWithOwner({ name: 'Saldırgan Döner' });
  admin = await ctx.createUser({ name: 'Platform Yönetici', phone: '+905550000001', isPlatformAdmin: true, platformRole: 'platform_owner' });
});

afterAll(async () => {
  await ctx.close();
});

describe('kurye giriş bağlantısı ile hesap devralma', () => {
  it('platform yöneticisi e-posta ya da telefonla personel/kurye olarak eklenemez', async () => {
    const byEmail = await panel('POST', '/staff', attacker.ownerCookie, { name: 'Yeni Kurye', email: admin.email, role: 'courier' });
    expectError(byEmail, 409, 'account_not_allowed');
    const byPhone = await panel('POST', '/staff', attacker.ownerCookie, { name: 'Yeni Yönetici', phone: '0555 000 00 01', role: 'manager', password: 'parola123' });
    expectError(byPhone, 409, 'account_not_allowed');
  });

  it('kurye üyeliği olan platform yöneticisine bağlantı verilmez; kurye oturumu yönetim uçlarına giremez', async () => {
    // Eski veri ya da elle eklenmiş üyelik: bağlantı üretimi yine reddedilir
    await ctx.addMember(attacker.tenantId, admin.id, 'courier');
    expectError(await panel('POST', `/couriers/${admin.id}/login-link`, attacker.ownerCookie), 409, 'courier_link_not_allowed');

    const courierCookie = await ctx.sessionCookie(admin.id, { tenantId: attacker.tenantId, kind: 'courier' });
    const me = await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: courierCookie });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json()).toMatchObject({ isPlatformAdmin: false, user: { isPlatformAdmin: false, platformRole: null } });
    for (const url of ['/api/v1/admin/overview', '/api/v1/admin/tenants', '/api/v1/admin/flags']) {
      expectError(await ctx.request({ method: 'GET', url, cookie: courierCookie }), 403, 'forbidden');
    }
  });

  it('platform yöneticisi parolayla girişte kurye üyeliğiyle TOTP adımını atlayamaz', async () => {
    await ctx.db
      .update(users)
      .set({ totpSecretEnc: encryptTotpSecret(ctx.config, generateTotpSecret()), totpEnabledAt: new Date() })
      .where(eq(users.id, admin.id));
    const res = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { login: admin.email, password: admin.password },
      headers: { 'x-forwarded-for': nextIp() },
    });
    expectError(res, 401, 'totp_required');
  });

  it('başka işletmede sahip olan hesap kurye eklenebilir ama giriş bağlantısı verilmez', async () => {
    const add = await panel('POST', '/staff', attacker.ownerCookie, { name: 'Sahip', email: victim.owner.email, role: 'courier' });
    expect(add.statusCode, add.body).toBe(201);
    expect(add.json()).toMatchObject({ existingUser: true, staff: { sharedAccount: true } });
    expectError(await panel('POST', `/couriers/${victim.owner.id}/login-link`, attacker.ownerCookie), 409, 'courier_link_not_allowed');
  });

  it('bağlantı üretildikten sonra hesap bağlantıya uygun olmaktan çıkarsa exchange reddedilir', async () => {
    const add = await panel('POST', '/staff', attacker.ownerCookie, { name: 'Yeni Kurye', phone: '0533 111 22 33', role: 'courier', password: 'kurye-parola-1' });
    expect(add.statusCode, add.body).toBe(201);
    const courierId = (add.json() as { staff: { userId: string } }).staff.userId;
    const token = await linkToken(attacker, courierId);
    // Parolalı hesap başka işletmede kurye dışı rol kazandı → bağlantı artık geçersiz
    await ctx.addMember(victim.tenantId, courierId, 'manager');
    expectError(await exchange(token), 400, 'invalid_link');
    expectError(await panel('POST', `/couriers/${courierId}/login-link`, attacker.ownerCookie), 409, 'courier_link_not_allowed');
    // Platform yöneticisine dönüşen hesap da bağlantıyla giremez
    const add2 = await panel('POST', '/staff', attacker.ownerCookie, { name: 'İkinci Kurye', phone: '0533 111 22 34', role: 'courier' });
    const courier2 = (add2.json() as { staff: { userId: string } }).staff.userId;
    const token2 = await linkToken(attacker, courier2);
    await ctx.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, courier2));
    expectError(await exchange(token2), 400, 'invalid_link');
  });

  it('parolasız kurye başka işletmede kurye dışı rolle eklense de bağlantısı çalışır; oturum yalnız kurye rolünde', async () => {
    const add = await panel('POST', '/staff', victim.ownerCookie, { name: 'Parolasız Kurye', phone: '0533 111 22 35', role: 'courier' });
    const courierId = (add.json() as { staff: { userId: string } }).staff.userId;
    // Başka işletme bu kişiyi yönetici olarak eklese de (hizmet engelleme denemesi) mağdur işletme bağlantı verebilir
    const hostile = await panel('POST', '/staff', attacker.ownerCookie, { name: 'X Kişi', phone: '0533 111 22 35', role: 'manager', password: 'baska-parola' });
    expect(hostile.statusCode, hostile.body).toBe(201);
    const ex = await exchange(await linkToken(victim, courierId));
    expect(ex.statusCode, ex.body).toBe(200);
    expect(ex.json()).toMatchObject({ role: 'courier', tenant: { id: victim.tenantId } });
    expect((ex.json() as { memberships: { tenantId: string }[] }).memberships.map((m) => m.tenantId)).toEqual([victim.tenantId]);
    // Saldırganın işletmesi aynı hesaba (kurye olmadığı için) bağlantı üretemez
    expectError(await panel('POST', `/couriers/${courierId}/login-link`, attacker.ownerCookie), 404, 'not_found');
  });

  it('iki işletmede kurye olan hesap: oturum bağlantının işletmesine bağlı; diğer üyelik görünmez, geçiş 403', async () => {
    const add = await panel('POST', '/staff', victim.ownerCookie, { name: 'Ortak Kurye', phone: '0533 999 88 77', role: 'courier' });
    expect(add.statusCode, add.body).toBe(201);
    const courierId = (add.json() as { staff: { userId: string } }).staff.userId;
    const again = await panel('POST', '/staff', attacker.ownerCookie, { name: 'Ortak Kurye', phone: '0533 999 88 77', role: 'courier' });
    expect(again.statusCode, again.body).toBe(201);

    const ex = await exchange(await linkToken(attacker, courierId));
    expect(ex.statusCode, ex.body).toBe(200);
    expect(ex.json()).toMatchObject({ role: 'courier', tenant: { id: attacker.tenantId } });
    expect((ex.json() as { memberships: { tenantId: string }[] }).memberships.map((m) => m.tenantId)).toEqual([attacker.tenantId]);
    const cookie = cookieFrom(ex);
    const sw = await ctx.request({ method: 'POST', url: '/api/v1/auth/switch-tenant', cookie, body: { tenantId: victim.tenantId } });
    expectError(sw, 403, 'forbidden');
    const courierOrders = await ctx.request({ method: 'GET', url: '/api/v1/courier/orders', cookie });
    expect(courierOrders.statusCode, courierOrders.body).toBe(200);
  });
});
