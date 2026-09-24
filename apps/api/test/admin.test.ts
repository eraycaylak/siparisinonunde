// Admin API (14 §6.4; 05 §A): özet, işletmeler, notlar, WhatsApp sağlığı, işler/DLQ, bayraklar, lead'ler, audit.
// Her uç nokta: başarılı yol + 05 §A.3 rol matrisi + işletme kullanıcısı erişemez.

import { auditLog, featureFlags, jobs, leads, orders, subscriptions, tenants, waAccounts } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isFlagEnabled } from '../src/lib/flags';
import { processDueJobs, registerJobHandler } from '../src/lib/jobs';
import { addMessages, createJob, createPlatformUsers, createWaAccount, type PlatformUsers } from './admin-helpers';
import { createTestContext, expectError, type TestContext, type TestTenant } from './helpers';

let ctx: TestContext;
let p: PlatformUsers;
let a: TestTenant;
let b: TestTenant;

const API = '/api/v1/admin';

beforeAll(async () => {
  ctx = await createTestContext();
  p = await createPlatformUsers(ctx);
  a = await ctx.createTenantWithOwner({ name: 'Akdağ Pide', slug: 'akdag-pide' });
  b = await ctx.createTenantWithOwner({ name: 'Bozok Döner', slug: 'bozok-doner' });
  await ctx.db.update(tenants).set({ phone: '+905321112233' }).where(eq(tenants.id, a.tenantId));
});

afterAll(async () => {
  await ctx.close();
});

const get = (url: string, cookie?: string) => ctx.request({ method: 'GET', url: `${API}${url}`, cookie });
const patch = (url: string, cookie: string, body: unknown) => ctx.request({ method: 'PATCH', url: `${API}${url}`, cookie, body });
const post = (url: string, cookie: string, body: unknown = {}) => ctx.request({ method: 'POST', url: `${API}${url}`, cookie, body });

describe('erişim', () => {
  it('oturumsuz 401, işletme kullanıcısı 403, destek oturumu 403', async () => {
    const urls = ['/overview', '/tenants', `/tenants/${a.tenantId}`, '/whatsapp', '/jobs', '/flags', '/leads', '/audit'];
    for (const url of urls) {
      expectError(await get(url), 401, 'unauthorized');
      expectError(await get(url, a.ownerCookie), 403, 'forbidden');
    }
    const imp = await ctx.sessionCookie(p.support_agent.user.id, { tenantId: a.tenantId, kind: 'impersonation', readOnly: true });
    expectError(await get('/overview', imp), 403, 'forbidden');
    expectError(await patch(`/tenants/${a.tenantId}`, a.ownerCookie, { reason: 'Deneme amaçlı değişiklik', orderingEnabled: false }), 403, 'forbidden');
  });
});

describe('GET /admin/overview', () => {
  it('lifecycle sayıları, bugünkü sipariş/ciro (test hariç), kaçan sipariş, işler, WA, lead', async () => {
    await ctx.createOrder({ tenantId: a.tenantId, branchId: a.branchId, status: 'delivered', totalKurus: 15000 });
    await ctx.createOrder({ tenantId: a.tenantId, branchId: a.branchId, status: 'accepted', totalKurus: 5000 });
    // Test siparişi raporlardan hariç
    await ctx.createOrder({ tenantId: a.tenantId, branchId: a.branchId, status: 'delivered', totalKurus: 99900, extra: { testKind: 'onboarding_test' } });
    // Kaçan sipariş (tenant_no_response)
    await ctx.createOrder({
      tenantId: b.tenantId,
      branchId: b.branchId,
      status: 'cancelled',
      totalKurus: 7000,
      extra: { cancelReason: 'tenant_no_response', cancelledBy: 'system', cancelledAt: new Date() },
    });
    // 3 dk'dır bekleyen yeni sipariş
    await ctx.createOrder({ tenantId: b.tenantId, branchId: b.branchId, status: 'new', totalKurus: 3000, extra: { placedAt: new Date(Date.now() - 3 * 60_000) } });
    await createJob(ctx, { status: 'failed', tenantId: a.tenantId });
    await createWaAccount(ctx, { tenantId: b.tenantId, branchId: b.branchId, status: 'error', lastError: '131042 ödeme yöntemi yok' });
    await ctx.db.insert(leads).values({ name: 'Lead Bir', businessName: 'Lead Pide', phone: '+905300000001', city: 'Yozgat', source: 'demo_form' });

    const res = await get('/overview', p.sales_rep.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const o = res.json();
    expect(o.tenantsTotal).toBe(2);
    expect(o.tenantsByStage.trial).toBe(2);
    expect(o.tenantsByStage.active).toBe(0);
    expect(o.ordersToday).toBe(4); // delivered + accepted + cancelled + new (test hariç)
    expect(o.revenueTodayKurus).toBe(15000 + 5000 + 3000); // iptal ve test hariç
    expect(o.missedOrders24h).toBe(1);
    expect(o.openNewOrders).toBe(1);
    expect(o.lateNewOrders).toBe(1);
    expect(o.failedJobs).toBeGreaterThanOrEqual(1);
    expect(o.waErrorAccounts).toBe(1);
    expect(o.newTenants7d).toBe(2);
    expect(o.leadsTotal).toBe(1);
    expect(o.leadsNew).toBe(1);
    expect(o.alerts.missedOrders[0].tenantName).toBe('Bozok Döner');
    expect(o.alerts.waProblems[0].status).toBe('error');
    expect(o.alerts.failedJobs.length).toBeGreaterThanOrEqual(1);
    expect(o.alerts.newLeads[0].businessName).toBe('Lead Pide');
  });
});

describe('GET /admin/tenants', () => {
  it('ad/slug/telefon araması, aşama filtresi, son sipariş ve 7 günlük sayı, WA durumu', async () => {
    const all = await get('/tenants', p.support_agent.cookie);
    expect(all.statusCode, all.body).toBe(200);
    const items = all.json().items as Array<Record<string, unknown>>;
    expect(items.map((i) => i.slug).sort()).toEqual(['akdag-pide', 'bozok-doner']);
    const akdag = items.find((i) => i.slug === 'akdag-pide')!;
    expect(akdag.orders7d).toBe(2); // test siparişi hariç
    expect(akdag.lastOrderAt).toBeTruthy();
    expect(items.find((i) => i.slug === 'bozok-doner')!.waStatus).toBe('error');

    expect((await get(`/tenants?q=${encodeURIComponent('akdağ')}`, p.finance.cookie)).json().items).toHaveLength(1);
    expect((await get('/tenants?q=bozok-d', p.finance.cookie)).json().items[0].slug).toBe('bozok-doner');
    // İşletme telefonu (tam eşleşme, farklı yazım)
    expect((await get(`/tenants?q=${encodeURIComponent('0532 111 22 33')}`, p.finance.cookie)).json().items[0].slug).toBe('akdag-pide');
    // Sahip telefonu
    const owner = await ctx.createUser({ name: 'Telefonlu Sahip', phone: '+905339998877' });
    await ctx.addMember(b.tenantId, owner.id, 'owner');
    expect((await get('/tenants?q=05339998877', p.finance.cookie)).json().items[0].slug).toBe('bozok-doner');
    expect((await get('/tenants?stage=active', p.finance.cookie)).json().items).toHaveLength(0);
    expectError(await get('/tenants?stage=yok', p.finance.cookie), 400, 'validation_error');
  });

  it('imleçle sayfalama', async () => {
    const first = (await get('/tenants?limit=1', p.platform_admin.cookie)).json();
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = (await get(`/tenants?limit=1&cursor=${first.nextCursor}`, p.platform_admin.cookie)).json();
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(second.nextCursor).toBeUndefined();
    expectError(await get('/tenants?cursor=bozuk', p.platform_admin.cookie), 400, 'invalid_cursor');
  });
});

describe('GET /admin/tenants/:id', () => {
  it('profil, şubeler, üyeler, abonelik, WA, son siparişler; kişisel veri ve sır yok; audit', async () => {
    const res = await get(`/tenants/${a.tenantId}`, p.support_agent.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const d = res.json();
    expect(d.tenant.slug).toBe('akdag-pide');
    expect(d.branches).toHaveLength(1);
    expect(d.branches[0].orderingState).toBe('open');
    expect(d.members.some((m: { role: string }) => m.role === 'owner')).toBe(true);
    expect(d.subscription.status).toBe('trialing');
    expect(d.recentOrders.length).toBe(3);
    expect(d.stats.orders7d).toBe(2);
    expect(d.allowedLifecycleTransitions).toEqual([]); // SA aşama değiştiremez
    // Son müşteri verisi ve sırlar yanıtta yok (05 §A.1 #8, #9)
    expect(res.body).not.toContain('Test Müşteri');
    expect(res.body).not.toContain('+905321234567');
    expect(res.body).not.toMatch(/apiKey|webhookToken|passwordHash|tokenHash|totpSecret/i);

    // Hassas okuma audit'e yazılır; aynı aktörün 10 dk içindeki tekrarları tek kayıt
    expect((await get(`/tenants/${a.tenantId}`, p.support_agent.cookie)).statusCode).toBe(200);
    const view = await ctx.db.select().from(auditLog).where(and(eq(auditLog.action, 'admin.tenant_view'), eq(auditLog.tenantId, a.tenantId)));
    expect(view).toHaveLength(1);
    expect(view[0]!.actorUserId).toBe(p.support_agent.user.id);

    const po = (await get(`/tenants/${a.tenantId}`, p.platform_owner.cookie)).json();
    expect(po.allowedLifecycleTransitions).toEqual(expect.arrayContaining(['active', 'pilot', 'suspended']));
    expectError(await get('/tenants/00000000-0000-4000-8000-000000000000', p.platform_owner.cookie), 404, 'not_found');
  });

  it('WA hesabında numara maskeli, anahtar yok', async () => {
    const d = (await get(`/tenants/${b.tenantId}`, p.platform_admin.cookie)).json();
    expect(d.waAccounts).toHaveLength(1);
    expect(d.waAccounts[0].displayPhoneMasked).toBe('0*** *** 11 22');
    expect(JSON.stringify(d)).not.toContain('gizli:anahtar');
  });
});

describe('GET /admin/tenants/:id/orders', () => {
  it('imleçli liste, müşteri bilgisi yok, başka tenant karışmaz', async () => {
    const first = await get(`/tenants/${a.tenantId}/orders?limit=2`, p.finance.cookie);
    expect(first.statusCode, first.body).toBe(200);
    const body = first.json();
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeTruthy();
    expect(first.body).not.toContain('Test Müşteri');
    const rest = (await get(`/tenants/${a.tenantId}/orders?limit=2&cursor=${body.nextCursor}`, p.finance.cookie)).json();
    expect(rest.items).toHaveLength(1);
    const ids = new Set([...body.items, ...rest.items].map((o: { id: string }) => o.id));
    expect(ids.size).toBe(3);
    const bOrders = await ctx.db.select({ id: orders.id }).from(orders).where(eq(orders.tenantId, b.tenantId));
    for (const o of bOrders) expect(ids.has(o.id)).toBe(false);
    expectError(await get('/tenants/00000000-0000-4000-8000-000000000000/orders', p.finance.cookie), 404, 'not_found');
  });
});

describe('PATCH /admin/tenants/:id', () => {
  const url = () => `/tenants/${a.tenantId}`;

  it('gerekçe zorunlu (≥ 10 karakter), değişiklik yoksa 400', async () => {
    expectError(await patch(url(), p.platform_owner.cookie, { orderingEnabled: false }), 400, 'validation_error');
    expectError(await patch(url(), p.platform_owner.cookie, { reason: 'kısa', orderingEnabled: false }), 400, 'validation_error');
    expectError(await patch(url(), p.platform_owner.cookie, { reason: 'Değişiklik yok testi', orderingEnabled: true }), 400, 'no_changes');
    expectError(await patch('/tenants/00000000-0000-4000-8000-000000000000', p.platform_owner.cookie, { reason: 'Olmayan işletme testi', orderingEnabled: false }), 404, 'not_found');
  });

  it('askıya alma: sebep zorunlu; abonelik senkron; audit', async () => {
    expectError(await patch(url(), p.platform_admin.cookie, { reason: 'Kötüye kullanım şikayeti', lifecycleStage: 'suspended' }), 400, 'suspension_reason_required');
    expectError(
      await patch(url(), p.platform_admin.cookie, { reason: 'Askı dışında sebep denemesi', suspensionReason: 'policy' }),
      400,
      'suspension_reason_not_allowed',
    );
    // SA ve SR askıya alamaz
    expectError(await patch(url(), p.support_agent.cookie, { reason: 'Kötüye kullanım şikayeti', lifecycleStage: 'suspended', suspensionReason: 'abuse' }), 403, 'forbidden');
    expectError(await patch(url(), p.sales_rep.cookie, { reason: 'Kötüye kullanım şikayeti', lifecycleStage: 'suspended', suspensionReason: 'abuse' }), 403, 'forbidden');

    const res = await patch(url(), p.platform_admin.cookie, { reason: 'Kötüye kullanım şikayeti', lifecycleStage: 'suspended', suspensionReason: 'abuse' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tenant.lifecycleStage).toBe('suspended');
    expect(res.json().tenant.suspensionReason).toBe('abuse');
    expect(res.json().subscription.status).toBe('suspended');

    const logs = await ctx.db.select().from(auditLog).where(eq(auditLog.tenantId, a.tenantId));
    const upd = logs.find((l) => l.action === 'admin.tenant_update');
    expect(upd?.actorUserId).toBe(p.platform_admin.user.id);
    expect(upd?.data).toMatchObject({
      reason: 'Kötüye kullanım şikayeti',
      actorRole: 'platform_admin',
      changes: { lifecycleStage: { from: 'trial', to: 'suspended' }, suspensionReason: { from: null, to: 'abuse' } },
    });
    expect(logs.some((l) => l.action === 'admin.subscription_update' && l.entityType === 'subscription')).toBe(true);
  });

  it('askıyı kaldırma: F yalnız ödeme kaynaklı askıyı kaldırır; sebep temizlenir', async () => {
    expectError(await patch(url(), p.finance.cookie, { reason: 'Ödeme alındı, açılıyor', lifecycleStage: 'active' }), 403, 'forbidden');
    const res = await patch(url(), p.platform_owner.cookie, { reason: 'İnceleme tamam, geri açıldı', lifecycleStage: 'active' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tenant.lifecycleStage).toBe('active');
    expect(res.json().tenant.suspensionReason).toBeNull();
    expect(res.json().subscription.status).toBe('active');

    // Ödeme kaynaklı askıyı F kaldırabilir
    await ctx.db.update(tenants).set({ lifecycleStage: 'suspended', suspensionReason: 'payment' }).where(eq(tenants.id, a.tenantId));
    const f = await patch(url(), p.finance.cookie, { reason: 'Havale geldi, hesap açıldı', lifecycleStage: 'active' });
    expect(f.statusCode, f.body).toBe(200);
    expect(f.json().tenant.lifecycleStage).toBe('active');
  });

  it('geçersiz geçiş 409; abonelik durumundan aşama türetilir', async () => {
    expectError(await patch(url(), p.platform_owner.cookie, { reason: 'Geçersiz geçiş denemesi', lifecycleStage: 'lead' }), 409, 'invalid_lifecycle_transition');
    const res = await patch(url(), p.finance.cookie, { reason: 'Tahsilat başarısız (G0)', subscription: { status: 'past_due' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tenant.lifecycleStage).toBe('past_due');
    expect(res.json().subscription.status).toBe('past_due');
    expectError(
      await patch(url(), p.finance.cookie, { reason: 'Tutarsız istek denemesi', lifecycleStage: 'active', subscription: { status: 'read_only' } }),
      400,
      'inconsistent_status',
    );
    // PA abonelik durumunu değiştiremez
    expectError(await patch(url(), p.platform_admin.cookie, { reason: 'Ödeme alındı bilgisi', subscription: { status: 'active' } }), 403, 'forbidden');
  });

  it('plan ve kurucu indirimi yalnız PO/F; ordering_enabled yalnız PO/PA', async () => {
    expectError(await patch(url(), p.platform_admin.cookie, { reason: 'Plan yükseltme talebi', planCode: 'zincir' }), 403, 'forbidden');
    const f = await patch(url(), p.finance.cookie, { reason: 'Plan yükseltme talebi', planCode: 'zincir', subscription: { founderDiscountBp: 3000 } });
    expect(f.statusCode, f.body).toBe(200);
    expect(f.json().tenant.planCode).toBe('zincir');
    expect(f.json().subscription.planCode).toBe('zincir');
    expect(f.json().subscription.founderDiscountBp).toBe(3000);

    expectError(await patch(url(), p.finance.cookie, { reason: 'Sipariş almayı durdur', orderingEnabled: false }), 403, 'forbidden');
    expectError(await patch(url(), p.sales_rep.cookie, { reason: 'Sipariş almayı durdur', orderingEnabled: false }), 403, 'forbidden');
    const pa = await patch(url(), p.platform_admin.cookie, { reason: 'Hukuki talep nedeniyle durduruldu', orderingEnabled: false });
    expect(pa.statusCode, pa.body).toBe(200);
    expect(pa.json().tenant.orderingEnabled).toBe(false);
    const [row] = await ctx.db.select().from(tenants).where(eq(tenants.id, a.tenantId));
    expect(row!.orderingEnabled).toBe(false);
  });

  it('deneme uzatma: SR tek sefer ve en fazla 14 gün; PO serbest', async () => {
    const [t] = await ctx.db.select().from(tenants).where(eq(tenants.id, b.tenantId));
    const base = t!.trialEndsAt ?? new Date();
    const plus = (days: number) => new Date(Math.max(base.getTime(), Date.now()) + days * 86400000).toISOString();
    const u = `/tenants/${b.tenantId}`;
    expectError(await patch(u, p.sales_rep.cookie, { reason: 'Görüşmede ek süre istendi', trialEndsAt: plus(20) }), 403, 'trial_extension_limit');
    expectError(await patch(u, p.support_agent.cookie, { reason: 'Görüşmede ek süre istendi', trialEndsAt: plus(5) }), 403, 'forbidden');
    const ok = await patch(u, p.sales_rep.cookie, { reason: 'Görüşmede ek süre istendi', trialEndsAt: plus(10) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(new Date(ok.json().tenant.trialEndsAt).getTime()).toBeGreaterThan(Date.now() + 9 * 86400000);
    const [sub] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.tenantId, b.tenantId));
    expect(sub!.trialEndsAt?.toISOString()).toBe(ok.json().tenant.trialEndsAt);
    expectError(await patch(u, p.sales_rep.cookie, { reason: 'İkinci uzatma talebi', trialEndsAt: plus(12) }), 403, 'trial_extension_used');
    const po = await patch(u, p.platform_owner.cookie, { reason: 'Pilot görüşmesi uzadı', trialEndsAt: plus(30) });
    expect(po.statusCode, po.body).toBe(200);
  });
});

describe('notlar /admin/tenants/:id/notes', () => {
  let noteId: string;

  it('ekleme (herkes), etiket sözlüğü, listeleme', async () => {
    expectError(await post(`/tenants/${a.tenantId}/notes`, p.sales_rep.cookie, { body: 'Aradım', tags: ['olmayan_etiket'] }), 400, 'validation_error');
    expectError(await post(`/tenants/${a.tenantId}/notes`, a.ownerCookie, { body: 'Deneme' }), 403, 'forbidden');
    const res = await post(`/tenants/${a.tenantId}/notes`, p.sales_rep.cookie, { body: 'Yazıcı sorunu için arandı.', tags: ['printer', 'p1_line', 'printer'] });
    expect(res.statusCode, res.body).toBe(201);
    noteId = res.json().id;
    expect(res.json().tags).toEqual(['printer', 'p1_line']);
    expect(res.json().authorName).toBe('Platform sales_rep');
    const list = (await get(`/tenants/${a.tenantId}/notes`, p.finance.cookie)).json();
    expect(list.items[0].id).toBe(noteId);
    const [log] = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'admin.note_create'));
    expect(log?.entityId).toBe(noteId);
  });

  it('düzenleme/silme: yazar ya da PO/PA; başka tenant yolundan 404', async () => {
    expectError(await patch(`/tenants/${a.tenantId}/notes/${noteId}`, p.support_agent.cookie, { body: 'Değiştir' }), 403, 'forbidden');
    const upd = await patch(`/tenants/${a.tenantId}/notes/${noteId}`, p.sales_rep.cookie, { tags: ['printer', 'training'] });
    expect(upd.statusCode, upd.body).toBe(200);
    expect(upd.json().tags).toEqual(['printer', 'training']);
    expectError(await patch(`/tenants/${b.tenantId}/notes/${noteId}`, p.platform_owner.cookie, { body: 'Yanlış tenant' }), 404, 'not_found');
    expectError(await ctx.request({ method: 'DELETE', url: `${API}/tenants/${b.tenantId}/notes/${noteId}`, cookie: p.platform_owner.cookie }), 404, 'not_found');
    const del = await ctx.request({ method: 'DELETE', url: `${API}/tenants/${a.tenantId}/notes/${noteId}`, cookie: p.platform_admin.cookie });
    expect(del.statusCode, del.body).toBe(200);
    expect((await get(`/tenants/${a.tenantId}/notes`, p.finance.cookie)).json().items).toHaveLength(0);
  });
});

describe('GET /admin/whatsapp', () => {
  it('sağlık: hata kırmızı ve üstte, açık saatte 2 sa webhook yoksa sessiz, 24 sa mesaj sayıları', async () => {
    const silent = await createWaAccount(ctx, { tenantId: a.tenantId, branchId: a.branchId, status: 'connected', lastWebhookAt: new Date(Date.now() - 3 * 3600_000) });
    await addMessages(ctx, silent, 3, 2);
    const res = await get('/whatsapp', p.support_agent.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.summary.total).toBe(2);
    expect(body.items[0].health).toBe('red');
    const s = body.items.find((i: { id: string }) => i.id === silent.id);
    expect(s.silent).toBe(true);
    expect(s.health).toBe('yellow');
    expect(s.inbound24h).toBe(3);
    expect(s.outbound24h).toBe(2);
    expect(s.displayPhoneMasked).toBe('0*** *** 11 22');
    expect(res.body).not.toContain('gizli:anahtar');

    // Webhook geldikten sonra sessiz değil
    await ctx.db.update(waAccounts).set({ lastWebhookAt: new Date() }).where(eq(waAccounts.id, silent.id));
    const again = (await get('/whatsapp?problems=1', p.platform_admin.cookie)).json();
    expect(again.items.some((i: { id: string }) => i.id === silent.id)).toBe(false);
    expectError(await get('/whatsapp', p.finance.cookie), 403, 'forbidden');
  });
});

describe('işler /admin/jobs', () => {
  it('başarısız işler listesi, maskeli yük; SA okur, SR/F okuyamaz', async () => {
    const job = await createJob(ctx, {
      status: 'failed',
      type: 'test.admin_retry',
      tenantId: b.tenantId,
      payload: { to: '+905321234567', body: 'Müşteri 0532 123 45 67 aradı', orderId: 'x' },
    });
    const res = await get('/jobs?status=failed', p.support_agent.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const item = res.json().items.find((i: { id: string }) => i.id === job.id);
    expect(item.tenantName).toBe('Bozok Döner');
    expect(item.payload.to).toBe('0*** *** 45 67');
    expect(res.body).not.toContain('1234567');
    expect(res.json().counts.failed).toBeGreaterThanOrEqual(2);
    expectError(await get('/jobs', p.sales_rep.cookie), 403, 'forbidden');
    expectError(await get('/jobs', p.finance.cookie), 403, 'forbidden');
    expect((await get('/jobs?status=pending', p.platform_admin.cookie)).statusCode).toBe(200);
  });

  it('yeniden dene: failed → pending, deneme sıfır, audit; ikinci çağrı 409; worker işler', async () => {
    let calls = 0;
    registerJobHandler('test.admin_retry', async () => {
      calls++;
    });
    const job = await createJob(ctx, { status: 'failed', type: 'test.admin_retry', attempts: 5 });
    expectError(await post(`/jobs/${job.id}/retry`, p.support_agent.cookie), 403, 'forbidden');
    const res = await post(`/jobs/${job.id}/retry`, p.platform_admin.cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().status).toBe('pending');
    expect(res.json().attempts).toBe(0);
    expectError(await post(`/jobs/${job.id}/retry`, p.platform_admin.cookie), 409, 'job_not_failed');
    expectError(await post('/jobs/00000000-0000-4000-8000-000000000000/retry', p.platform_admin.cookie), 404, 'not_found');
    const [log] = await ctx.db.select().from(auditLog).where(and(eq(auditLog.action, 'admin.job_retry'), eq(auditLog.entityId, job.id)));
    expect(log?.data).toMatchObject({ previousAttempts: 5, type: 'test.admin_retry' });

    await processDueJobs({ db: ctx.db, config: ctx.config, log: ctx.app.log, queues: ['notify'] });
    const [after] = await ctx.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(after!.status).toBe('done');
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

describe('bayraklar /admin/flags', () => {
  it('liste: kill-switch\'ler (kayıt yoksa varsayılan açık); yalnız PO/PA', async () => {
    const res = await get('/flags', p.platform_admin.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const keys = res.json().items.map((f: { key: string }) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['signup_open', 'wa_onboarding', 'campaigns_global', 'llm_parsing', 'sms_fallback']));
    expect(res.json().items.find((f: { key: string }) => f.key === 'signup_open').enabled).toBe(true);
    for (const r of ['support_agent', 'finance', 'sales_rep'] as const) {
      expectError(await get('/flags', p[r].cookie), 403, 'forbidden');
      expectError(await patch('/flags', p[r].cookie, { key: 'signup_open', enabled: false, reason: 'Sahte kayıt dalgası var' }), 403, 'forbidden');
    }
  });

  it('kill-switch kapatma gerekçeli + audit; açma gerekçesiz; bilinmeyen 404', async () => {
    expectError(await patch('/flags', p.platform_admin.cookie, { key: 'signup_open', enabled: false }), 400, 'reason_required');
    const off = await patch('/flags', p.platform_admin.cookie, { key: 'signup_open', enabled: false, reason: 'Sahte kayıt dalgası var' });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toMatchObject({ key: 'signup_open', enabled: false, persisted: true, updatedByName: 'Platform platform_admin' });
    expect(await isFlagEnabled(ctx.db, 'signup_open')).toBe(false);
    const [log] = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'admin.flag_update'));
    expect(log?.data).toMatchObject({ before: true, after: false, reason: 'Sahte kayıt dalgası var' });

    // Kayıt kapalıyken signup reddedilir (temel dilimin uç noktası bayrağı okur)
    const signup = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/signup',
      headers: { 'x-forwarded-for': '10.9.9.9' },
      body: { businessName: 'Yeni Kafe', ownerName: 'Ali Veli', phone: '05321230000', email: 'yeni@kafe.test', password: 'parola1234', acceptTerms: true },
    });
    expectError(signup, 403, 'signup_closed');

    const on = await patch('/flags', p.platform_owner.cookie, { key: 'signup_open', enabled: true });
    expect(on.statusCode, on.body).toBe(200);
    expect(await isFlagEnabled(ctx.db, 'signup_open')).toBe(true);
    expectError(await patch('/flags', p.platform_owner.cookie, { key: 'yok_boyle', enabled: false, reason: 'Bilinmeyen bayrak denemesi' }), 404, 'not_found');

    // DB'de kaydı olmayan kill-switch de yönetilir
    await ctx.db.delete(featureFlags).where(eq(featureFlags.key, 'llm_parsing'));
    const llm = await patch('/flags', p.platform_owner.cookie, { key: 'llm_parsing', enabled: false, reason: 'Sağlayıcı kesintisi yaşanıyor' });
    expect(llm.statusCode, llm.body).toBe(200);
    expect(await isFlagEnabled(ctx.db, 'llm_parsing')).toBe(false);
  });
});

describe('lead\'ler /admin/leads', () => {
  let leadId: string;

  it('liste: PO/PA/F/SR okur, SA okuyamaz; durum sayıları', async () => {
    const [l] = await ctx.db
      .insert(leads)
      .values({ name: 'Mehmet Yılmaz', businessName: 'Yılmaz Kebap', phone: '+905301112233', city: 'Yozgat', source: 'calculator', calculatorInput: { dailyOrders: 30 } })
      .returning();
    leadId = l!.id;
    const res = await get('/leads', p.sales_rep.cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items[0].id).toBe(leadId);
    expect(res.json().items[0].calculatorInput).toEqual({ dailyOrders: 30 });
    expect(res.json().counts.new).toBe(2);
    expect((await get(`/leads?q=${encodeURIComponent('yılmaz')}`, p.finance.cookie)).json().items).toHaveLength(1);
    expect((await get(`/leads?q=${encodeURIComponent('0530 111 22 33')}`, p.finance.cookie)).json().items).toHaveLength(1);
    expect((await get('/leads?status=won', p.platform_admin.cookie)).json().items).toHaveLength(0);
    expectError(await get('/leads', p.support_agent.cookie), 403, 'forbidden');
  });

  it('güncelleme: yalnız PO/SR; won işletmeye bağlanmalı; audit', async () => {
    expectError(await patch(`/leads/${leadId}`, p.platform_admin.cookie, { status: 'contacted' }), 403, 'forbidden');
    expectError(await patch(`/leads/${leadId}`, p.finance.cookie, { status: 'contacted' }), 403, 'forbidden');
    const res = await patch(`/leads/${leadId}`, p.sales_rep.cookie, { status: 'contacted', notes: 'Perşembe demo' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'contacted', notes: 'Perşembe demo' });
    expectError(await patch(`/leads/${leadId}`, p.sales_rep.cookie, { status: 'won' }), 400, 'tenant_required');
    expectError(await patch(`/leads/${leadId}`, p.sales_rep.cookie, { status: 'won', tenantSlug: 'olmayan-isletme' }), 404, 'tenant_not_found');
    const won = await patch(`/leads/${leadId}`, p.sales_rep.cookie, { status: 'won', tenantSlug: 'bozok-doner' });
    expect(won.statusCode, won.body).toBe(200);
    expect(won.json()).toMatchObject({ status: 'won', tenantId: b.tenantId, tenantName: 'Bozok Döner' });
    expectError(await patch('/leads/00000000-0000-4000-8000-000000000000', p.sales_rep.cookie, { status: 'lost' }), 404, 'not_found');
    const logs = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'admin.lead_update'));
    expect(logs.length).toBe(2);
  });
});

describe('denetim /admin/audit', () => {
  it('PO/PA tümü + filtreler; SA yalnız kendi; F yalnız finans; SR erişemez', async () => {
    const all = await get('/audit?limit=100', p.platform_admin.cookie);
    expect(all.statusCode, all.body).toBe(200);
    const actions = new Set(all.json().items.map((i: { action: string }) => i.action));
    expect(actions.has('admin.tenant_update')).toBe(true);
    expect(actions.has('admin.flag_update')).toBe(true);

    const byTenant = (await get(`/audit?tenantId=${b.tenantId}&limit=100`, p.platform_owner.cookie)).json();
    expect(byTenant.items.every((i: { tenantId: string }) => i.tenantId === b.tenantId)).toBe(true);
    const byActor = (await get(`/audit?actor=${p.finance.user.email}&limit=100`, p.platform_owner.cookie)).json();
    expect(byActor.items.length).toBeGreaterThan(0);
    expect(byActor.items.every((i: { actorUserId: string }) => i.actorUserId === p.finance.user.id)).toBe(true);
    const byAction = (await get('/audit?action=admin.flag&limit=100', p.platform_owner.cookie)).json();
    expect(byAction.items.every((i: { action: string }) => i.action.startsWith('admin.flag'))).toBe(true);

    const sa = (await get('/audit?limit=100', p.support_agent.cookie)).json();
    expect(sa.items.length).toBeGreaterThan(0);
    expect(sa.items.every((i: { actorUserId: string }) => i.actorUserId === p.support_agent.user.id)).toBe(true);
    const fin = (await get('/audit?limit=100', p.finance.cookie)).json();
    expect(fin.items.length).toBeGreaterThan(0);
    expect(fin.items.every((i: { entityType: string }) => i.entityType === 'subscription')).toBe(true);
    expectError(await get('/audit', p.sales_rep.cookie), 403, 'forbidden');

    // Sayfalama: aynı transaction'daki (aynı zaman damgalı) kayıtlar atlanmaz
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let i = 0; i < 100; i++) {
      const page = (await get(`/audit?limit=3${cursor ? `&cursor=${cursor}` : ''}`, p.platform_owner.cookie)).json();
      for (const it of page.items) seen.add(it.id);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    const total = await ctx.db.select({ id: auditLog.id }).from(auditLog);
    expect(seen.size).toBe(total.length);
  });
});
