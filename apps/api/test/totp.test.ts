// İki adımlı doğrulama (TOTP; 00 §12a madde 7, 14 §5): kurulum, etkinleştirme, girişte ikinci adım, tekrar
// oynatma koruması, kurtarma kodları, kapatma, platform yöneticisi zorunluluğu, oturum türü ve hız sınırı.
// Uygulama ADMIN_TOTP_REQUIRED=1 ile kurulur (işletme kullanıcılarında TOTP isteğe bağlıdır; bayrak onları etkilemez).
// Zaman yalnız Date sahtelenerek yönetilir (zamanlayıcılar gerçek): her kod belirli bir 30 sn adımına aittir.

import { auditLog, sessions, users } from '@siparis/db';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { authenticator } from 'otplib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cookieFrom, createTestContext, expectError, testConfig, type TestContext, type TestTenant, type TestUser } from './helpers';

let ctx: TestContext;
let t: TestTenant;

const STEP_MS = 30_000;
const AUTH = '/api/v1/auth';

let ipSeq = 1;
const nextIp = () => `10.88.${Math.floor(ipSeq / 250) % 250}.${(ipSeq++ % 250) + 1}`;

/** Sahte saatin şu anki adımına göre kod (offset: ±adım). */
function codeAt(secret: string, offsetSteps = 0): string {
  return authenticator.clone({ epoch: Date.now() + offsetSteps * STEP_MS }).generate(secret);
}

/** ±1 adımın hiçbirinde geçerli olmayan 6 haneli kod. */
function wrongCode(secret: string): string {
  const valid = new Set([-1, 0, 1].map((o) => codeAt(secret, o)));
  for (let i = 0; ; i++) {
    const c = String(i).padStart(6, '0');
    if (!valid.has(c)) return c;
  }
}

/** Sahte saati adım adım ilerletir. */
function tick(steps = 1): void {
  vi.setSystemTime(Date.now() + steps * STEP_MS);
}

function login(body: Record<string, unknown>): Promise<LightMyRequestResponse> {
  return ctx.request({ method: 'POST', url: `${AUTH}/login`, body, headers: { 'x-forwarded-for': nextIp() } });
}

function post(path: string, cookie: string | undefined, body?: unknown): Promise<LightMyRequestResponse> {
  return ctx.request({ method: 'POST', url: `${AUTH}${path}`, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { body } : {}) });
}

/** Kurulum + etkinleştirme (1 kod denemesi harcar); saat bir adım ilerler ki sonraki kod yeni adımdan olsun. */
async function enroll(cookie: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = await post('/totp/setup', cookie);
  expect(setup.statusCode, setup.body).toBe(200);
  const { secret } = setup.json() as { secret: string };
  const en = await post('/totp/enable', cookie, { code: codeAt(secret) });
  expect(en.statusCode, en.body).toBe(200);
  tick();
  return { secret, recoveryCodes: (en.json() as { recoveryCodes: string[] }).recoveryCodes };
}

/** İşletmeye yönetici olarak eklenmiş, kişisel oturumu olan yeni kullanıcı. */
async function newMember(): Promise<{ user: TestUser; cookie: string }> {
  return ctx.createStaff(t.tenantId, 'manager');
}

async function userRow(id: string) {
  const [u] = await ctx.db.select().from(users).where(eq(users.id, id));
  return u!;
}

beforeAll(async () => {
  ctx = await createTestContext({ config: testConfig({ ADMIN_TOTP_REQUIRED: '1' }) });
  t = await ctx.createTenantWithOwner({ name: 'TOTP İşletmesi' });
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(() => {
  // Bir adımın başına 1 sn kala değil, 1 sn sonrasına hizala (sınır kayması olmasın)
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime((Math.floor(Date.now() / STEP_MS) + 1) * STEP_MS + 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('kurulum ve etkinleştirme', () => {
  it('setup: sır + otpauth adresi + QR SVG; sır şifreli bekler, etkinleşene kadar giriş kodsuz', async () => {
    const m = await newMember();
    const res = await post('/totp/setup', m.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { secret: string; otpauthUrl: string; qrSvg: string };
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(body.otpauthUrl.startsWith('otpauth://totp/')).toBe(true);
    expect(body.otpauthUrl).toContain(`secret=${body.secret}`);
    expect(decodeURIComponent(body.otpauthUrl)).toContain('issuer=Siparişin Önünde');
    expect(decodeURIComponent(body.otpauthUrl)).toContain(m.user.email);
    expect(body.qrSvg.startsWith('<svg')).toBe(true);

    const row = await userRow(m.user.id);
    expect(row.totpPendingSecretEnc).toMatch(/^v1:/);
    expect(row.totpPendingSecretEnc).not.toContain(body.secret);
    expect(row.totpEnabledAt).toBeNull();

    const me = await ctx.request({ method: 'GET', url: `${AUTH}/me`, cookie: m.cookie });
    expect(me.json()).toMatchObject({ totpEnabled: false });
    expect(me.json()).not.toHaveProperty('totpRequired');
    const plain = await login({ login: m.user.email, password: m.user.password });
    expect(plain.statusCode, plain.body).toBe(200);
  });

  it('enable: setup olmadan 400, yanlış kod 400 invalid_totp; doğru kod 8 kurtarma kodu döner ve diğer oturumları kapatır', async () => {
    const m = await newMember();
    const other = await ctx.sessionCookie(m.user.id, { tenantId: t.tenantId });

    expectError(await post('/totp/enable', m.cookie, { code: '123456' }), 400, 'totp_setup_required');
    const setup = await post('/totp/setup', m.cookie);
    const { secret } = setup.json() as { secret: string };
    expectError(await post('/totp/enable', m.cookie, { code: wrongCode(secret) }), 400, 'invalid_totp');
    expectError(await post('/totp/enable', m.cookie, { code: 'abc' }), 400, 'validation_error');

    const res = await post('/totp/enable', m.cookie, { code: codeAt(secret) });
    expect(res.statusCode, res.body).toBe(200);
    const { recoveryCodes } = res.json() as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(8);
    expect(new Set(recoveryCodes).size).toBe(8);
    for (const c of recoveryCodes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

    // Diğer oturum kapandı, bu oturum sürüyor
    expect((await ctx.request({ method: 'GET', url: `${AUTH}/me`, cookie: other })).statusCode).toBe(401);
    const me = await ctx.request({ method: 'GET', url: `${AUTH}/me`, cookie: m.cookie });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ totpEnabled: true });

    const row = await userRow(m.user.id);
    expect(row.totpEnabledAt).not.toBeNull();
    expect(row.totpPendingSecretEnc).toBeNull();
    expect(row.totpSecretEnc).toMatch(/^v1:/);
    expect(row.totpRecoveryHashes).toHaveLength(8);
    for (const c of recoveryCodes) expect(row.totpRecoveryHashes.join(',')).not.toContain(c.replace('-', ''));

    // Audit: kayıtlar var, sır ve kodlar yok
    const logs = await ctx.db.select().from(auditLog).where(eq(auditLog.actorUserId, m.user.id));
    const actions = logs.map((l) => l.action);
    expect(actions).toContain('auth.totp_setup_started');
    expect(actions).toContain('auth.totp_enabled');
    const dump = JSON.stringify(logs);
    expect(dump).not.toContain(secret);
    for (const c of recoveryCodes) expect(dump).not.toContain(c);

    expectError(await post('/totp/enable', m.cookie, { code: codeAt(secret) }), 409, 'totp_already_enabled');
    expectError(await post('/totp/setup', m.cookie), 409, 'totp_already_enabled');

    // Kullanıcı yalıtımı: uçlar yalnız oturumun kullanıcısına dokunur (aynı işletmenin sahibi etkilenmez)
    const owner = await userRow(t.owner.id);
    expect(owner).toMatchObject({ totpEnabledAt: null, totpSecretEnc: null, totpPendingSecretEnc: null, totpRecoveryHashes: [] });
    expect((await ctx.request({ method: 'GET', url: `${AUTH}/me`, cookie: t.ownerCookie })).json()).toMatchObject({ totpEnabled: false });
  });
});

describe('yapılandırma', () => {
  it('ADMIN_TOTP_REQUIRED: verilmezse üretimde açık, diğer ortamlarda kapalı; açıkça verilen değer geçerli', () => {
    // Üretimde loadConfig zayıf anahtarları ve DEV_TOOLS'u reddeder (lib.test.ts)
    const prod = {
      NODE_ENV: 'production',
      DEV_TOOLS: '0',
      SESSION_SECRET: 's'.repeat(40),
      TRACKING_SECRET: 't'.repeat(40),
      WA_VERIFY_TOKEN: 'uretim-dogrulama-belirteci',
    };
    expect(testConfig().ADMIN_TOTP_REQUIRED).toBe(false);
    expect(testConfig(prod).ADMIN_TOTP_REQUIRED).toBe(true);
    expect(testConfig({ ...prod, ADMIN_TOTP_REQUIRED: '0' }).ADMIN_TOTP_REQUIRED).toBe(false);
    expect(testConfig({ ...prod, ADMIN_TOTP_REQUIRED: '' }).ADMIN_TOTP_REQUIRED).toBe(true);
    expect(testConfig({ ADMIN_TOTP_REQUIRED: 'true' }).ADMIN_TOTP_REQUIRED).toBe(true);
    expect(ctx.config.ADMIN_TOTP_REQUIRED).toBe(true);
  });
});

describe('girişte ikinci adım', () => {
  it('kodsuz 401 totp_required ve oturum açılmaz; parola önce doğrulanır; yanlış kod 401 invalid_totp; doğru kod oturum açar', async () => {
    const m = await newMember();
    const { secret } = await enroll(m.cookie);
    const countSessions = async () => (await ctx.db.select().from(sessions).where(eq(sessions.userId, m.user.id))).length;
    const before = await countSessions();

    const noCode = await login({ login: m.user.email, password: m.user.password });
    expectError(noCode, 401, 'totp_required');
    expect(noCode.cookies.find((c) => c.name === 'sid')).toBeUndefined();

    // Yanlış parola: TOTP durumu açığa çıkmaz
    expectError(await login({ login: m.user.email, password: 'yanlis-parola' }), 401, 'invalid_credentials');
    expectError(await login({ login: m.user.email, password: 'yanlis-parola', totp: codeAt(secret) }), 401, 'invalid_credentials');

    const bad = await login({ login: m.user.email, password: m.user.password, totp: wrongCode(secret) });
    expectError(bad, 401, 'invalid_totp');
    expect(bad.cookies.find((c) => c.name === 'sid')).toBeUndefined();
    expect(await countSessions()).toBe(before);

    const ok = await login({ login: m.user.email, password: m.user.password, totp: codeAt(secret) });
    expect(ok.statusCode, ok.body).toBe(200);
    const me = await ctx.request({ method: 'GET', url: `${AUTH}/me`, cookie: cookieFrom(ok) });
    expect(me.json()).toMatchObject({ totpEnabled: true, role: 'manager' });

    const failed = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'auth.totp_login_failed'));
    expect(failed.some((l) => l.actorUserId === m.user.id)).toBe(true);
  });

  it('aynı adımın kodu ikinci kez kabul edilmez; ±1 adım kabul, +2 adım red', async () => {
    const m = await newMember();
    const { secret } = await enroll(m.cookie);
    const creds = { login: m.user.email, password: m.user.password };

    const c = codeAt(secret);
    expect((await login({ ...creds, totp: c })).statusCode).toBe(200);
    expectError(await login({ ...creds, totp: c }), 401, 'invalid_totp');

    tick(2);
    expectError(await login({ ...creds, totp: codeAt(secret, 2) }), 401, 'invalid_totp');
    // Saat kayması: bir önceki adımın kodu (henüz kullanılmamış) kabul edilir
    expect((await login({ ...creds, totp: codeAt(secret, -1) })).statusCode).toBe(200);
  });

  it('kurtarma kodu bir kez çalışır (biçim esnek) ve kalan sayı düşer', async () => {
    const m = await newMember();
    const { recoveryCodes } = await enroll(m.cookie);
    const creds = { login: m.user.email, password: m.user.password };
    const first = recoveryCodes[0]!;

    const ok = await login({ ...creds, recoveryCode: ` ${first.replace('-', '').toLowerCase()} ` });
    expect(ok.statusCode, ok.body).toBe(200);
    expectError(await login({ ...creds, recoveryCode: first }), 401, 'invalid_totp');

    const status = await ctx.request({ method: 'GET', url: `${AUTH}/totp`, cookie: cookieFrom(ok) });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json()).toMatchObject({ enabled: true, recoveryCodesRemaining: 7, required: false });
    const used = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'auth.totp_recovery_code_used'));
    expect(used.find((l) => l.actorUserId === m.user.id)?.data).toMatchObject({ recoveryCodesRemaining: 7 });
  });
});

describe('yönetim', () => {
  it('recovery-codes: kodla yenilenir, eski kodlar geçersizleşir', async () => {
    const m = await newMember();
    const { secret, recoveryCodes } = await enroll(m.cookie);
    expectError(await post('/totp/recovery-codes', m.cookie, { code: wrongCode(secret) }), 400, 'invalid_totp');

    const res = await post('/totp/recovery-codes', m.cookie, { code: codeAt(secret) });
    expect(res.statusCode, res.body).toBe(200);
    const fresh = (res.json() as { recoveryCodes: string[] }).recoveryCodes;
    expect(fresh).toHaveLength(8);
    expect(fresh.some((c) => recoveryCodes.includes(c))).toBe(false);

    const creds = { login: m.user.email, password: m.user.password };
    expectError(await login({ ...creds, recoveryCode: recoveryCodes[0] }), 401, 'invalid_totp');
    expect((await login({ ...creds, recoveryCode: fresh[0] })).statusCode).toBe(200);
    const logs = await ctx.db.select().from(auditLog).where(eq(auditLog.actorUserId, m.user.id));
    expect(logs.map((l) => l.action)).toContain('auth.totp_recovery_codes_regenerated');
  });

  it('disable: parola + kod (kurtarma kodu da olur); yanlış parola 400; kapandıktan sonra giriş kodsuz', async () => {
    const m = await newMember();
    const { secret, recoveryCodes } = await enroll(m.cookie);
    expectError(await post('/totp/disable', m.cookie, { password: 'yanlis-parola', code: codeAt(secret) }), 400, 'invalid_password');
    expectError(await post('/totp/disable', m.cookie, { password: m.user.password, code: wrongCode(secret) }), 400, 'invalid_totp');

    const res = await post('/totp/disable', m.cookie, { password: m.user.password, code: recoveryCodes[0] });
    expect(res.statusCode, res.body).toBe(200);
    const row = await userRow(m.user.id);
    expect(row).toMatchObject({ totpEnabledAt: null, totpSecretEnc: null, totpPendingSecretEnc: null, totpLastStep: null, totpRecoveryHashes: [] });

    expect((await login({ login: m.user.email, password: m.user.password })).statusCode).toBe(200);
    expectError(await post('/totp/disable', m.cookie, { password: m.user.password, code: codeAt(secret) }), 409, 'totp_not_enabled');
    const logs = await ctx.db.select().from(auditLog).where(eq(auditLog.actorUserId, m.user.id));
    expect(logs.find((l) => l.action === 'auth.totp_disabled')?.data).toMatchObject({ method: 'recovery_code' });
  });

  it('oturum türü: oturumsuz 401; kurye ve destek görünümü (impersonation) 403', async () => {
    expectError(await ctx.request({ method: 'GET', url: `${AUTH}/totp` }), 401, 'unauthorized');
    expectError(await post('/totp/setup', undefined), 401, 'unauthorized');

    const courier = await ctx.createStaff(t.tenantId, 'courier');
    expectError(await post('/totp/setup', courier.cookie), 403, 'forbidden');
    expectError(await ctx.request({ method: 'GET', url: `${AUTH}/totp`, cookie: courier.cookie }), 403, 'forbidden');

    const admin = await ctx.createUser({ name: 'Destek Uzmanı', isPlatformAdmin: true, platformRole: 'support_agent' });
    const imp = await ctx.sessionCookie(admin.id, { tenantId: t.tenantId, kind: 'impersonation' });
    expectError(await post('/totp/setup', imp), 403, 'forbidden');
    expectError(await post('/totp/enable', imp, { code: '123456' }), 403, 'forbidden');
    expectError(await post('/totp/recovery-codes', imp, { code: '123456' }), 403, 'forbidden');
    expectError(await ctx.request({ method: 'GET', url: `${AUTH}/totp`, cookie: imp }), 403, 'forbidden');
    expect((await userRow(admin.id)).totpPendingSecretEnc).toBeNull();
  });

  it('hız sınırı: kullanıcı başına 5 kod denemesi / 10 dk → 429 (doğru kod da beklemeli), diğer kullanıcı etkilenmez', async () => {
    const m = await newMember();
    const { secret } = await enroll(m.cookie); // 1. deneme
    const creds = { login: m.user.email, password: m.user.password };
    for (let i = 0; i < 4; i++) expectError(await login({ ...creds, totp: wrongCode(secret) }), 401, 'invalid_totp');
    const limited = await login({ ...creds, totp: codeAt(secret) });
    expectError(limited, 429, 'rate_limited');
    expect((limited.json() as { error: { message: string } }).error.message).toMatch(/dakika sonra tekrar deneyin/);
    expectError(await post('/totp/recovery-codes', m.cookie, { code: codeAt(secret) }), 429, 'rate_limited');

    const other = await newMember();
    const o = await enroll(other.cookie);
    expect((await login({ login: other.user.email, password: other.user.password, totp: codeAt(o.secret) })).statusCode).toBe(200);
  });
});

describe('platform yöneticisi (ADMIN_TOTP_REQUIRED=1)', () => {
  it('kurulmadan giriş olur ama tüm admin uçları 403 totp_enrollment_required; kurulunca açılır; kapatılamaz', async () => {
    const admin = await ctx.createUser({ name: 'Platform Sahibi', isPlatformAdmin: true, platformRole: 'platform_owner' });
    const first = await login({ login: admin.email, password: admin.password });
    expect(first.statusCode, first.body).toBe(200);
    const cookie = cookieFrom(first);

    const me = await ctx.request({ method: 'GET', url: `${AUTH}/me`, cookie });
    expect(me.json()).toMatchObject({ isPlatformAdmin: true, totpEnabled: false, totpRequired: true });

    const overview = await ctx.request({ method: 'GET', url: '/api/v1/admin/overview', cookie });
    expectError(overview, 403, 'totp_enrollment_required');
    expect((overview.json() as { error: { message: string } }).error.message).toMatch(/iki adımlı doğrulama/);
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/admin/tenants', cookie }), 403, 'totp_enrollment_required');
    // Destek oturumu (impersonation) başlatma da kapalı
    expectError(
      await ctx.request({
        method: 'POST',
        url: `/api/v1/admin/tenants/${t.tenantId}/impersonate`,
        cookie,
        body: { reason: 'Sipariş düşmüyor şikayeti, panel kontrolü' },
      }),
      403,
      'totp_enrollment_required',
    );
    // İşletme kullanıcısı için davranış değişmez
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/admin/overview', cookie: t.ownerCookie }), 403, 'forbidden');

    const { secret } = await enroll(cookie);
    const me2 = await ctx.request({ method: 'GET', url: `${AUTH}/me`, cookie });
    expect(me2.json()).toMatchObject({ totpEnabled: true, totpRequired: true });
    expect((await ctx.request({ method: 'GET', url: '/api/v1/admin/overview', cookie })).statusCode).toBe(200);
    const status = await ctx.request({ method: 'GET', url: `${AUTH}/totp`, cookie });
    expect(status.json()).toMatchObject({ enabled: true, required: true, recoveryCodesRemaining: 8 });

    expectError(await post('/totp/disable', cookie, { password: admin.password, code: codeAt(secret) }), 403, 'totp_required_for_admin');

    expectError(await login({ login: admin.email, password: admin.password }), 401, 'totp_required');
    const again = await login({ login: admin.email, password: admin.password, totp: codeAt(secret) });
    expect(again.statusCode, again.body).toBe(200);
    expect((await ctx.request({ method: 'GET', url: '/api/v1/admin/overview', cookie: cookieFrom(again) })).statusCode).toBe(200);
  });
});
