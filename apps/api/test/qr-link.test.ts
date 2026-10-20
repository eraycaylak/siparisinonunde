// QR kısa bağlantısı (00 §2, §12a madde 11; O4): GET /api/v1/public/q/:code → yalnız { slug }. Kod = tenants.wa_code,
// büyük/küçük harf ve Türkçe harf duyarsız (normalizeWaCode); bilinmeyen/biçimsiz kod 404; IP başına oran sınırı;
// sipariş almayan (askıda, kapanmış, canlıya geçmemiş, kendi numaralı) işletmede de slug döner (vitrin bandı gösterir).
// TENANT YALITIMI: yanıt başka işletmenin hiçbir bilgisini (ad, telefon, kimlik, kod, mod) taşımaz; bir işletmenin kodu
// yalnız kendi vitrinine çözülür. Panel ve admin QR'ları ortak numaranın wa.me bağlantısını değil /q/<kod>'u kodlar.
// EMEKLİ KOD (retired_wa_codes; 00 §3): admin kodu değiştirince eski kod eski sahibine çözülmeye devam eder ve başka
// işletmeye (kayıtta üretim ya da admin ataması) hiçbir zaman verilmez — sahadaki basılı QR rakibe gitmez.

import { retiredWaCodes, tenants } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC_QR_RATE_LIMIT } from '../src/routes/public/index';
import { findSharedRoute } from '../src/services/messaging/shared-router';
import { generateWaCode } from '../src/services/messaging/shared';
import { createPlatformUsers } from './admin-helpers';
import { createTestContext, expectError, type TestContext } from './helpers';
import { setupSharedTenant, setupWaTenant, sharedInbound, type WaSetup } from './wa-helpers';

let ctx: TestContext;
let A: WaSetup; // ortak numara, #BOZOK
let B: WaSetup; // ortak numara, #DONER
let C: WaSetup; // kendi numaralı, #KENDI

let ip = 1;
let seq = 0;
const nextPhone = () => `+90538${String(4000000 + seq++).slice(-7)}`;
const nextIp = () => `198.51.100.${ip++}`;
const resolve = (code: string, forwardedFor = nextIp()) =>
  ctx.request({ method: 'GET', url: `/api/v1/public/q/${encodeURIComponent(code)}`, headers: { 'x-forwarded-for': forwardedFor } });

beforeAll(async () => {
  ctx = await createTestContext();
  A = await setupSharedTenant(ctx, { name: 'Bozok Pide Salonu', code: 'BOZOK' });
  B = await setupSharedTenant(ctx, { name: 'Çamlık Döner', code: 'DONER' });
  C = await setupWaTenant(ctx, { name: 'Kendi Numaralı Lokanta' });
  await ctx.db.update(tenants).set({ waCode: 'KENDI' }).where(eq(tenants.id, C.tenantId));
});
afterAll(async () => {
  await ctx.close();
});

describe('GET /public/q/:code', () => {
  it('geçerli kod → yalnız slug (başka alan yok); önbelleğe alınmaz', async () => {
    const res = await resolve('BOZOK');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ slug: A.slug });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('küçük harf, # öneki, boşluk ve Türkçe harf aynı koda katlanır', async () => {
    for (const code of ['bozok', '#bozok', ' Bozok ', 'BoZoK']) expect((await resolve(code)).json(), code).toEqual({ slug: A.slug });
    expect((await resolve('döner')).json()).toEqual({ slug: B.slug });
    expect((await resolve('DÖNER')).json()).toEqual({ slug: B.slug });
  });

  it('bilinmeyen ve biçimsiz kod 404 not_found (öneri ya da liste yok)', async () => {
    for (const code of ['YOKBOYLE', 'ab', '1453', 'çok-uzun-bir-kod-olur-mu-bu', '../admin']) {
      const res = await resolve(code);
      expectError(res, 404, 'not_found');
      expect(res.body).not.toMatch(/BOZOK|DONER|Bozok|Döner|slug/);
    }
  });

  it('sipariş almayan işletme de vitrine çözülür: askıda, salt-okunur, kapanmış, canlı değil, sipariş kapalı', async () => {
    const S = await setupSharedTenant(ctx, { name: 'Askıdaki Kebap', code: 'ASKIDA' });
    for (const patch of [
      { lifecycleStage: 'suspended' as const, suspensionReason: 'payment' as const },
      { lifecycleStage: 'read_only' as const, suspensionReason: null },
      { lifecycleStage: 'churned' as const, suspensionReason: null },
      { lifecycleStage: 'trial' as const, suspensionReason: null, webLiveAt: null },
      { lifecycleStage: 'trial' as const, suspensionReason: null, orderingEnabled: false },
    ]) {
      await ctx.db.update(tenants).set(patch).where(eq(tenants.id, S.tenantId));
      expect((await resolve('askida')).json(), JSON.stringify(patch)).toEqual({ slug: S.slug });
    }
  });

  it('kendi numaralı işletmenin kodu da vitrine çözülür (mod değişince yeniden basım gerekmez)', async () => {
    expect((await resolve('KENDI')).json()).toEqual({ slug: C.slug });
  });

  it('IP başına oran sınırı: dakikada 60 çözümleme, sonra 429 (başka IP etkilenmez)', async () => {
    const who = '203.0.113.77';
    for (let i = 0; i < PUBLIC_QR_RATE_LIMIT.limit; i++) expect((await resolve(i % 2 ? 'BOZOK' : 'YOKBOYLE', who)).statusCode).not.toBe(429);
    expectError(await resolve('BOZOK', who), 429, 'rate_limited');
    expect((await resolve('BOZOK')).statusCode).toBe(200);
  });

  it('IPv6: aynı /64 içindeki farklı adresler tek kovadır (adres değiştirerek sınır aşılamaz); başka /64 etkilenmez', async () => {
    for (let i = 0; i < PUBLIC_QR_RATE_LIMIT.limit; i++) {
      expect((await resolve('BOZOK', `2001:db8:77:1::${(i + 1).toString(16)}`)).statusCode).not.toBe(429);
    }
    expectError(await resolve('BOZOK', '2001:db8:77:1:ffff:eeee:dddd:cccc'), 429, 'rate_limited');
    expect((await resolve('BOZOK', '2001:db8:77:2::1')).statusCode).toBe(200);
  });
});

describe('tenant yalıtımı', () => {
  it('her kod yalnız kendi işletmesinin slug\'ına çözülür; yanıt başka işletmenin adını, telefonunu, kimliğini ya da kodunu taşımaz', async () => {
    const rows = await ctx.db.select().from(tenants);
    for (const t of rows.filter((r) => r.waCode)) {
      const res = await resolve(t.waCode!.toLowerCase());
      expect(res.json()).toEqual({ slug: t.slug });
      for (const other of rows.filter((r) => r.id !== t.id)) {
        expect(res.body, `${t.waCode} → ${other.slug}`).not.toContain(other.slug);
        expect(res.body).not.toContain(other.name);
        expect(res.body).not.toContain(other.id);
      }
      // Kendi işletmesinin de yalnız slug'ı: ad, kimlik, telefon, mod, kod yok
      expect(res.body).not.toContain(t.id);
      expect(res.body).not.toContain(t.name);
      expect(res.body).not.toMatch(/waMode|waCode|phone|name|tenantId|shared|own/);
    }
  });

  it('bir işletmenin oturumu (çerezi) yanıtı değiştirmez: herkese açık uç, işletme bağlamı kullanmaz', async () => {
    const res = await ctx.request({ method: 'GET', url: '/api/v1/public/q/DONER', cookie: A.ownerCookie, headers: { 'x-forwarded-for': nextIp() } });
    expect(res.json()).toEqual({ slug: B.slug });
  });
});

describe('QR üreticileri /q/<kod> bağlantısını kodlar (ortak numara wa.me QR\'ı yerine)', () => {
  it('panel GET /whatsapp: qrUrl = APP_BASE_URL/q/<kod>; qrSvg ve indirme bu bağlantıyı kodlar', async () => {
    const base = ctx.config.APP_BASE_URL.replace(/\/$/, '');
    const res = (await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp', cookie: A.ownerCookie })).json();
    expect(res.qrUrl).toBe(`${base}/q/BOZOK`);
    expect(res.shared.qrSvg).toMatch(/^<svg/);
    // Kendi numaralı işletme de /q/ QR'ı alır
    const own = (await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp', cookie: C.ownerCookie })).json();
    expect(own.qrUrl).toBe(`${base}/q/KENDI`);
    const png = await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp/qr?format=png', cookie: C.ownerCookie });
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-disposition']).toBe('attachment; filename="menu-qr-kendi.png"');
  });

  it('QR içeriği: aynı bağlantının QR SVG\'si ile birebir aynı (wa.me değil)', async () => {
    const { qrSvgFor } = await import('../src/routes/panel/whatsapp');
    const base = ctx.config.APP_BASE_URL.replace(/\/$/, '');
    const svg = await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp/qr?format=svg', cookie: A.ownerCookie });
    expect(svg.body).toBe(await qrSvgFor(`${base}/q/BOZOK`));
    const res = (await ctx.request({ method: 'GET', url: '/api/v1/panel/whatsapp', cookie: A.ownerCookie })).json();
    expect(svg.body).not.toBe(await qrSvgFor(res.shared.waLink));
    expect(res.shared.qrSvg).toBe(await qrSvgFor(`${base}/q/BOZOK`));
  });
});

describe('emekli kod (kod değişince basılı QR rakibe gitmez)', () => {
  const patch = (id: string, cookie: string, waCode: string) =>
    ctx.request({ method: 'PATCH', url: `/api/v1/admin/tenants/${id}`, cookie, body: { reason: 'QR kısa kodu değişikliği', waCode } });

  it('kod değişince eski kod emekliye ayrılır ve ESKİ SAHİBİNE çözülür; yeni kod da aynı vitrine', async () => {
    const R = await setupSharedTenant(ctx, { name: 'Sorgun Pide', code: 'SORGUN' });
    const p = await createPlatformUsers(ctx);
    const res = await patch(R.tenantId, p.platform_admin.cookie, 'sorgunpide');
    expect(res.statusCode, res.body).toBe(200);
    expect((await resolve('SORGUNPIDE')).json()).toEqual({ slug: R.slug });
    expect((await resolve('sorgun')).json()).toEqual({ slug: R.slug });
    expect(await ctx.db.select({ tenantId: retiredWaCodes.tenantId, code: retiredWaCodes.code }).from(retiredWaCodes).where(eq(retiredWaCodes.tenantId, R.tenantId))).toEqual([
      { tenantId: R.tenantId, code: 'SORGUN' },
    ]);
    // Ortak numarada eski QR'ın ön-dolu "#SORGUN" mesajı da eski sahibine gider
    const phone = nextPhone();
    await sharedInbound(ctx, { phone }, { type: 'text', text: '#SORGUN' });
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ currentTenantId: R.tenantId });
  });

  it('TENANT YALITIMI: emekli kod yeni kayıtta üretilmez ve admin başka işletmeye atayamaz (409); eski kod başka işletmeye çözülmez', async () => {
    const R = await setupSharedTenant(ctx, { name: 'Akdağ Kebap', code: 'AKDAG' });
    const p = await createPlatformUsers(ctx);
    expect((await patch(R.tenantId, p.platform_admin.cookie, 'AKDAGKEBAP')).statusCode).toBe(200);
    // Yeni kayıt: 'akdag-lokantasi' slug'ının ilk adayı AKDAG emekli → rakam soneki
    const generated = await generateWaCode(ctx.db, 'akdag-lokantasi');
    expect(generated).not.toBe('AKDAG');
    expect(generated).toMatch(/^AKDAG\d+$/); // AKDAG2…9 sipariş koduna benzer (6 karakter + rakam), atlanır
    // Admin başka işletmeye atayamaz: açıklayıcı 409, kod değişmez
    const taken = await patch(B.tenantId, p.platform_admin.cookie, 'akdag');
    expectError(taken, 409, 'wa_code_taken');
    expect(taken.json().error.message).toContain('eski kodu');
    const [b] = await ctx.db.select().from(tenants).where(eq(tenants.id, B.tenantId));
    expect(b!.waCode).toBe('DONER');
    // Eski kod yalnız eski sahibinin slug'ına çözülür; yanıt başka işletmenin hiçbir bilgisini taşımaz
    const res = await resolve('AKDAG');
    expect(res.json()).toEqual({ slug: R.slug });
    for (const other of [A, B, C]) {
      expect(res.body).not.toContain(other.slug);
      expect(res.body).not.toContain(other.tenantId);
    }
  });

  it('işletme kendi eski koduna dönebilir: emekli satır kalkar, bıraktığı kod emekliye ayrılır', async () => {
    const R = await setupSharedTenant(ctx, { name: 'Çekerek Döner', code: 'CEKEREK' });
    const p = await createPlatformUsers(ctx);
    expect((await patch(R.tenantId, p.platform_admin.cookie, 'CEKEREKD')).statusCode).toBe(200);
    const back = await patch(R.tenantId, p.platform_admin.cookie, 'cekerek');
    expect(back.statusCode, back.body).toBe(200);
    const [r] = await ctx.db.select().from(tenants).where(eq(tenants.id, R.tenantId));
    expect(r!.waCode).toBe('CEKEREK');
    const rows = await ctx.db.select({ code: retiredWaCodes.code }).from(retiredWaCodes).where(eq(retiredWaCodes.tenantId, R.tenantId));
    expect(rows.map((x) => x.code)).toEqual(['CEKEREKD']);
    expect((await resolve('CEKEREKD')).json()).toEqual({ slug: R.slug });
    expect((await resolve('CEKEREK')).json()).toEqual({ slug: R.slug });
  });
});
