// Destek erişimi / impersonation (00 §4, 05 A-09, 14 §10 e2e 6): salt-okunur, 30 dk, gerekçe, bildirim, audit,
// çerez değişimi (sid ↔ sid_admin) ve dönüş.

import { auditLog, notifications, sessions } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireTenantRole, tenantAuth } from '../src/plugins/auth';
import { sha256Hex } from '../src/lib/tokens';
import { createPlatformUsers, type PlatformUsers } from './admin-helpers';
import { createTestContext, expectError, type TestContext, type TestTenant } from './helpers';

let ctx: TestContext;
let p: PlatformUsers;
let a: TestTenant;

// Örnek panel rotaları (panel dilimleri paralel geliştiriliyor): okuma serbest, yazma salt-okunurda 403.
const samplePanel: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requireTenantRole(['owner', 'manager']));
  app.get('/__imp/whoami', async (request) => {
    const auth = tenantAuth(request);
    return { tenantId: auth.tenantId, role: auth.role, readOnly: auth.readOnly };
  });
  app.post('/__imp/write', async () => ({ ok: true }));
  app.patch('/__imp/write', async () => ({ ok: true }));
};

const API = '/api/v1/admin';
const REASON = 'Sipariş düşmüyor şikayeti, panel kontrolü';

function cookiesOf(res: LightMyRequestResponse) {
  return Object.fromEntries(res.cookies.map((c) => [c.name, c]));
}

async function start(cookie: string, body: unknown = { reason: REASON, ticketRef: 'DST-42' }, tenantId = a.tenantId) {
  return ctx.request({ method: 'POST', url: `${API}/tenants/${tenantId}/impersonate`, cookie, body });
}

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.app.register(samplePanel, { prefix: '/api/v1/panel' });
  p = await createPlatformUsers(ctx);
  a = await ctx.createTenantWithOwner({ name: 'Destek İşletmesi' });
});

afterAll(async () => {
  await ctx.close();
});

describe('POST /admin/tenants/:id/impersonate', () => {
  it('yetki: SA/PA/PO başlatır; F ve SR 403; işletme kullanıcısı 403; oturumsuz 401', async () => {
    expectError(await start(p.finance.cookie), 403, 'forbidden');
    expectError(await start(p.sales_rep.cookie), 403, 'forbidden');
    expectError(await start(a.ownerCookie), 403, 'forbidden');
    expectError(await ctx.request({ method: 'POST', url: `${API}/tenants/${a.tenantId}/impersonate`, body: { reason: REASON } }), 401, 'unauthorized');
  });

  it('gerekçe ≥ 20 karakter (05 A-09); olmayan işletme 404', async () => {
    expectError(await start(p.support_agent.cookie, { reason: 'kısa' }), 400, 'validation_error');
    // 19 karakter: reddedilir; 20 karakter: kabul
    expectError(await start(p.support_agent.cookie, { reason: 'Bildirim kontrolü x' }), 400, 'validation_error');
    const other = await ctx.createTenantWithOwner({ name: 'Gerekçe Sınırı' });
    expect((await start(p.support_agent.cookie, { reason: 'Bildirim kontrolü xy' }, other.tenantId)).statusCode).toBe(200);
    expectError(await start(p.support_agent.cookie, {}), 400, 'validation_error');
    expectError(await start(p.support_agent.cookie, { reason: REASON }, '00000000-0000-4000-8000-000000000000'), 404, 'not_found');
  });

  it('oturum: impersonation, salt-okunur, 30 dk; bildirim ve audit; çerezler', async () => {
    const before = Date.now();
    const res = await start(p.support_agent.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, tenantId: a.tenantId, readOnly: true, redirectTo: '/panel' });
    const exp = new Date(body.expiresAt).getTime();
    expect(exp - before).toBeGreaterThan(29 * 60_000);
    expect(exp - before).toBeLessThanOrEqual(30 * 60_000 + 5_000);

    const [s] = await ctx.db.select().from(sessions).where(eq(sessions.id, body.sessionId));
    expect(s).toMatchObject({
      kind: 'impersonation',
      readOnly: true,
      tenantId: a.tenantId,
      userId: p.support_agent.user.id,
      impersonatorUserId: p.support_agent.user.id,
      impersonationReason: REASON,
    });

    const c = cookiesOf(res);
    expect(c.sid?.httpOnly).toBe(true);
    expect(c.sid?.path).toBe('/');
    expect(sha256Hex(c.sid!.value)).toBe(s!.tokenHash);
    // Admin oturumu saklandı: yalnız end yoluna gönderilir
    expect(c.sid_admin?.path).toBe('/api/v1/admin/impersonation');
    expect(c.sid_admin?.httpOnly).toBe(true);
    expect(`sid=${c.sid_admin!.value}`).toBe(p.support_agent.cookie);

    const notes = await ctx.db.select().from(notifications).where(eq(notifications.tenantId, a.tenantId));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'support_access_started', recipientUserId: a.owner.id });
    expect(notes[0]!.payload).toMatchObject({ supportAgentName: 'Platform support_agent', readOnly: true });

    const [log] = await ctx.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'admin.impersonation_start'), eq(auditLog.entityId, body.sessionId)));
    expect(log).toMatchObject({ tenantId: a.tenantId, actorUserId: p.support_agent.user.id, impersonatorUserId: p.support_agent.user.id, entityId: body.sessionId });
    expect(log!.data).toMatchObject({ reason: REASON, ticketRef: 'DST-42', readOnly: true });
  });
});

describe('destek oturumuyla panel', () => {
  let imp: string;
  let stash: string;

  beforeAll(async () => {
    const res = await start(p.platform_admin.cookie);
    const c = cookiesOf(res);
    imp = `sid=${c.sid!.value}`;
    stash = `sid_admin=${c.sid_admin!.value}`;
  });

  it('/auth/me: sahip gözüyle salt-okunur, impersonating dolu', async () => {
    const res = await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: imp });
    expect(res.statusCode, res.body).toBe(200);
    const me = res.json();
    expect(me.readOnly).toBe(true);
    expect(me.role).toBe('owner');
    expect(me.tenant.id).toBe(a.tenantId);
    expect(me.impersonating).toMatchObject({ tenantId: a.tenantId, impersonatorUserId: p.platform_admin.user.id });
  });

  it('panelde okuma 200, yazma 403 read_only_session', async () => {
    const r = await ctx.request({ method: 'GET', url: '/api/v1/panel/__imp/whoami', cookie: imp });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ tenantId: a.tenantId, role: 'owner', readOnly: true });
    expectError(await ctx.request({ method: 'POST', url: '/api/v1/panel/__imp/write', cookie: imp, body: {} }), 403, 'read_only_session');
    expectError(await ctx.request({ method: 'PATCH', url: '/api/v1/panel/__imp/write', cookie: imp, body: {} }), 403, 'read_only_session');
    // Sahibin kendi oturumu yazabilir (kontrol)
    expect((await ctx.request({ method: 'POST', url: '/api/v1/panel/__imp/write', cookie: a.ownerCookie, body: {} })).statusCode).toBe(200);
  });

  it('destek oturumuyla admin uçları ve işletme değiştirme 403', async () => {
    expectError(await ctx.request({ method: 'GET', url: `${API}/overview`, cookie: imp }), 403, 'forbidden');
    expectError(await start(imp), 403, 'forbidden');
    expectError(await ctx.request({ method: 'POST', url: '/api/v1/auth/switch-tenant', cookie: imp, body: { tenantId: a.tenantId } }), 403, 'forbidden');
  });

  it('bitir: destek oturumu silinir, sid admin oturumuna döner, audit', async () => {
    const res = await ctx.request({ method: 'POST', url: `${API}/impersonation/end`, cookie: `${imp}; ${stash}`, body: {} });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, ended: 1, restored: true, redirectTo: '/admin' });
    const c = cookiesOf(res);
    expect(`sid=${c.sid!.value}`).toBe(p.platform_admin.cookie);
    expect(c.sid_admin?.value).toBe(''); // temizlendi
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: imp }), 401, 'unauthorized');
    expect((await ctx.request({ method: 'GET', url: `${API}/overview`, cookie: p.platform_admin.cookie })).statusCode).toBe(200);
    const [log] = await ctx.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'admin.impersonation_end'), eq(auditLog.impersonatorUserId, p.platform_admin.user.id)));
    expect(log?.tenantId).toBe(a.tenantId);
  });
});

describe('destek oturumunda her panel isteği audit_log’a yazılır', () => {
  async function requestRows(sessionId: string, expectedMin = 1) {
    // onResponse kancası yanıt gönderildikten sonra çalışır: kısa bekleme
    for (let i = 0; i < 40; i++) {
      const rows = await ctx.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, 'admin.impersonation_request'), eq(auditLog.entityId, sessionId)));
      if (rows.length >= expectedMin) return rows;
      await new Promise((r) => setTimeout(r, 25));
    }
    return ctx.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'admin.impersonation_request'), eq(auditLog.entityId, sessionId)));
  }

  it('method, path, status; 10 sn içinde aynı istek birleşir; yazma denemesi 403 olarak kaydedilir; sorgu metni yazılmaz', async () => {
    const res = await start(p.support_agent.cookie);
    const sessionId = res.json().sessionId as string;
    const imp = `sid=${cookiesOf(res).sid!.value}`;

    for (let i = 0; i < 3; i++) {
      expect((await ctx.request({ method: 'GET', url: '/api/v1/panel/__imp/whoami?q=05321234567', cookie: imp })).statusCode).toBe(200);
    }
    let rows = await requestRows(sessionId);
    await new Promise((r) => setTimeout(r, 100));
    rows = await requestRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: a.tenantId,
      actorUserId: p.support_agent.user.id,
      impersonatorUserId: p.support_agent.user.id,
      entityType: 'session',
    });
    expect(rows[0]!.data).toMatchObject({ method: 'GET', path: '/api/v1/panel/__imp/whoami', status: 200, count: 3, queryKeys: ['q'], readOnly: true });
    expect(JSON.stringify(rows[0]!.data)).not.toContain('05321234567');

    expectError(await ctx.request({ method: 'POST', url: '/api/v1/panel/__imp/write', cookie: imp, body: {} }), 403, 'read_only_session');
    rows = await requestRows(sessionId, 2);
    const write = rows.find((r) => (r.data as { method?: string }).method === 'POST');
    expect(write?.data).toMatchObject({ path: '/api/v1/panel/__imp/write', status: 403, count: 1 });

    // Pencere dışı: 10 sn'den eski satır birleşmez, yeni satır açılır
    await ctx.db
      .update(auditLog)
      .set({ createdAt: new Date(Date.now() - 11_000) })
      .where(and(eq(auditLog.action, 'admin.impersonation_request'), eq(auditLog.entityId, sessionId)));
    await ctx.request({ method: 'GET', url: '/api/v1/panel/__imp/whoami', cookie: imp });
    rows = await requestRows(sessionId, 3);
    const gets = rows.filter((r) => (r.data as { method?: string }).method === 'GET');
    expect(gets).toHaveLength(2);
  });

  it('SSE akışı (hijack, onResponse çalışmaz): açılış bir kez kaydedilir, kopunca ikinci kayıt yok; sahibin akışı kaydedilmez', async () => {
    const baseUrl = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const openStream = async (cookie: string) => {
      const controller = new AbortController();
      const r = await fetch(`${baseUrl}/api/v1/panel/stream?branchId=${a.branchId}`, { headers: { cookie, accept: 'text/event-stream' }, signal: controller.signal });
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toContain('text/event-stream');
      const reader = r.body!.getReader();
      await reader.read();
      controller.abort();
      await reader.cancel().catch(() => {});
    };

    const res = await start(p.support_agent.cookie);
    const sessionId = res.json().sessionId as string;
    const imp = `sid=${cookiesOf(res).sid!.value}`;
    await openStream(imp);
    let rows = await requestRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: a.tenantId, actorUserId: p.support_agent.user.id, impersonatorUserId: p.support_agent.user.id, entityType: 'session' });
    expect(rows[0]!.data).toMatchObject({ method: 'GET', path: '/api/v1/panel/stream', status: 200, stream: true, count: 1, queryKeys: ['branchId'], readOnly: true });
    // İstemci koptu: onResponse kancası akışı ikinci kez yazmaz
    await new Promise((r) => setTimeout(r, 150));
    rows = await requestRows(sessionId);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.data as { count: number }).count).toBe(1);

    const before = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'admin.impersonation_request'));
    await openStream(a.ownerCookie);
    await new Promise((r) => setTimeout(r, 150));
    const after = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'admin.impersonation_request'));
    expect(after.length).toBe(before.length);
  });

  it('işletmenin kendi oturumu ve panel dışı istekler kaydedilmez', async () => {
    const before = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'admin.impersonation_request'));
    await ctx.request({ method: 'GET', url: '/api/v1/panel/__imp/whoami', cookie: a.ownerCookie });
    const res = await start(p.support_agent.cookie);
    const imp = `sid=${cookiesOf(res).sid!.value}`;
    await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: imp });
    await new Promise((r) => setTimeout(r, 150));
    const after = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'admin.impersonation_request'));
    expect(after.length).toBe(before.length);
  });
});

describe('süre ve bitirme varyasyonları', () => {
  it('30 dk dolunca oturum sunucuda geçersiz; sid_admin ile admin oturumu geri yüklenir', async () => {
    const res = await start(p.platform_owner.cookie);
    const c = cookiesOf(res);
    const imp = `sid=${c.sid!.value}`;
    await ctx.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, res.json().sessionId));
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: imp }), 401, 'unauthorized');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/panel/__imp/whoami', cookie: imp }), 401, 'unauthorized');

    const end = await ctx.request({ method: 'POST', url: `${API}/impersonation/end`, cookie: `${imp}; sid_admin=${c.sid_admin!.value}`, body: {} });
    expect(end.statusCode, end.body).toBe(200);
    expect(end.json()).toMatchObject({ ended: 0, restored: true });
    expect(`sid=${cookiesOf(end).sid!.value}`).toBe(p.platform_owner.cookie);
  });

  it('admin oturumundan bitir: kendi açık destek oturumlarını kapatır', async () => {
    const r1 = await start(p.support_agent.cookie);
    const r2 = await start(p.support_agent.cookie);
    const res = await ctx.request({ method: 'POST', url: `${API}/impersonation/end`, cookie: p.support_agent.cookie, body: {} });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().ended).toBeGreaterThanOrEqual(2);
    expect(res.json().restored).toBe(false);
    for (const r of [r1, r2]) {
      expectError(await ctx.request({ method: 'GET', url: '/api/v1/auth/me', cookie: `sid=${cookiesOf(r).sid!.value}` }), 401, 'unauthorized');
    }
  });

  it('oturumsuz ve saklı çerezsiz bitir → 401; başka adminin saklı çereziyle geri yükleme yapılmaz', async () => {
    expectError(await ctx.request({ method: 'POST', url: `${API}/impersonation/end`, body: {} }), 401, 'unauthorized');
    const res = await start(p.support_agent.cookie);
    const imp = `sid=${cookiesOf(res).sid!.value}`;
    const foreign = p.platform_owner.cookie.replace('sid=', 'sid_admin=');
    const end = await ctx.request({ method: 'POST', url: `${API}/impersonation/end`, cookie: `${imp}; ${foreign}`, body: {} });
    expect(end.statusCode, end.body).toBe(200);
    expect(end.json()).toMatchObject({ ended: 1, restored: false, redirectTo: '/admin/giris' });
    expect(cookiesOf(end).sid?.value).toBe('');
  });

  it('detayda aktif destek oturumu görünür', async () => {
    await start(p.platform_admin.cookie);
    const d = await ctx.request({ method: 'GET', url: `${API}/tenants/${a.tenantId}`, cookie: p.platform_owner.cookie });
    expect(d.statusCode, d.body).toBe(200);
    expect(d.json().activeImpersonations.length).toBeGreaterThanOrEqual(1);
    expect(d.json().activeImpersonations[0].impersonatorName).toBe('Platform platform_admin');
  });
});
