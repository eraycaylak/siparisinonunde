// Dilim 4 — personel ve kuryeler: ekleme (mevcut kullanıcıya üyelik), rol, parola sıfırlama, devre dışı,
// kaldırma (son sahip korunur), kurye giriş bağlantısı + /auth/courier/exchange uyumu; yetki ve yalıtım.

import { auditLog, courierLoginLinks, memberships, sessions } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieFrom, createTestContext, expectError, type TestContext, type TestTenant } from './helpers';
import { insertOrder } from './settings-helpers';

let ctx: TestContext;
let a: TestTenant;
let b: TestTenant;
let manager: { user: { id: string }; cookie: string };
let cashier: { user: { id: string }; cookie: string };

const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, body?: unknown) =>
  ctx.request({ method, url: `/api/v1/panel${url}`, cookie, body });

beforeAll(async () => {
  ctx = await createTestContext();
  a = await ctx.createTenantWithOwner({ name: 'A Döner' });
  b = await ctx.createTenantWithOwner({ name: 'B Lahmacun' });
  manager = await ctx.createStaff(a.tenantId, 'manager');
  cashier = await ctx.createStaff(a.tenantId, 'cashier');
});

afterAll(async () => {
  await ctx.close();
});

describe('personel', () => {
  let newUserId: string;

  it('liste: sahip ve yönetici görür; kasiyer 403', async () => {
    const res = await req('GET', '/staff', a.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json().items as { role: string; isSelf: boolean }[];
    expect(items.map((i) => i.role)).toEqual(['owner', 'manager', 'cashier']);
    expect(items[0]!.isSelf).toBe(true);
    expect((await req('GET', '/staff', manager.cookie)).statusCode).toBe(200);
    expectError(await req('GET', '/staff', cashier.cookie), 403, 'forbidden');
  });

  it('ekleme: yeni kullanıcı parolayla giriş yapabilir; doğrulama hataları', async () => {
    const res = await req('POST', '/staff', manager.cookie, { name: 'Can Kasa', email: 'Can@Ornek.com', phone: '0532 111 22 33', role: 'cashier', password: 'kasa12345' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ existingUser: false, staff: { name: 'Can Kasa', email: 'can@ornek.com', phone: '+905321112233', role: 'cashier', disabled: false } });
    newUserId = res.json().staff.userId;
    const login = await ctx.loginAs('can@ornek.com', 'kasa12345');
    expect(login.res.json().memberships[0]).toMatchObject({ tenantId: a.tenantId, role: 'cashier' });

    expectError(await req('POST', '/staff', a.ownerCookie, { name: 'X Y', role: 'owner', email: 'x@y.com', password: '12345678' }), 400, 'validation_error');
    expectError(await req('POST', '/staff', a.ownerCookie, { name: 'X Y', role: 'cashier', password: '12345678' }), 400, 'validation_error');
    expectError(await req('POST', '/staff', a.ownerCookie, { name: 'X Y', role: 'cashier', email: 'kisa@y.com', password: '123' }), 400, 'validation_error');
    expectError(await req('POST', '/staff', a.ownerCookie, { name: 'X Y', role: 'kitchen', email: 'parolasiz@y.com' }), 400, 'validation_error');
    expectError(await req('POST', '/staff', a.ownerCookie, { name: 'X Y', role: 'cashier', phone: '123', password: '12345678' }), 400, 'validation_error');
    expectError(await req('POST', '/staff', a.ownerCookie, { name: 'Can Kasa', email: 'can@ornek.com', role: 'kitchen', password: '12345678' }), 409, 'already_member');
    expectError(await req('POST', '/staff', cashier.cookie, { name: 'X Y', role: 'kitchen', email: 'k@y.com', password: '12345678' }), 403, 'forbidden');
  });

  it('başka işletmede kayıtlı kullanıcı üyelik olarak eklenir; parolası değişmez, ad/parola buradan değiştirilemez', async () => {
    const res = await req('POST', '/staff', b.ownerCookie, { name: 'Başka Ad', email: 'can@ornek.com', role: 'kitchen', password: 'baskaparola' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ existingUser: true, staff: { name: 'Can Kasa', role: 'kitchen', sharedAccount: true } });
    // Eski parola hâlâ geçerli
    const login = await ctx.loginAs('can@ornek.com', 'kasa12345');
    expect(login.res.json().memberships).toHaveLength(2);
    // İşletmeler arası ele geçirme engeli: A sahibi ortak hesabın parolasını sıfırlayamaz
    expectError(await req('PATCH', `/staff/${newUserId}`, a.ownerCookie, { password: 'yeniparola1' }), 409, 'shared_account');
    expectError(await req('PATCH', `/staff/${newUserId}`, a.ownerCookie, { name: 'Değişti' }), 409, 'shared_account');
  });

  it('rol değiştirme, devre dışı bırakma (oturum düşer), yeniden etkinleştirme', async () => {
    const kitchen = await ctx.createStaff(a.tenantId, 'kitchen');
    const up = await req('PATCH', `/staff/${kitchen.user.id}`, manager.cookie, { role: 'cashier' });
    expect(up.statusCode, up.body).toBe(200);
    expect(up.json().role).toBe('cashier');

    const cookie = await ctx.sessionCookie(kitchen.user.id, { tenantId: a.tenantId });
    expect((await ctx.request({ method: 'GET', url: '/api/v1/panel/customers', cookie })).statusCode).toBe(200);
    const dis = await req('PATCH', `/staff/${kitchen.user.id}`, a.ownerCookie, { disabled: true });
    expect(dis.json().disabled).toBe(true);
    const left = await ctx.db.select().from(sessions).where(and(eq(sessions.userId, kitchen.user.id), eq(sessions.tenantId, a.tenantId)));
    expect(left).toHaveLength(0);
    expect((await ctx.request({ method: 'GET', url: '/api/v1/panel/customers', cookie })).statusCode).toBe(401);

    const en = await req('PATCH', `/staff/${kitchen.user.id}`, a.ownerCookie, { disabled: false, password: 'yenisifre99' });
    expect(en.statusCode, en.body).toBe(200);
    expect(en.json().disabled).toBe(false);
    const login = await ctx.loginAs(en.json().email, 'yenisifre99');
    expect(login.res.statusCode).toBe(200);

    const logs = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, a.tenantId), eq(auditLog.action, 'staff.update')));
    expect(logs.length).toBeGreaterThanOrEqual(3);
  });

  it('sahip koruması: yönetici sahibe dokunamaz, son sahip kaldırılamaz, kendini değiştiremez', async () => {
    expectError(await req('PATCH', `/staff/${a.owner.id}`, manager.cookie, { disabled: true }), 403, 'forbidden');
    expectError(await req('DELETE', `/staff/${a.owner.id}`, manager.cookie), 403, 'forbidden');
    expectError(await req('PATCH', `/staff/${manager.user.id}`, manager.cookie, { role: 'owner' }), 409, 'self_change');
    expectError(await req('PATCH', `/staff/${cashier.user.id}`, manager.cookie, { role: 'owner' }), 403, 'forbidden');
    expectError(await req('DELETE', `/staff/${a.owner.id}`, a.ownerCookie), 409, 'self_change');

    // İkinci sahip eklenirse ilk sahip kaldırılabilir ama son sahip kalamaz
    const second = await ctx.createStaff(a.tenantId, 'owner');
    const secondCookie = await ctx.sessionCookie(second.user.id, { tenantId: a.tenantId });
    const del = await req('DELETE', `/staff/${second.user.id}`, a.ownerCookie);
    expect(del.statusCode, del.body).toBe(200);
    const [m] = await ctx.db.select().from(memberships).where(and(eq(memberships.tenantId, a.tenantId), eq(memberships.userId, second.user.id)));
    expect(m).toBeUndefined();
    expect((await ctx.request({ method: 'GET', url: '/api/v1/panel/staff', cookie: secondCookie })).statusCode).toBe(401);
  });

  it('yalıtım: başka tenant\'ın personeli 404', async () => {
    expectError(await req('PATCH', `/staff/${b.owner.id}`, a.ownerCookie, { disabled: true }), 404, 'not_found');
    expectError(await req('DELETE', `/staff/${b.owner.id}`, a.ownerCookie), 404, 'not_found');
    const list = await req('GET', '/staff', b.ownerCookie);
    expect(list.json().items.map((i: { userId: string }) => i.userId)).not.toContain(manager.user.id);
  });
});

describe('kuryeler ve giriş bağlantısı', () => {
  let courierId: string;

  it('kurye ekle (parolasız), liste ve aktif atamalar', async () => {
    const res = await req('POST', '/staff', a.ownerCookie, { name: 'Burak Kurye', phone: '0533 444 55 66', role: 'courier' });
    expect(res.statusCode, res.body).toBe(201);
    courierId = res.json().staff.userId;
    await insertOrder(ctx.db, { tenantId: a.tenantId, branchId: a.branchId, status: 'on_the_way', deliveryFeeKurus: 1500, extra: { courierUserId: courierId } });
    await insertOrder(ctx.db, { tenantId: a.tenantId, branchId: a.branchId, status: 'delivered', deliveryFeeKurus: 1500, extra: { courierUserId: courierId } });
    const list = await req('GET', '/couriers', cashier.cookie);
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0]).toMatchObject({ userId: courierId, name: 'Burak Kurye', deliveredToday: 1, activeSession: false });
    expect(list.json().items[0].activeOrders).toHaveLength(1);
    expect((await req('GET', '/couriers', b.ownerCookie)).json().items).toHaveLength(0);
  });

  it('giriş bağlantısı: 15 dk, tek kullanımlık, exchange ile kurye oturumu', async () => {
    const res = await req('POST', `/couriers/${courierId}/login-link`, manager.cookie);
    expect(res.statusCode, res.body).toBe(201);
    const { url, expiresAt } = res.json() as { url: string; expiresAt: string };
    expect(url.startsWith('http://localhost:3000/kurye/giris?t=')).toBe(true);
    const ttl = Date.parse(expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000);
    const token = decodeURIComponent(new URL(url).searchParams.get('t')!);
    const [link] = await ctx.db.select().from(courierLoginLinks).where(eq(courierLoginLinks.userId, courierId));
    expect(link!.tokenHash).not.toBe(token);

    const ex = await ctx.request({ method: 'POST', url: '/api/v1/auth/courier/exchange', body: { token }, headers: { 'x-forwarded-for': '10.9.9.1' } });
    expect(ex.statusCode, ex.body).toBe(200);
    expect(ex.json()).toMatchObject({ role: 'courier', tenant: { id: a.tenantId } });
    const courierCookie = cookieFrom(ex);
    const again = await ctx.request({ method: 'POST', url: '/api/v1/auth/courier/exchange', body: { token }, headers: { 'x-forwarded-for': '10.9.9.2' } });
    expectError(again, 400, 'invalid_link');

    const list = await req('GET', '/couriers', a.ownerCookie);
    expect(list.json().items[0].activeSession).toBe(true);
    const out = await req('POST', `/couriers/${courierId}/logout`, a.ownerCookie);
    expect(out.json()).toMatchObject({ ok: true, closedSessions: 1 });
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: courierCookie }), 401, 'unauthorized');
    const logs = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, a.tenantId), eq(auditLog.action, 'courier.login_link')));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0]!.data)).not.toContain(token);
  });

  it('yetki ve yalıtım: kasiyer bağlantı üretemez; kurye olmayan / başka tenant 404; devre dışı kurye 409', async () => {
    expectError(await req('POST', `/couriers/${courierId}/login-link`, cashier.cookie), 403, 'forbidden');
    expectError(await req('POST', `/couriers/${cashier.user.id}/login-link`, a.ownerCookie), 404, 'not_found');
    expectError(await req('POST', `/couriers/${courierId}/login-link`, b.ownerCookie), 404, 'not_found');
    await req('PATCH', `/staff/${courierId}`, a.ownerCookie, { disabled: true });
    expectError(await req('POST', `/couriers/${courierId}/login-link`, a.ownerCookie), 409, 'courier_disabled');
  });
});
