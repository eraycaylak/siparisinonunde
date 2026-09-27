// Canlı ortam ve seed kipleri (00 §12a madde 10): SEED_MODE (demo | admin), üretim bayrakları (bootstrap.ts,
// scripts/bootstrap-production.ts), create-admin --if-missing (otomatik dağıtım) ve kayıt durumu ucu
// (GET /public/signup-status).

import {
  DEMO,
  assertSeedAllowed,
  ensureProductionFlags,
  featureFlags,
  isSmsConfigured,
  productionFlagDefaults,
  resolveSeedMode,
  seedAdminOnly,
  seedDemo,
  tenants,
  users,
} from '@siparis/db';
import { eq } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, createTestContext, type TestContext } from './helpers';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await ctx.truncateAll();
});

async function flagMap(): Promise<Record<string, boolean>> {
  const rows = await ctx.db.select({ key: featureFlags.key, enabled: featureFlags.enabled }).from(featureFlags);
  return Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
}

/** Depo kökünden bir betiği tsx ile test veritabanına karşı çalıştırır; çıkış kodu, stdout ve stderr döner. */
async function script(file: string, args: string[], env: Record<string, string> = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, ['--import', 'tsx', file, ...args], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, ADMIN_PASSWORD: '', NODE_ENV: 'test', ...env },
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('SEED_MODE', () => {
  it('boş → demo; demo | admin kabul; başka değer hata', () => {
    expect(resolveSeedMode(undefined)).toBe('demo');
    expect(resolveSeedMode('')).toBe('demo');
    expect(resolveSeedMode(' Admin ')).toBe('admin');
    expect(resolveSeedMode('demo')).toBe('demo');
    expect(() => resolveSeedMode('prod')).toThrow(/SEED_MODE geçersiz/);
  });

  it('canlı ortamda (NODE_ENV=production, DEPLOY_ENV=production) demo seed çalışmaz; Cloudflare (dev) ve admin kipi çalışır', () => {
    expect(() => assertSeedAllowed('demo', { NODE_ENV: 'production' })).toThrow(/demo seed çalıştırılmaz/);
    expect(() => assertSeedAllowed('demo', { NODE_ENV: 'production', DEPLOY_ENV: 'production' })).toThrow(/00 §12a madde 10/);
    expect(() => assertSeedAllowed('demo', { NODE_ENV: 'production', DEPLOY_ENV: 'dev' })).not.toThrow();
    expect(() => assertSeedAllowed('admin', { NODE_ENV: 'production' })).not.toThrow();
    expect(() => assertSeedAllowed('demo', { NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertSeedAllowed('demo', {})).not.toThrow();
  });
});

describe('seedAdminOnly (SEED_MODE=admin)', () => {
  it('yalnız platform yöneticisi ve bayraklar: demo işletme, demo hesap, sipariş yok; üretim dışı ortamda (DEPLOY_ENV=dev) kayıt kapalı', async () => {
    const res = await seedAdminOnly(ctx.db, { password: 'dev-parola-9', demoDeployment: true });
    expect(res).toMatchObject({ created: true, passwordSynced: false, demoTenants: 0 });
    expect(await ctx.db.select().from(tenants)).toHaveLength(0);
    const all = await ctx.db.select({ email: users.email, isPlatformAdmin: users.isPlatformAdmin, role: users.platformRole }).from(users);
    expect(all).toEqual([{ email: DEMO.admin.email, isPlatformAdmin: true, role: 'platform_owner' }]);
    expect(await flagMap()).toEqual({
      signup_open: false,
      wa_onboarding: true,
      campaigns_global: false,
      llm_parsing: false,
      sms_fallback: false,
      platform_wa_alerts: true,
    });
    // Yönetici SEED_PASSWORD ile girer; yerel geliştirme parolası (admin1234) geçmez
    expect((await ctx.loginAs(DEMO.admin.email, 'dev-parola-9')).res.json().isPlatformAdmin).toBe(true);
    const wrong = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { login: DEMO.admin.email, password: DEMO.admin.password },
      headers: { 'x-forwarded-for': '10.61.0.1' },
    });
    expect(wrong.statusCode).toBe(401);
    // Demo hesapları yok
    const owner = DEMO.users.find((u) => u.role === 'owner')!;
    expect(await ctx.db.select().from(users).where(eq(users.email, owner.email))).toHaveLength(0);
    // Kayıt kapalı (üretim dışı deneme ortamı; canlı ortamda açık, aşağıdaki testler)
    const status = await ctx.request({ method: 'GET', url: '/api/v1/public/signup-status' });
    expect(status.json()).toEqual({ open: false });
  });

  it('idempotent: tekrar çalışınca yönetici çoğalmaz; SEED_PASSWORD değişince eşitlenir, TOTP\'ye dokunulmaz; admin kararı korunur', async () => {
    await seedAdminOnly(ctx.db, { password: 'dev-parola-1', demoDeployment: true });
    await ctx.db.update(users).set({ totpEnabledAt: new Date(), totpSecretEnc: 'sifreli-sir' }).where(eq(users.email, DEMO.admin.email));
    // Proje sahibi kaydı bilerek açtı (Bayraklar ekranı: updated_by dolu)
    const [admin] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, DEMO.admin.email));
    await ctx.db.update(featureFlags).set({ enabled: true, updatedByUserId: admin!.id }).where(eq(featureFlags.key, 'signup_open'));

    const same = await seedAdminOnly(ctx.db, { password: 'dev-parola-1', demoDeployment: true });
    expect(same).toMatchObject({ created: false, passwordSynced: false });
    const changed = await seedAdminOnly(ctx.db, { password: 'dev-parola-2', demoDeployment: true });
    expect(changed).toMatchObject({ created: false, passwordSynced: true });

    const rows = await ctx.db.select().from(users).where(eq(users.email, DEMO.admin.email));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totpEnabledAt).not.toBeNull();
    expect(rows[0]!.totpSecretEnc).toBe('sifreli-sir');
    expect((await flagMap()).signup_open).toBe(true);
    expect(changed.flags.find((f) => f.key === 'signup_open')).toMatchObject({ enabled: true, action: 'kept' });
  });

  it('SEED_PASSWORD zorunlu; aynı e-posta platform yöneticisi olmayan hesaptaysa yetki verilmez', async () => {
    await expect(seedAdminOnly(ctx.db, { password: '' })).rejects.toThrow(/SEED_PASSWORD zorunlu/);
    await expect(seedAdminOnly(ctx.db, { password: 'kisa' })).rejects.toThrow(/en az 8/);
    await ctx.createUser({ email: DEMO.admin.email, password: 'baskasinin-parolasi' });
    await expect(seedAdminOnly(ctx.db, { password: 'dev-parola-3' })).rejects.toThrow(/platform yöneticisi olmayan/);
    const [u] = await ctx.db.select().from(users).where(eq(users.email, DEMO.admin.email));
    expect(u!.isPlatformAdmin).toBe(false);
    // İşlem geri alındı: bayrak da yazılmadı
    expect(await flagMap()).toEqual({});
  });

  it('DEPLOY_ENV=production + admin kipi: kayıt açık başlar; demo işletme varsa sayar (silmez)', async () => {
    await seedDemo(ctx.db);
    await ctx.db.delete(featureFlags);
    const res = await seedAdminOnly(ctx.db, { password: 'dev-parola-4' });
    expect(res.demoTenants).toBe(2);
    expect((await flagMap()).signup_open).toBe(true);
    expect(await ctx.db.select().from(tenants)).toHaveLength(2);
  });

  it('canlı ortama geçiş (00 §12a madde 10): önceki dönemde seed\'in kapalı yazdığı kayıt açılır; yöneticinin kararı korunur', async () => {
    // Önceki dönem: Cloudflare ortamı canlı değilken (DEPLOY_ENV=dev) seed kaydı kapalı yazdı, kimse elle değiştirmedi
    await seedAdminOnly(ctx.db, { password: 'dev-parola-5', demoDeployment: true });
    expect((await flagMap()).signup_open).toBe(false);
    // Canlı ortam (DEPLOY_ENV=production): elle değiştirilmemiş bayrak ortam varsayılanını izler
    const live = await seedAdminOnly(ctx.db, { password: 'dev-parola-5' });
    expect(live.flags.find((f) => f.key === 'signup_open')).toEqual({ key: 'signup_open', enabled: true, action: 'updated' });
    expect((await ctx.request({ method: 'GET', url: '/api/v1/public/signup-status' })).json()).toEqual({ open: true });
    // Diğer bayraklar üretim varsayılanlarında kalır
    expect(await flagMap()).toEqual({
      signup_open: true,
      wa_onboarding: true,
      campaigns_global: false,
      llm_parsing: false,
      sms_fallback: false,
      platform_wa_alerts: true,
    });

    // Yönetici kaydı bilerek kapattı (acil durdurma): sonraki açılışlar dokunmaz
    const [admin] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, DEMO.admin.email));
    await ctx.db.update(featureFlags).set({ enabled: false, updatedByUserId: admin!.id }).where(eq(featureFlags.key, 'signup_open'));
    const again = await seedAdminOnly(ctx.db, { password: 'dev-parola-5' });
    expect(again.flags.find((f) => f.key === 'signup_open')).toEqual({ key: 'signup_open', enabled: false, action: 'kept' });
    expect((await flagMap()).signup_open).toBe(false);
  });
});

describe('üretim bayrakları (ensureProductionFlags)', () => {
  it('varsayılanlar: kayıt açık, kampanya ve yapay zeka kapalı, SMS yedeği Netgsm varsa açık', async () => {
    expect(productionFlagDefaults({ smsConfigured: true })).toEqual({
      signup_open: true,
      wa_onboarding: true,
      campaigns_global: false,
      llm_parsing: false,
      sms_fallback: true,
      platform_wa_alerts: true,
    });
    const out = await ensureProductionFlags(ctx.db, { smsConfigured: false });
    expect(out.every((f) => f.action === 'created')).toBe(true);
    expect(await flagMap()).toEqual({
      signup_open: true,
      wa_onboarding: true,
      campaigns_global: false,
      llm_parsing: false,
      sms_fallback: false,
      platform_wa_alerts: true,
    });
  });

  it('var olan bayrağa dokunmaz; elle değiştirilmemiş sms_fallback SMS yapılandırmasını izler', async () => {
    await ensureProductionFlags(ctx.db, { smsConfigured: false });
    const admin = await ctx.createUser({ isPlatformAdmin: true, platformRole: 'platform_owner' });
    // Yönetici kaydı kapattı (kill-switch) ve kampanyaları açtı
    await ctx.db.update(featureFlags).set({ enabled: false, updatedByUserId: admin.id }).where(eq(featureFlags.key, 'signup_open'));
    await ctx.db.update(featureFlags).set({ enabled: true, updatedByUserId: admin.id }).where(eq(featureFlags.key, 'campaigns_global'));

    // Netgsm sonradan tanımlandı: sms_fallback açılır, diğerleri korunur
    const out = await ensureProductionFlags(ctx.db, { smsConfigured: true });
    expect(out.find((f) => f.key === 'sms_fallback')).toEqual({ key: 'sms_fallback', enabled: true, action: 'updated' });
    expect(await flagMap()).toMatchObject({ signup_open: false, campaigns_global: true, sms_fallback: true });

    // Yönetici SMS yedeğini bilerek kapattıysa Netgsm tanımlı olsa da dokunulmaz
    await ctx.db.update(featureFlags).set({ enabled: false, updatedByUserId: admin.id }).where(eq(featureFlags.key, 'sms_fallback'));
    const again = await ensureProductionFlags(ctx.db, { smsConfigured: true });
    expect(again.find((f) => f.key === 'sms_fallback')).toEqual({ key: 'sms_fallback', enabled: false, action: 'kept' });
  });

  it('isSmsConfigured: netgsm + üç değer dolu', () => {
    const full = { SMS_PROVIDER: 'netgsm', NETGSM_USERCODE: '850', NETGSM_PASSWORD: 'p', NETGSM_HEADER: 'YEMEKGELSIN' };
    expect(isSmsConfigured(full)).toBe(true);
    expect(isSmsConfigured({ ...full, NETGSM_HEADER: ' ' })).toBe(false);
    expect(isSmsConfigured({ ...full, SMS_PROVIDER: 'mock' })).toBe(false);
    expect(isSmsConfigured({})).toBe(false);
  });
});

describe('GET /public/signup-status', () => {
  it('bayrak yoksa açık (kill-switch varsayılanı), kapatılınca kapalı; önbelleğe alınmaz', async () => {
    const open = await ctx.request({ method: 'GET', url: '/api/v1/public/signup-status' });
    expect(open.statusCode).toBe(200);
    expect(open.json()).toEqual({ open: true });
    expect(open.headers['cache-control']).toBe('no-store');
    await ctx.db.insert(featureFlags).values({ key: 'signup_open', enabled: false, kind: 'kill_switch' });
    expect((await ctx.request({ method: 'GET', url: '/api/v1/public/signup-status' })).json()).toEqual({ open: false });
  });
});

describe('betikler (canlı ortam dağıtımı)', () => {
  it('bootstrap-production.ts: bayrakları yazar, demo verisi oluşturmaz, demo işletme varsa uyarır', async () => {
    const r = await script('scripts/bootstrap-production.ts', [], {
      SMS_PROVIDER: 'netgsm',
      NETGSM_USERCODE: '8501234567',
      NETGSM_PASSWORD: 'gizli',
      NETGSM_HEADER: 'YEMEKGELSIN',
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Netgsm tanımlı/);
    expect(r.stdout).toMatch(/signup_open\s+açık \(yeni\)/);
    expect(await flagMap()).toMatchObject({ signup_open: true, sms_fallback: true, campaigns_global: false, llm_parsing: false });
    expect(await ctx.db.select().from(tenants)).toHaveLength(0);
    expect(await ctx.db.select().from(users)).toHaveLength(0);

    await seedDemo(ctx.db);
    const again = await script('scripts/bootstrap-production.ts', [], { SMS_PROVIDER: 'mock' });
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/signup_open\s+açık \(dokunulmadı\)/);
    expect(again.stderr).toMatch(/2 demo işletme/);
  });

  it('seed.ts SEED_MODE=admin + DEPLOY_ENV=production (canlı ortam container\'ı): yalnız yönetici; elle değiştirilmemiş kapalı kayıt açılır; demo seed reddedilir', async () => {
    await seedAdminOnly(ctx.db, { password: 'dev-parola-6', demoDeployment: true });
    expect((await flagMap()).signup_open).toBe(false);
    const env = { NODE_ENV: 'production', DEPLOY_ENV: 'production', SEED_MODE: 'admin', SEED_PASSWORD: 'dev-parola-6', SMS_PROVIDER: 'mock' };
    const r = await script('packages/db/src/seed.ts', [], env);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/signup_open\s+açık \(elle değiştirilmemişti; ortam varsayılanına göre güncellendi\)/);
    expect(r.stdout).not.toContain('dev-parola-6');
    expect(await flagMap()).toMatchObject({ signup_open: true, sms_fallback: false });
    expect(await ctx.db.select().from(tenants)).toHaveLength(0);
    // Tekrar: dokunulmaz
    const again = await script('packages/db/src/seed.ts', [], env);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/signup_open\s+açık \(dokunulmadı\)/);
    // Canlı ortamda demo seed kod düzeyinde reddedilir
    const demo = await script('packages/db/src/seed.ts', [], { ...env, SEED_MODE: 'demo' });
    expect(demo.code).not.toBe(0);
    expect(demo.stderr).toMatch(/demo seed çalıştırılmaz/);
    expect(await ctx.db.select().from(tenants)).toHaveLength(0);
  });

  it('create-admin --if-missing: yoksa oluşturur; varsa parolaya ve iki adımlı doğrulamaya dokunmaz', async () => {
    const args = ['scripts/create-admin.ts', '--email', 'admin@yemekgelsin.net', '--name', 'Platform Yöneticisi', '--if-missing'];
    const first = await script(args[0]!, args.slice(1), { ADMIN_PASSWORD: 'uzun-bir-parola-123' });
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).toMatch(/Oluşturuldu: admin@yemekgelsin.net \(platform_owner\)/);
    expect(first.stdout).not.toContain('uzun-bir-parola-123');
    expect((await ctx.loginAs('admin@yemekgelsin.net', 'uzun-bir-parola-123')).res.json().isPlatformAdmin).toBe(true);

    await ctx.db.update(users).set({ totpEnabledAt: new Date(), totpSecretEnc: 'sifreli-sir' }).where(eq(users.email, 'admin@yemekgelsin.net'));
    const [before] = await ctx.db.select().from(users).where(eq(users.email, 'admin@yemekgelsin.net'));
    // Farklı (hatta kısa) parolayla yeniden: dokunulmaz, 0 ile çıkar
    const second = await script(args[0]!, args.slice(1), { ADMIN_PASSWORD: 'baska' });
    expect(second.code, second.stderr).toBe(0);
    expect(second.stdout).toMatch(/Zaten var: admin@yemekgelsin.net .*dokunulmadı/);
    const [after] = await ctx.db.select().from(users).where(eq(users.email, 'admin@yemekgelsin.net'));
    expect(after!.passwordHash).toBe(before!.passwordHash);
    expect(after!.totpSecretEnc).toBe('sifreli-sir');
    expect(after!.totpEnabledAt).not.toBeNull();
  });

  it('create-admin --if-missing: platform yöneticisi olmayan hesaba yetki vermez (3); parola verilmezse üretip basmaz (1)', async () => {
    await ctx.createUser({ email: 'admin@yemekgelsin.net', password: 'isletme-parolasi' });
    const args = ['--email', 'admin@yemekgelsin.net', '--name', 'Platform Yöneticisi', '--if-missing'];
    const denied = await script('scripts/create-admin.ts', args, { ADMIN_PASSWORD: 'uzun-bir-parola-123' });
    expect(denied.code).toBe(3);
    expect(denied.stderr).toMatch(/platform yöneticisi olmayan bir hesaba ait/);
    const [u] = await ctx.db.select().from(users).where(eq(users.email, 'admin@yemekgelsin.net'));
    expect(u!.isPlatformAdmin).toBe(false);

    await ctx.truncateAll();
    const noPassword = await script('scripts/create-admin.ts', args);
    expect(noPassword.code).toBe(1);
    expect(noPassword.stderr).toMatch(/ADMIN_PASSWORD/);
    expect(noPassword.stdout).not.toMatch(/Parola/);
    expect(await ctx.db.select().from(users)).toHaveLength(0);

    const short = await script('scripts/create-admin.ts', args, { ADMIN_PASSWORD: 'kisa-parola' });
    expect(short.code).toBe(1);
    expect(short.stderr).toMatch(/en az 12 karakter/);
  });
});
