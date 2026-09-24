// Dilim 4 — ayarlar: tenant, şube, saatler, özel günler, duraklat/yoğun (SSE), bölgeler; yetki ve yalıtım.

import { branchStatePayloadSchema, localDateString } from '@siparis/core';
import { auditLog, branchEvents, branches, deliveryZones } from '@siparis/db';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, expectError, expectIsolated, type TestContext, type TestTenant } from './helpers';
import { readSseUntil } from './settings-helpers';

let ctx: TestContext;
let a: TestTenant;
let b: TestTenant;
let baseUrl: string;
let managerA: { cookie: string };
let cashierA: { cookie: string };
let kitchenA: { cookie: string };

const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie: string, body?: unknown) =>
  ctx.request({ method, url: `/api/v1/panel${url}`, cookie, body });

async function lastBranchEvent(branchId: string) {
  const [e] = await ctx.db.select().from(branchEvents).where(eq(branchEvents.branchId, branchId)).orderBy(desc(branchEvents.seq)).limit(1);
  return e;
}

beforeAll(async () => {
  ctx = await createTestContext();
  baseUrl = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  a = await ctx.createTenantWithOwner({ name: 'A Pide' });
  b = await ctx.createTenantWithOwner({ name: 'B Kebap' });
  managerA = await ctx.createStaff(a.tenantId, 'manager');
  cashierA = await ctx.createStaff(a.tenantId, 'cashier');
  kitchenA = await ctx.createStaff(a.tenantId, 'kitchen');
});

afterAll(async () => {
  await ctx.close();
});

describe('GET/PATCH /panel/tenant', () => {
  it('sahip okur ve günceller; telefon normalize, renk büyük harf, audit yazılır', async () => {
    const get = await req('GET', '/tenant', a.ownerCookie);
    expect(get.statusCode, get.body).toBe(200);
    expect(get.json()).toMatchObject({ id: a.tenantId, name: 'A Pide', marketplaceCommissionBp: 2500 });
    expect(get.json().imprintMissing).toContain('VKN/TCKN');

    const res = await req('PATCH', '/tenant', a.ownerCookie, {
      name: 'A Pide Salonu',
      phone: '0354 212 34 56',
      legalName: 'Ahmet Yılmaz',
      taxNo: '12345678901',
      address: 'Cumhuriyet Mah. Lise Cad. No 5, Yozgat',
      brandColor: '#c62828',
      logoUrl: '/api/v1/uploads/logo.png',
      marketplaceCommissionBp: 3000,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      name: 'A Pide Salonu',
      phone: '+903542123456',
      brandColor: '#C62828',
      marketplaceCommissionBp: 3000,
      imprintMissing: [],
    });
    const logs = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, a.tenantId), eq(auditLog.action, 'settings.tenant_update')));
    expect(logs.length).toBe(1);
  });

  it('doğrulama: renk, komisyon oranı, görsel adresi, telefon', async () => {
    expectError(await req('PATCH', '/tenant', a.ownerCookie, { brandColor: 'red' }), 400, 'validation_error');
    expectError(await req('PATCH', '/tenant', a.ownerCookie, { brandColor: '#12345' }), 400, 'validation_error');
    expectError(await req('PATCH', '/tenant', a.ownerCookie, { marketplaceCommissionBp: 6001 }), 400, 'validation_error');
    expectError(await req('PATCH', '/tenant', a.ownerCookie, { marketplaceCommissionBp: -1 }), 400, 'validation_error');
    expectError(await req('PATCH', '/tenant', a.ownerCookie, { logoUrl: 'javascript:alert(1)' }), 400, 'validation_error');
    expectError(await req('PATCH', '/tenant', a.ownerCookie, { phone: '12' }), 400, 'validation_error');
    expectError(await req('PATCH', '/tenant', a.ownerCookie, { unknownField: 1 }), 400, 'validation_error');
  });

  it('slug: yalnız sahip, biçim + ayrılmış ad + benzersizlik', async () => {
    expectError(await req('PATCH', '/tenant', managerA.cookie, { slug: 'a-pide-yeni' }), 403, 'forbidden');
    expectError(await req('PATCH', '/tenant', a.ownerCookie, { slug: 'admin' }), 400, 'validation_error');
    expectError(await req('PATCH', '/tenant', a.ownerCookie, { slug: '-kotu-' }), 400, 'validation_error');
    expectError(await req('PATCH', '/tenant', a.ownerCookie, { slug: b.slug }), 409, 'slug_taken');
    const ok = await req('PATCH', '/tenant', a.ownerCookie, { slug: 'a-pide-yozgat' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().slug).toBe('a-pide-yozgat');
    // Yönetici diğer alanları değiştirebilir
    const m = await req('PATCH', '/tenant', managerA.cookie, { marketplaceCommissionBp: 2000 });
    expect(m.statusCode, m.body).toBe(200);
  });

  it('yetki: kasiyer ve mutfak ayar göremez/değiştiremez; salt-okunur oturum yazamaz', async () => {
    expectError(await req('GET', '/tenant', cashierA.cookie), 403, 'forbidden');
    expectError(await req('PATCH', '/tenant', cashierA.cookie, { name: 'X' }), 403, 'forbidden');
    expectError(await req('PATCH', '/tenant', kitchenA.cookie, { name: 'X' }), 403, 'forbidden');
    const ro = await ctx.sessionCookie(a.owner.id, { tenantId: a.tenantId, readOnly: true });
    expectError(await req('PATCH', '/tenant', ro, { name: 'Salt okunur' }), 403, 'read_only_session');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/panel/tenant' }), 401, 'unauthorized');
  });
});

describe('GET/PATCH /panel/branches/:id', () => {
  it('okuma: kasiyer dahil; durum ve saatler döner; başka tenant 404', async () => {
    const res = await req('GET', `/branches/${a.branchId}`, cashierA.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.state.orderingState).toBe('open');
    expect(body.hours).toHaveLength(7);
    expect(body.alarmPolicy).toMatchObject({ auto_cancel_minutes: 15, customer_notice_minutes: 10 });
    expect(body.statusMessages.preparing).toBe(false);
    expectIsolated(await req('GET', `/branches/${b.branchId}`, a.ownerCookie));
    expectError(await req('PATCH', `/branches/${b.branchId}`, a.ownerCookie, { name: 'Başka şube' }), 404, 'not_found');
    const list = await req('GET', '/branches', a.ownerCookie);
    expect(list.json().items.map((x: { id: string }) => x.id)).toEqual([a.branchId]);
  });

  it('bilgiler, teslim türleri, ödeme yöntemleri ve fiş ayarı güncellenir', async () => {
    const res = await req('PATCH', `/branches/${a.branchId}`, a.ownerCookie, {
      addressLine: 'Lise Cad. No 5',
      neighborhood: 'Aşağınohutlu',
      lat: 39.82,
      lng: 34.81,
      acceptsPickup: true,
      defaultPrepMinutes: 25,
      paymentMethods: ['cash_on_delivery', 'meal_card_on_delivery'],
      mealCardBrands: ['multinet', 'pluxee'],
      receiptSettings: { width_mm: 58, footer_text: 'Afiyet olsun', copies: 2 },
      statusMessages: { preparing: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      addressLine: 'Lise Cad. No 5',
      defaultPrepMinutes: 25,
      paymentMethods: ['cash_on_delivery', 'meal_card_on_delivery'],
      mealCardBrands: ['multinet', 'pluxee'],
      receiptSettings: { width_mm: 58, footer_text: 'Afiyet olsun', copies: 2, show_logo: true },
      statusMessages: { preparing: true, received: true },
    });
  });

  it('doğrulama: ödeme yöntemi, yemek kartı markası, teslim türü, konum, hazırlık süresi', async () => {
    const url = `/branches/${a.branchId}`;
    expectError(await req('PATCH', url, a.ownerCookie, { paymentMethods: [] }), 400, 'validation_error');
    expectError(await req('PATCH', url, a.ownerCookie, { paymentMethods: ['online_card'] }), 400, 'validation_error');
    expectError(await req('PATCH', url, a.ownerCookie, { paymentMethods: ['meal_card_on_delivery'], mealCardBrands: [] }), 400, 'validation_error');
    expectError(await req('PATCH', url, a.ownerCookie, { acceptsDelivery: false, acceptsPickup: false }), 400, 'validation_error');
    expectError(await req('PATCH', url, a.ownerCookie, { lat: null }), 400, 'validation_error');
    expectError(await req('PATCH', url, a.ownerCookie, { defaultPrepMinutes: 3 }), 400, 'validation_error');
    expectError(await req('PATCH', url, a.ownerCookie, { statusMessages: { received: false } }), 400, 'validation_error');
    expectError(await req('PATCH', url, a.ownerCookie, { statusMessages: { accepted: false } }), 400, 'validation_error');
  });

  it('alarm politikası sınırları (00 §10)', async () => {
    const url = `/branches/${a.branchId}`;
    const bad = [
      { auto_cancel_minutes: 9 },
      { auto_cancel_minutes: 31 },
      { auto_cancel_minutes: 12 }, // mevcut bilgi 10 dk > 12 − 5
      { customer_notice_minutes: 11 }, // 15 − 5 = 10
      { customer_notice_minutes: 4 },
      { panel_alarm_enabled: false },
      { repeat_alarm_enabled: false },
    ];
    for (const alarmPolicy of bad) {
      const res = await req('PATCH', url, a.ownerCookie, { alarmPolicy });
      expectError(res, 400, 'validation_error');
    }
    const ok = await req('PATCH', url, a.ownerCookie, {
      alarmPolicy: { auto_cancel_minutes: 20, customer_notice_minutes: 15, platform_wa_enabled: false, sms_enabled: false, panel_alarm_enabled: true },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().alarmPolicy).toEqual({ auto_cancel_minutes: 20, customer_notice_minutes: 15, platform_wa_enabled: false, sms_enabled: false });
    const [row] = await ctx.db.select({ p: branches.alarmPolicy }).from(branches).where(eq(branches.id, a.branchId));
    expect(row!.p).toEqual({ auto_cancel_minutes: 20, customer_notice_minutes: 15, platform_wa_enabled: false, sms_enabled: false });
    const edge = await req('PATCH', url, a.ownerCookie, { alarmPolicy: { auto_cancel_minutes: 10, customer_notice_minutes: 5 } });
    expect(edge.statusCode, edge.body).toBe(200);
  });

  it('yetki: kasiyer şube ayarı değiştiremez', async () => {
    expectError(await req('PATCH', `/branches/${a.branchId}`, cashierA.cookie, { defaultPrepMinutes: 30 }), 403, 'forbidden');
    expectError(await req('PUT', `/branches/${a.branchId}/hours`, cashierA.cookie, { days: [] }), 403, 'forbidden');
  });
});

describe('PUT /panel/branches/:id/hours ve özel günler', () => {
  it('gece yarısını aşan aralıklar kaydedilir; olay yazılır', async () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      intervals: weekday === 5 || weekday === 6 ? [{ opensAt: '11:00', closesAt: '02:00' }] : [{ opensAt: '11:00', closesAt: '15:00' }, { opensAt: '17:00', closesAt: '23:30' }],
    }));
    const res = await req('PUT', `/branches/${a.branchId}/hours`, a.ownerCookie, { days });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().hours).toHaveLength(12);
    expect(res.json().hours).toContainEqual({ weekday: 5, opensAt: '11:00', closesAt: '02:00' });
    expect((await lastBranchEvent(a.branchId))?.type).toBe('branch.state');
  });

  it('doğrulama: çakışma, biçim, tekrar eden gün', async () => {
    const url = `/branches/${a.branchId}/hours`;
    expectError(await req('PUT', url, a.ownerCookie, { days: [{ weekday: 1, intervals: [{ opensAt: '11:00', closesAt: '16:00' }, { opensAt: '15:00', closesAt: '22:00' }] }] }), 400, 'validation_error');
    expectError(
      await req('PUT', url, a.ownerCookie, {
        days: [
          { weekday: 5, intervals: [{ opensAt: '18:00', closesAt: '03:00' }] },
          { weekday: 6, intervals: [{ opensAt: '02:00', closesAt: '10:00' }] },
        ],
      }),
      400,
      'validation_error',
    );
    expectError(await req('PUT', url, a.ownerCookie, { days: [{ weekday: 1, intervals: [{ opensAt: '9:00', closesAt: '22:00' }] }] }), 400, 'validation_error');
    expectError(await req('PUT', url, a.ownerCookie, { days: [{ weekday: 7, intervals: [] }] }), 400, 'validation_error');
    expectError(await req('PUT', url, a.ownerCookie, { days: [{ weekday: 2, intervals: [] }, { weekday: 2, intervals: [] }] }), 400, 'validation_error');
    expectIsolated(await req('PUT', `/branches/${b.branchId}/hours`, a.ownerCookie, { days: [] }));
  });

  it('boş hafta = kapalı; 7/24 geri yüklenir', async () => {
    const closed = await req('PUT', `/branches/${a.branchId}/hours`, a.ownerCookie, { days: [] });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().state.orderingState).toBe('closed');
    const open = await req('PUT', `/branches/${a.branchId}/hours`, a.ownerCookie, {
      days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: [{ opensAt: '00:00', closesAt: '00:00' }] })),
    });
    expect(open.json().state.orderingState).toBe('open');
  });

  it('özel gün: aralık, çakışma 409, açık gün saat ister, bugün kapalı → closed, silince açık', async () => {
    const url = `/branches/${a.branchId}/special-days`;
    const created = await req('POST', url, a.ownerCookie, { date: '2031-10-01', endDate: '2031-10-03', isClosed: true, note: 'Tadilat' });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().items.map((d: { date: string }) => d.date)).toEqual(['2031-10-01', '2031-10-02', '2031-10-03']);
    expectError(await req('POST', url, a.ownerCookie, { date: '2031-10-02', isClosed: true }), 409, 'special_day_exists');
    expectError(await req('POST', url, a.ownerCookie, { date: '2031-11-01', isClosed: false }), 400, 'validation_error');
    expectError(await req('POST', url, a.ownerCookie, { date: '2031-02-30', isClosed: true }), 400, 'validation_error');
    expectError(await req('POST', url, a.ownerCookie, { date: '2031-11-05', endDate: '2031-11-01', isClosed: true }), 400, 'validation_error');

    const today = localDateString(new Date());
    const t = await req('POST', url, a.ownerCookie, { date: today, isClosed: true, note: 'Bayram' });
    expect(t.statusCode, t.body).toBe(201);
    expect(t.json().state.orderingState).toBe('closed');
    const dayId = t.json().items[0].id as string;

    const patched = await req('PATCH', `${url}/${dayId}`, a.ownerCookie, { isClosed: false, opensAt: '00:00', closesAt: '00:00' });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ isClosed: false, opensAt: '00:00' });

    const list = await req('GET', url, a.ownerCookie);
    expect(list.json().items.length).toBe(4);

    expectError(await req('DELETE', `/branches/${b.branchId}/special-days/${dayId}`, b.ownerCookie), 404, 'not_found');
    const del = await req('DELETE', `${url}/${dayId}`, a.ownerCookie);
    expect(del.statusCode, del.body).toBe(200);
    const branch = await req('GET', `/branches/${a.branchId}`, a.ownerCookie);
    expect(branch.json().state.orderingState).toBe('open');
  });
});

describe('POST /panel/branches/:id/pause ve /busy', () => {
  it('duraklatma → branch.state olayı (SSE ile canlı gelir), sonra yeniden açma', async () => {
    const streamUrl = `${baseUrl}/api/v1/panel/stream?branchId=${a.branchId}`;
    const waiting = readSseUntil(streamUrl, a.ownerCookie, (e) => e.event === 'branch.state' && (e.data as { orderingState?: string }).orderingState === 'paused');
    await new Promise((r) => setTimeout(r, 300));
    const before = Date.now();
    const res = await req('POST', `/branches/${a.branchId}/pause`, cashierA.cookie, { minutes: 30, reason: 'Fırın arızası' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().orderingState).toBe('paused');
    const until = Date.parse(res.json().pausedUntil);
    expect(until - before).toBeGreaterThan(29 * 60_000);
    expect(until - before).toBeLessThan(31 * 60_000);

    const ev = await lastBranchEvent(a.branchId);
    expect(ev?.type).toBe('branch.state');
    expect(branchStatePayloadSchema.parse(ev!.payload)).toMatchObject({ orderingState: 'paused' });
    const sse = await waiting;
    expect(sse, 'SSE üzerinden branch.state gelmeli').not.toBeNull();
    expect(sse!.data).toMatchObject({ orderingState: 'paused', busyExtraMinutes: 0 });

    const resume = await req('POST', `/branches/${a.branchId}/pause`, a.ownerCookie, { minutes: null });
    expect(resume.json()).toMatchObject({ orderingState: 'open', pausedUntil: null });
    const logs = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, a.tenantId), eq(auditLog.action, 'branch.pause')));
    expect(logs.length).toBe(1);
  });

  it('kapanışa kadar / bugün; yoğun +20 ve kapatma; sınırlar', async () => {
    const u = await req('POST', `/branches/${a.branchId}/pause`, a.ownerCookie, { minutes: 'until_close' });
    expect(u.statusCode, u.body).toBe(200);
    expect(u.json().orderingState).toBe('paused');
    const e = await req('POST', `/branches/${a.branchId}/pause`, a.ownerCookie, { minutes: 'end_of_day' });
    expect(e.json().orderingState).toBe('paused');
    await req('POST', `/branches/${a.branchId}/pause`, a.ownerCookie, { minutes: null });

    const busy = await req('POST', `/branches/${a.branchId}/busy`, cashierA.cookie, { extraMinutes: 20 });
    expect(busy.statusCode, busy.body).toBe(200);
    expect(busy.json()).toMatchObject({ orderingState: 'busy', busyExtraMinutes: 20 });
    const ev = await lastBranchEvent(a.branchId);
    expect(ev?.payload).toMatchObject({ orderingState: 'busy', busyExtraMinutes: 20 });
    const off = await req('POST', `/branches/${a.branchId}/busy`, a.ownerCookie, { extraMinutes: 0 });
    expect(off.json()).toMatchObject({ orderingState: 'open', busyExtraMinutes: 0 });

    expectError(await req('POST', `/branches/${a.branchId}/busy`, a.ownerCookie, { extraMinutes: 500 }), 400, 'validation_error');
    expectError(await req('POST', `/branches/${a.branchId}/pause`, a.ownerCookie, { minutes: 0 }), 400, 'validation_error');
    expectError(await req('POST', `/branches/${a.branchId}/pause`, a.ownerCookie, { minutes: 'forever' }), 400, 'validation_error');
  });

  it('yetki ve yalıtım: mutfak 403, başka tenant 404', async () => {
    expectError(await req('POST', `/branches/${a.branchId}/pause`, kitchenA.cookie, { minutes: 15 }), 403, 'forbidden');
    expectError(await req('POST', `/branches/${b.branchId}/pause`, a.ownerCookie, { minutes: 15 }), 404, 'not_found');
    expectError(await req('POST', `/branches/${b.branchId}/busy`, cashierA.cookie, { extraMinutes: 10 }), 404, 'not_found');
    const [bb] = await ctx.db.select().from(branches).where(eq(branches.id, b.branchId));
    expect(bb!.pausedUntil).toBeNull();
  });
});

describe('Teslimat bölgeleri', () => {
  let zoneId: string;

  it('mahalle listesi: oluştur, tekrarsızlık (bölge içi ve tenant içi)', async () => {
    const res = await req('POST', '/zones', a.ownerCookie, {
      name: 'Yakın',
      kind: 'neighborhoods',
      neighborhoods: ['Aşağınohutlu', ' Yenimahalle  Mah. ', 'Bahçeşehir'],
      feeKurus: 0,
      minOrderKurus: 15000,
      etaMinutes: 30,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ kind: 'neighborhoods', neighborhoods: ['Aşağınohutlu', 'Yenimahalle Mah.', 'Bahçeşehir'], polygon: null, radiusM: null });
    zoneId = res.json().id;

    const base = { kind: 'neighborhoods', feeKurus: 1000, minOrderKurus: 0, etaMinutes: 40 };
    expectError(await req('POST', '/zones', a.ownerCookie, { ...base, name: 'Boş', neighborhoods: [] }), 400, 'validation_error');
    expectError(await req('POST', '/zones', a.ownerCookie, { ...base, name: 'Tekrar', neighborhoods: ['Çapanoğlu', 'çapanoğlu mahallesi'] }), 400, 'validation_error');
    const dup = await req('POST', '/zones', a.ownerCookie, { ...base, name: 'Uzak', neighborhoods: ['BAHÇEŞEHİR MAH.', 'Karatepe'] });
    expectError(dup, 400, 'validation_error');
    expect(dup.json().error.message).toContain('Yakın');
    // Başka tenant aynı mahalleyi kullanabilir
    const other = await req('POST', '/zones', b.ownerCookie, { ...base, name: 'B', neighborhoods: ['Yenimahalle'] });
    expect(other.statusCode, other.body).toBe(201);
  });

  it('poligon: geçerli GeoJSON kabul; açık halka / 2 nokta / tür hatası red', async () => {
    const poly = { type: 'Polygon', coordinates: [[[34.8, 39.81], [34.83, 39.81], [34.83, 39.83], [34.8, 39.83], [34.8, 39.81]]] };
    const base = { name: 'Merkez alan', kind: 'polygon', feeKurus: 2000, minOrderKurus: 20000, etaMinutes: 35 };
    const ok = await req('POST', '/zones', a.ownerCookie, { ...base, polygon: poly });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().polygon).toEqual(poly);
    expectError(await req('POST', '/zones', a.ownerCookie, { ...base, polygon: { type: 'Polygon', coordinates: [[[34.8, 39.81], [34.83, 39.81], [34.83, 39.83], [34.8, 39.83]]] } }), 400, 'validation_error');
    expectError(await req('POST', '/zones', a.ownerCookie, { ...base, polygon: { type: 'Polygon', coordinates: [[[34.8, 39.81], [34.83, 39.81], [34.8, 39.81]]] } }), 400, 'validation_error');
    expectError(await req('POST', '/zones', a.ownerCookie, { ...base, polygon: { type: 'Polygon', coordinates: [[[200, 39.81], [34.83, 39.81], [34.83, 39.83], [200, 39.81]]] } }), 400, 'validation_error');
    expectError(await req('POST', '/zones', a.ownerCookie, { ...base, polygon: null }), 400, 'validation_error');
  });

  it('yarıçap: 100–30000 m, şube konumu gerekli; ücret/süre negatif olamaz', async () => {
    const base = { name: 'Çevre', kind: 'radius', feeKurus: 3000, minOrderKurus: 25000, etaMinutes: 45 };
    expectError(await req('POST', '/zones', a.ownerCookie, { ...base, radiusM: 50 }), 400, 'validation_error');
    expectError(await req('POST', '/zones', a.ownerCookie, { ...base, radiusM: 40_000 }), 400, 'validation_error');
    expectError(await req('POST', '/zones', a.ownerCookie, { ...base, radiusM: 3000, feeKurus: -1 }), 400, 'validation_error');
    expectError(await req('POST', '/zones', a.ownerCookie, { ...base, radiusM: 3000, etaMinutes: -5 }), 400, 'validation_error');
    const ok = await req('POST', '/zones', a.ownerCookie, { ...base, radiusM: 3000 });
    expect(ok.statusCode, ok.body).toBe(201);
    // Konumsuz şube
    await ctx.db.update(branches).set({ lat: null, lng: null }).where(eq(branches.id, b.branchId));
    expectError(await req('POST', '/zones', b.ownerCookie, { ...base, radiusM: 3000 }), 400, 'validation_error');
  });

  it('liste, güncelle (tür değişimi), kontrol, sil; yetki ve yalıtım', async () => {
    const list = await req('GET', '/zones', cashierA.cookie);
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().items.length).toBe(3);

    const check = await req('POST', '/zones/check', a.ownerCookie, { neighborhood: 'bahçeşehir mahallesi' });
    expect(check.json().match).toMatchObject({ zoneId, zoneName: 'Yakın', via: 'neighborhoods', minOrderKurus: 15000 });
    const miss = await req('POST', '/zones/check', a.ownerCookie, { neighborhood: 'Olmayan' });
    expect(miss.json().match).toBeNull();

    const up = await req('PATCH', `/zones/${zoneId}`, a.ownerCookie, { kind: 'radius', radiusM: 1500, feeKurus: 500 });
    expect(up.statusCode, up.body).toBe(200);
    expect(up.json()).toMatchObject({ kind: 'radius', radiusM: 1500, neighborhoods: [], feeKurus: 500 });
    expectError(await req('PATCH', `/zones/${zoneId}`, a.ownerCookie, { radiusM: 20 }), 400, 'validation_error');

    expectError(await req('POST', '/zones', cashierA.cookie, { name: 'X', kind: 'radius', radiusM: 1000, feeKurus: 0, minOrderKurus: 0, etaMinutes: 20 }), 403, 'forbidden');
    expectError(await req('PATCH', `/zones/${zoneId}`, b.ownerCookie, { name: 'Hack' }), 404, 'not_found');
    expectError(await req('DELETE', `/zones/${zoneId}`, b.ownerCookie), 404, 'not_found');

    const del = await req('DELETE', `/zones/${zoneId}`, a.ownerCookie);
    expect(del.statusCode, del.body).toBe(200);
    const [row] = await ctx.db.select().from(deliveryZones).where(eq(deliveryZones.id, zoneId));
    expect(row!.deletedAt).not.toBeNull();
    const after = await req('GET', '/zones', a.ownerCookie);
    expect(after.json().items.map((z: { id: string }) => z.id)).not.toContain(zoneId);
    expectError(await req('PATCH', `/zones/${zoneId}`, a.ownerCookie, { name: 'Silinmiş' }), 404, 'not_found');
  });
});
