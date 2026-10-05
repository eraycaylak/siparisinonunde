// Admin operasyon açıkları (denetim Faz 3.11 + 3.12 + destek erişimi):
//   1. Parola sıfırlama (H29): yetki, gerekçe, denetim kaydı, oturum kapatma, tek seferlik parola, hız sınırı.
//   2. Destek erişimi bildirimi: işletme kendi oturumuyla açık/geçmiş erişimi görür, başka işletmenin kaydını görmez.
//   3. Onboarding hunisi (H28): işletme listesinde kurulum adımı, son hareket ve "takıldı" görünümü.
//
// NOT: testler çalıştırılmadı (paylaşılan test veritabanı). `ALLOW_DB_RESET=1 pnpm test` ile koşulur.

import { ADMIN_ONBOARDING_STUCK_HOURS } from '@siparis/core/admin/onboarding';
import { auditLog, memberships, notifications, sessions, tenantOnboarding, tenants, users } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateRecoveryPassword } from '../src/services/admin/recovery';
import { createPlatformUsers, type PlatformUsers } from './admin-helpers';
import { createTestContext, expectError, type TestContext, type TestTenant } from './helpers';

let ctx: TestContext;
let p: PlatformUsers;
let a: TestTenant;
let b: TestTenant;

const API = '/api/v1/admin';
const REASON = 'Sahip parolasını unuttu, telefonda kimliği doğrulandı (DST-128)';

function cookiesOf(res: LightMyRequestResponse) {
  return Object.fromEntries(res.cookies.map((c) => [c.name, c]));
}

const resetUrl = (tenantId: string, userId: string) => `${API}/tenants/${tenantId}/members/${userId}/reset-password`;

const reset = (cookie: string | undefined, tenantId: string, userId: string, body: unknown = { reason: REASON }) =>
  ctx.request({ method: 'POST', url: resetUrl(tenantId, userId), cookie, body });

const notices = (cookie?: string) => ctx.request({ method: 'GET', url: `${API}/support-access/notices`, cookie });

/**
 * Hız sınırı bütçesi testler arasında paylaşılır (bellek içi, yönetici başına 5/saat). Bütçe harcayan testler
 * kendi yöneticisini açar; aksi halde sıralama değişince alakasız bir test 429 alır.
 */
async function freshAdmin(): Promise<string> {
  const user = await ctx.createUser({ name: 'Ek Platform Yöneticisi', isPlatformAdmin: true, platformRole: 'platform_admin' });
  return ctx.sessionCookie(user.id);
}

const impersonate = (cookie: string, tenantId: string) =>
  ctx.request({
    method: 'POST',
    url: `${API}/tenants/${tenantId}/impersonate`,
    cookie,
    body: { reason: 'Sipariş düşmüyor şikayeti, panel kontrolü' },
  });

beforeAll(async () => {
  ctx = await createTestContext();
  p = await createPlatformUsers(ctx);
  a = await ctx.createTenantWithOwner({ name: 'Kurtarma İşletmesi' });
  b = await ctx.createTenantWithOwner({ name: 'Komşu İşletme' });
});

afterAll(async () => {
  await ctx.close();
});

// ---------------------------------------------------------------------------

describe('üretilen kurtarma parolası', () => {
  it('biçim: 3×4 karakter, karışan karakter yok, her çağrıda farklı', () => {
    const one = generateRecoveryPassword();
    expect(one).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // Parola alt sınırı 8 (contracts/auth): tireler hariç 12 karakter
    expect(one.replace(/-/g, '')).toHaveLength(12);
    // Birbirine benzeyen karakterler alfabede yok: 0/O, 1/I/L, 5/S, 2/Z
    expect(one).not.toMatch(/[0O1IL5S2Z]/);
    const many = new Set(Array.from({ length: 50 }, () => generateRecoveryPassword()));
    expect(many.size).toBe(50);
  });
});

describe('POST /admin/tenants/:id/members/:userId/reset-password — yetki', () => {
  it('yalnız platform yöneticisi: SA/F/SR 403, işletme kullanıcısı 403, oturumsuz 401', async () => {
    expectError(await reset(p.support_agent.cookie, a.tenantId, a.owner.id), 403, 'forbidden');
    expectError(await reset(p.finance.cookie, a.tenantId, a.owner.id), 403, 'forbidden');
    expectError(await reset(p.sales_rep.cookie, a.tenantId, a.owner.id), 403, 'forbidden');
    expectError(await reset(a.ownerCookie, a.tenantId, a.owner.id), 403, 'forbidden');
    expectError(await reset(undefined, a.tenantId, a.owner.id), 401, 'unauthorized');
  });

  it('destek oturumu (salt-okunur) sıfırlayamaz', async () => {
    const imp = await impersonate(p.platform_admin.cookie, a.tenantId);
    expect(imp.statusCode, imp.body).toBe(200);
    const c = cookiesOf(imp);
    expectError(await reset(`sid=${c.sid!.value}`, a.tenantId, a.owner.id), 403, 'forbidden');
    // Admin oturumunu geri yükle (sonraki testler platform_admin çerezini kullanıyor)
    await ctx.request({ method: 'POST', url: `${API}/impersonation/end`, cookie: `sid=${c.sid!.value}; sid_admin=${c.sid_admin!.value}`, body: {} });
  });

  it('gerekçe en az 10 karakter; olmayan işletme 404; başka işletmenin üyesi 404 (tenant yalıtımı)', async () => {
    expectError(await reset(p.platform_admin.cookie, a.tenantId, a.owner.id, { reason: 'kısa' }), 400, 'validation_error');
    expectError(await reset(p.platform_admin.cookie, a.tenantId, a.owner.id, {}), 400, 'validation_error');
    expectError(await reset(p.platform_admin.cookie, '00000000-0000-4000-8000-000000000000', a.owner.id), 404, 'not_found');
    // b'nin sahibi a'nın üyesi değil: a bağlamında bulunamaz
    expectError(await reset(p.platform_admin.cookie, a.tenantId, b.owner.id), 404, 'not_found');
  });

  it('platform yönetim hesabı bu yoldan sıfırlanamaz (409)', async () => {
    // Platform hesabı bir işletmeye üye yapılırsa dahi parolası buradan değişmez
    await ctx.addMember(a.tenantId, p.support_agent.user.id, 'manager');
    expectError(await reset(p.platform_admin.cookie, a.tenantId, p.support_agent.user.id), 409, 'platform_account');
    await ctx.db.delete(memberships).where(and(eq(memberships.tenantId, a.tenantId), eq(memberships.userId, p.support_agent.user.id)));
  });

  it('kapatılmış hesabın parolası sıfırlanamaz (409)', async () => {
    const t = await ctx.createTenantWithOwner({ name: 'Kapalı Hesap' });
    await ctx.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, t.owner.id));
    expectError(await reset(p.platform_admin.cookie, t.tenantId, t.owner.id), 409, 'user_disabled');
  });
});

describe('POST .../reset-password — başarılı yol', () => {
  it('tek seferlik parola döner, oturumlar kapanır, yeni parola çalışır, denetim kaydı parolayı YAZMAZ', async () => {
    const t = await ctx.createTenantWithOwner({ name: 'Parola Sıfırlama' });
    // Sahibin iki açık oturumu olsun (iki cihaz)
    const second = await ctx.sessionCookie(t.owner.id, { tenantId: t.tenantId });
    expect((await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: second })).statusCode).toBe(200);
    const before = await ctx.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, t.owner.id));
    expect(before.length).toBeGreaterThanOrEqual(2);

    const admin = await freshAdmin();
    const res = await reset(admin, t.tenantId, t.owner.id);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { password: string; userId: string; userName: string; sessionsEnded: number; otherTenantCount: number };
    expect(body).toMatchObject({ ok: true, userId: t.owner.id, userName: t.owner.name, otherTenantCount: 0 });
    expect(body.password).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.sessionsEnded).toBe(before.length);
    // Yanıt önbelleğe alınmaz (tek seferlik sır)
    expect(res.headers['cache-control']).toBe('no-store');

    // Tüm oturumlar kapandı
    const after = await ctx.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, t.owner.id));
    expect(after).toHaveLength(0);
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: second }), 401, 'unauthorized');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: t.ownerCookie }), 401, 'unauthorized');

    // Eski parola artık çalışmaz, yeni parola çalışır
    const old = await ctx.request({ method: 'POST', url: '/api/v1/auth/login', body: { login: t.owner.email, password: t.owner.password } });
    expect(old.statusCode).not.toBe(200);
    const login = await ctx.loginAs(t.owner.email, body.password);
    expect(login.res.statusCode).toBe(200);

    // Denetim kaydı: gerekçe var, ÜRETİLEN PAROLA yok
    const [log] = await ctx.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'admin.user_password_reset'), eq(auditLog.entityId, t.owner.id)));
    expect(log).toMatchObject({ tenantId: t.tenantId, entityType: 'user' });
    expect(log!.data).toMatchObject({ reason: REASON, targetRole: 'owner', sessionsEnded: before.length, otherTenantCount: 0 });
    expect(JSON.stringify(log!.data)).not.toContain(body.password);

    // İşletmeye kayıt düşer (panelde görünür)
    const note = await ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.tenantId, t.tenantId), eq(notifications.kind, 'support_access_password_reset')));
    expect(note).toHaveLength(1);
    expect(note[0]).toMatchObject({ recipientUserId: t.owner.id, channel: 'log', status: 'sent' });
    expect(note[0]!.payload).toMatchObject({ supportAgentName: 'Ek Platform Yöneticisi', targetUserName: t.owner.name });
    expect(JSON.stringify(note[0]!.payload)).not.toContain(body.password);
  });

  it('başka işletmelerde de üye olan hesapta otherTenantCount dolu (parola her yerde değişti)', async () => {
    const t = await ctx.createTenantWithOwner({ name: 'Paylaşılan Hesap' });
    const other = await ctx.createTenantWithOwner({ name: 'İkinci Dükkan' });
    await ctx.addMember(other.tenantId, t.owner.id, 'manager');
    const res = await reset(await freshAdmin(), t.tenantId, t.owner.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().otherTenantCount).toBe(1);
  });

  it('aynı hedefte hız sınırı: 4. deneme 429', async () => {
    const t = await ctx.createTenantWithOwner({ name: 'Hız Sınırı' });
    const admin = await freshAdmin();
    for (let i = 0; i < 3; i++) {
      const ok = await reset(admin, t.tenantId, t.owner.id);
      expect(ok.statusCode, ok.body).toBe(200);
    }
    expectError(await reset(admin, t.tenantId, t.owner.id), 429, 'rate_limited');
  });
});

// ---------------------------------------------------------------------------

describe('GET /admin/support-access/notices — işletme destek erişiminden haberdar', () => {
  it('oturumsuz 401; işletme seçili olmayan platform oturumu 403; düşük rol 403', async () => {
    expectError(await notices(), 401, 'unauthorized');
    expectError(await notices(p.platform_admin.cookie), 403, 'tenant_required');
    const cashier = await ctx.createStaff(a.tenantId, 'cashier');
    expectError(await notices(cashier.cookie), 403, 'forbidden');
  });

  it('erişim yokken boş; açıkken `active` dolu; bitince kapanış kaydı listede', async () => {
    const t = await ctx.createTenantWithOwner({ name: 'Bildirim İşletmesi' });

    const empty = await notices(t.ownerCookie);
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json()).toMatchObject({ active: [], notices: [] });

    const imp = await impersonate(p.support_agent.cookie, t.tenantId);
    expect(imp.statusCode, imp.body).toBe(200);
    const c = cookiesOf(imp);

    const live = await notices(t.ownerCookie);
    expect(live.statusCode, live.body).toBe(200);
    const liveBody = live.json() as { active: { sessionId: string; supportAgentName: string }[]; notices: { kind: string }[] };
    expect(liveBody.active).toHaveLength(1);
    expect(liveBody.active[0]).toMatchObject({ sessionId: imp.json().sessionId, supportAgentName: p.support_agent.user.name });
    expect(liveBody.notices[0]).toMatchObject({ kind: 'started', supportAgentName: p.support_agent.user.name });
    expect(liveBody.notices[0]).toHaveProperty('expiresAt', imp.json().expiresAt);

    const end = await ctx.request({
      method: 'POST',
      url: `${API}/impersonation/end`,
      cookie: `sid=${c.sid!.value}; sid_admin=${c.sid_admin!.value}`,
      body: {},
    });
    expect(end.statusCode, end.body).toBe(200);
    expect(end.json().ended).toBe(1);

    // Kapanış kaydı yazıldı ve `active` boşaldı
    const closed = await notices(t.ownerCookie);
    const closedBody = closed.json() as { active: unknown[]; notices: { kind: string; supportAgentName: string }[] };
    expect(closedBody.active).toHaveLength(0);
    expect(closedBody.notices[0]).toMatchObject({ kind: 'ended', supportAgentName: p.support_agent.user.name });
    expect(closedBody.notices[1]).toMatchObject({ kind: 'started' });

    const rows = await ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.tenantId, t.tenantId), eq(notifications.kind, 'support_access_ended')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientUserId: t.owner.id, channel: 'log', status: 'sent' });
    expect(rows[0]!.payload).toMatchObject({ endedBy: 'support_session' });
    // Gerekçe işletmeye gösterilmez (serbest metin müşteri bilgisi içerebilir)
    expect(JSON.stringify(closedBody.notices)).not.toContain('şikayeti');
  });

  it('admin oturumundan bitirmede de kapanış kaydı yazılır', async () => {
    const t = await ctx.createTenantWithOwner({ name: 'Admin Bitirme' });
    const imp = await impersonate(p.platform_owner.cookie, t.tenantId);
    expect(imp.statusCode, imp.body).toBe(200);
    const end = await ctx.request({ method: 'POST', url: `${API}/impersonation/end`, cookie: p.platform_owner.cookie, body: {} });
    expect(end.statusCode, end.body).toBe(200);
    const rows = await ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.tenantId, t.tenantId), eq(notifications.kind, 'support_access_ended')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ endedBy: 'admin_session', supportAgentName: p.platform_owner.user.name });
  });

  it('tenant yalıtımı: komşu işletmenin sahibi bu kayıtları görmez', async () => {
    const t = await ctx.createTenantWithOwner({ name: 'Yalıtım A' });
    const neighbour = await ctx.createTenantWithOwner({ name: 'Yalıtım B' });
    const imp = await impersonate(p.platform_admin.cookie, t.tenantId);
    expect(imp.statusCode, imp.body).toBe(200);

    const mine = await notices(t.ownerCookie);
    expect(mine.json().active).toHaveLength(1);
    const theirs = await notices(neighbour.ownerCookie);
    expect(theirs.statusCode, theirs.body).toBe(200);
    expect(theirs.json()).toMatchObject({ active: [], notices: [] });

    const c = cookiesOf(imp);
    await ctx.request({ method: 'POST', url: `${API}/impersonation/end`, cookie: `sid=${c.sid!.value}; sid_admin=${c.sid_admin!.value}`, body: {} });
  });

  it('başka sahibe yazılmış kayıt üçüncü bir üyeye görünmez (alıcı süzmesi)', async () => {
    const t = await ctx.createTenantWithOwner({ name: 'Alıcı Süzmesi' });
    const manager = await ctx.createStaff(t.tenantId, 'manager');
    const imp = await impersonate(p.platform_admin.cookie, t.tenantId);
    expect(imp.statusCode, imp.body).toBe(200);
    // Yönetici açık oturumu GÖRÜR (canlı gerçek `sessions`'tan okunur)…
    const mgr = await notices(manager.cookie);
    expect(mgr.statusCode, mgr.body).toBe(200);
    expect(mgr.json().active).toHaveLength(1);
    // …ama sahibe yazılmış bildirim satırı listesine düşmez
    expect(mgr.json().notices).toHaveLength(0);
    const own = await notices(t.ownerCookie);
    expect(own.json().notices).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('GET /admin/tenants — onboarding hunisi (H28)', () => {
  const list = (cookie: string, query = '') => ctx.request({ method: 'GET', url: `${API}/tenants${query}`, cookie });
  const find = (res: LightMyRequestResponse, tenantId: string) =>
    (res.json().items as { id: string; onboardingStep: string; onboardingStuck: boolean; onboardingStepAt: string; lastActivityAt: string | null }[]).find(
      (t) => t.id === tenantId,
    );

  it('huni satırı yoksa adım account_created, takılmamış (yeni kayıt), son hareket null', async () => {
    const t = await ctx.createTenantWithOwner({ name: 'Yeni Kayıt' });
    const res = await list(p.platform_admin.cookie, '?limit=100');
    expect(res.statusCode, res.body).toBe(200);
    const row = find(res, t.tenantId);
    expect(row).toMatchObject({ onboardingStep: 'account_created', onboardingStuck: false, lastActivityAt: null });
    // Satır yoksa "ne zamandan beri bu adımda" = kayıt anı
    expect(Date.parse(row!.onboardingStepAt)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('adım 48 saatten uzun değişmediyse takıldı; stuck=1 yalnız onları döner', async () => {
    const stuckT = await ctx.createTenantWithOwner({ name: 'Takılan Dükkan' });
    const freshT = await ctx.createTenantWithOwner({ name: 'Taze Dükkan' });
    const old = new Date(Date.now() - (ADMIN_ONBOARDING_STUCK_HOURS + 6) * 3600_000);
    await ctx.db.insert(tenantOnboarding).values({ tenantId: stuckT.tenantId, step: 'menu_done', updatedAt: old });
    await ctx.db.insert(tenantOnboarding).values({ tenantId: freshT.tenantId, step: 'menu_done' });

    const all = await list(p.platform_admin.cookie, '?limit=100');
    expect(find(all, stuckT.tenantId)).toMatchObject({ onboardingStep: 'menu_done', onboardingStuck: true });
    expect(find(all, freshT.tenantId)).toMatchObject({ onboardingStep: 'menu_done', onboardingStuck: false });

    const only = await list(p.platform_admin.cookie, '?stuck=1&limit=100');
    expect(only.statusCode, only.body).toBe(200);
    const ids = (only.json().items as { id: string }[]).map((t) => t.id);
    expect(ids).toContain(stuckT.tenantId);
    expect(ids).not.toContain(freshT.tenantId);
    // Takılan görünümünde her satır gerçekten takılmış
    expect((only.json().items as { onboardingStuck: boolean }[]).every((t) => t.onboardingStuck)).toBe(true);
  });

  it('canlı, askıda ve kapanmış işletme takılmış sayılmaz', async () => {
    const old = new Date(Date.now() - (ADMIN_ONBOARDING_STUCK_HOURS + 6) * 3600_000);
    const live = await ctx.createTenantWithOwner({ name: 'Canlı Dükkan' });
    const suspended = await ctx.createTenantWithOwner({ name: 'Askıdaki Dükkan' });
    const churned = await ctx.createTenantWithOwner({ name: 'Kapanan Dükkan' });
    await ctx.db.insert(tenantOnboarding).values(
      [live, suspended, churned].map((t) => ({ tenantId: t.tenantId, step: 'ops_done', updatedAt: old })),
    );
    await ctx.db.update(tenants).set({ liveAt: new Date() }).where(eq(tenants.id, live.tenantId));
    await ctx.db.update(tenants).set({ lifecycleStage: 'suspended', suspensionReason: 'payment' }).where(eq(tenants.id, suspended.tenantId));
    await ctx.db.update(tenants).set({ lifecycleStage: 'churned' }).where(eq(tenants.id, churned.tenantId));

    const res = await list(p.platform_admin.cookie, '?limit=100');
    for (const t of [live, suspended, churned]) expect(find(res, t.tenantId)!.onboardingStuck).toBe(false);
    const only = await list(p.platform_admin.cookie, '?stuck=1&limit=100');
    const ids = (only.json().items as { id: string }[]).map((x) => x.id);
    for (const t of [live, suspended, churned]) expect(ids).not.toContain(t.tenantId);
  });

  it('son hareket: sipariş ve panel girişinin en yenisi', async () => {
    const t = await ctx.createTenantWithOwner({ name: 'Son Hareket' });
    const loginAt = new Date(Date.now() - 3 * 3600_000);
    await ctx.db.update(users).set({ lastLoginAt: loginAt }).where(eq(users.id, t.owner.id));
    let res = await list(p.platform_admin.cookie, '?limit=100');
    expect(find(res, t.tenantId)!.lastActivityAt).toBe(loginAt.toISOString());

    // Daha yeni bir sipariş: son hareket siparişe kayar
    const placedAt = new Date(Date.now() - 30 * 60_000);
    await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new', extra: { placedAt } });
    res = await list(p.platform_admin.cookie, '?limit=100');
    expect(find(res, t.tenantId)!.lastActivityAt).toBe(placedAt.toISOString());
  });
});
