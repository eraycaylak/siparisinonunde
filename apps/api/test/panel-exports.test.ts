// Toplu dışa aktarma (açık soru 10): tenant yalıtımı, rol kapısı, şube kapsamı, kişisel veri kademesi,
// hız sınırı, KVKK silinmiş müşterinin dosyada görünmemesi, CSV/JSON biçimi ve formül enjeksiyonu.

import { branches, customerErasures } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { activeExportCount, EXPORT_MAX_CONCURRENT, EXPORT_RATE_LIMIT, resetExportLimits } from '../src/routes/panel/exports';
import { csvCell, csvChunks, CSV_TRUNCATED_MARKER } from '../src/services/reports/export-format';
import { EXPORT_DEFAULT_DAYS, EXPORT_MAX_DAYS, parseExportRange, parseOptionalRange, type ExportRows } from '../src/services/reports/export';
import { exportOrders, ORDER_CSV_HEADER, orderCsvCells } from '../src/services/reports/export-orders';
import { createTestContext, expectError, type TestContext, type TestTenant } from './helpers';
import { createCustomer, insertOrder } from './settings-helpers';

let ctx: TestContext;
let a: TestTenant;
let b: TestTenant;
let secondBranchId: string;
let cashier: { cookie: string };
let kitchen: { cookie: string };
let manager: { cookie: string };
/** Yalnız ikinci şubeye bağlı yönetici (üyelik şube kısıtı). */
let branchManager: { cookie: string };
let support: string;
let erasedId: string;

const P = '/api/v1/panel';
const req = (url: string, cookie?: string) => ctx.request({ method: 'GET', url: `${P}${url}`, cookie });
/** İstanbul yerel saati (UTC+3) → Date */
const ist = (s: string) => new Date(`${s}+03:00`);
const RANGE = 'from=2026-09-01&to=2026-09-30';

beforeAll(async () => {
  ctx = await createTestContext();
  a = await ctx.createTenantWithOwner({ slug: 'pide-evi' });
  b = await ctx.createTenantWithOwner();
  cashier = await ctx.createStaff(a.tenantId, 'cashier');
  kitchen = await ctx.createStaff(a.tenantId, 'kitchen');
  manager = await ctx.createStaff(a.tenantId, 'manager');
  support = await ctx.sessionCookie(a.owner.id, { tenantId: a.tenantId, kind: 'impersonation' });

  const [second] = await ctx.db.insert(branches).values({ tenantId: a.tenantId, name: 'İkinci Şube', isDefault: false }).returning();
  secondBranchId = second!.id;
  branchManager = await ctx.createStaff(a.tenantId, 'manager', { branchId: secondBranchId });

  const ayse = await createCustomer(ctx.db, a.tenantId, { name: 'Ayşe Yılmaz', phone: '+905321112233' });
  // Excel formülüne dönüşebilecek not (CSV enjeksiyonu)
  const risk = await createCustomer(ctx.db, a.tenantId, { name: '=HYPERLINK("http://kotu.example","Tıkla")', phone: '+905329998877', notes: '+905320000000' });
  const erased = await createCustomer(ctx.db, a.tenantId, { name: 'Silinecek', phone: '+905327776655' });
  erasedId = erased.id;
  await ctx.db.insert(customerErasures).values({ tenantId: a.tenantId, customerId: erased.id });
  await createCustomer(ctx.db, b.tenantId, { name: 'Başka Tenant Müşterisi', phone: '+905321230000' });

  const base = { tenantId: a.tenantId, branchId: a.branchId };
  await insertOrder(ctx.db, {
    ...base,
    placedAt: ist('2026-09-10T12:00:00'),
    totalKurus: 23500,
    deliveryFeeKurus: 1500,
    customerId: ayse.id,
    itemName: 'Kıymalı Pide',
    quantity: 2,
    extra: { note: '=1+1', directions: 'Eczanenin üstü' },
  });
  await insertOrder(ctx.db, { ...base, placedAt: ist('2026-09-11T12:00:00'), totalKurus: 9000, status: 'rejected', customerId: risk.id });
  // Test siparişi: hiçbir dosyada görünmez
  await insertOrder(ctx.db, { ...base, placedAt: ist('2026-09-12T12:00:00'), totalKurus: 99900, testKind: 'onboarding_test', itemName: 'Test Ürünü' });
  // Aralık dışı (1 Ekim)
  await insertOrder(ctx.db, { ...base, placedAt: ist('2026-10-01T12:00:00'), totalKurus: 12300, itemName: 'Ekim Siparişi' });
  // İkinci şube
  await insertOrder(ctx.db, { tenantId: a.tenantId, branchId: secondBranchId, placedAt: ist('2026-09-13T12:00:00'), totalKurus: 44400, itemName: 'İkinci Şube Pidesi' });
  // Başka tenant (yalıtım)
  await insertOrder(ctx.db, { tenantId: b.tenantId, branchId: b.branchId, placedAt: ist('2026-09-14T12:00:00'), totalKurus: 77700, itemName: 'Yabancı Ürün' });
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(() => {
  // Hız sınırı ve eşzamanlılık kapısı süreç belleğindedir: testler birbirinin kovasını tüketmesin
  resetExportLimits();
});

describe('GET /panel/exports/orders.csv', () => {
  it('BOM + başlık + Türkçe ondalık; test siparişi, aralık dışı ve başka tenant yok', async () => {
    const res = await req(`/exports/orders.csv?${RANGE}`, a.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('siparisler-pide-evi-2026-09-01_2026-09-30.csv');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.startsWith('﻿siparis_no;durum;kanal;')).toBe(true);
    expect(res.body).toContain('2× Kıymalı Pide');
    expect(res.body).toContain('235,00');
    expect(res.body).not.toContain('Test Ürünü');
    expect(res.body).not.toContain('Ekim Siparişi');
    expect(res.body).not.toContain('Yabancı Ürün');
  });

  it('şube kısıtı olmayan üyelikte tüm şubeler gelir', async () => {
    const res = await req(`/exports/orders.csv?${RANGE}`, manager.cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain('İkinci Şube Pidesi');
    expect(res.body).toContain('Kıymalı Pide');
    expect(res.body).toContain('İkinci Şube'); // sube sütunu
  });

  it('kişisel veri kademesi: varsayılan maskeli, includePersonal ile açık', async () => {
    // Sipariş satırındaki telefon/adres sipariş anlık görüntüsünden gelir (insertOrder sabiti)
    const masked = await req(`/exports/orders.csv?${RANGE}`, a.ownerCookie);
    expect(masked.body).toContain('0*** *** 88 77');
    expect(masked.body).not.toContain('+905329998877');
    expect(masked.body).not.toContain('Cumhuriyet Mah.');
    expect(masked.body).not.toContain('Eczanenin üstü');

    resetExportLimits();
    const full = await req(`/exports/orders.csv?${RANGE}&includePersonal=1`, a.ownerCookie);
    expect(full.statusCode, full.body).toBe(200);
    expect(full.body).toContain('+905329998877');
    expect(full.body).toContain('Cumhuriyet Mah. 5. Sokak No 3');
    expect(full.body).toContain('Eczanenin üstü');
  });

  it('CSV formül enjeksiyonu kırılır (müşteri notu)', async () => {
    const res = await req(`/exports/orders.csv?${RANGE}`, a.ownerCookie);
    expect(res.body).toContain(`'=1+1`);
    expect(res.body).not.toMatch(/(^|;)=/m);
  });

  it('şube kısıtlı üyelik yalnız kendi şubesini görür; başka şube 404', async () => {
    const own = await req(`/exports/orders.csv?${RANGE}`, branchManager.cookie);
    expect(own.statusCode, own.body).toBe(200);
    expect(own.body).toContain('İkinci Şube Pidesi');
    expect(own.body).not.toContain('Kıymalı Pide');

    resetExportLimits();
    expectError(await req(`/exports/orders.csv?${RANGE}&branchId=${a.branchId}`, branchManager.cookie), 404, 'not_found');
    resetExportLimits();
    // Başka tenant'ın şubesi
    expectError(await req(`/exports/orders.csv?${RANGE}&branchId=${b.branchId}`, a.ownerCookie), 404, 'not_found');
  });

  it('yetki: kasiyer ve mutfak toplu indirmez; oturumsuz 401', async () => {
    expectError(await req(`/exports/orders.csv?${RANGE}`, cashier.cookie), 403, 'forbidden');
    expectError(await req(`/exports/orders.csv?${RANGE}`, kitchen.cookie), 403, 'forbidden');
    expectError(await req(`/exports/orders.csv?${RANGE}`), 401, 'unauthorized');
  });

  it('destek oturumu kişisel veriyi toplu indiremez (maskeli dosya serbest)', async () => {
    expectError(await req(`/exports/orders.csv?${RANGE}&includePersonal=1`, support), 403, 'impersonation_export_blocked');
    resetExportLimits();
    const masked = await req(`/exports/orders.csv?${RANGE}`, support);
    expect(masked.statusCode, masked.body).toBe(200);
    expect(masked.body).not.toContain('+905329998877');
    expect(masked.body).toContain('0*** *** 88 77');
  });

  it('geçersiz aralık doğrulama hatası döner', async () => {
    expectError(await req('/exports/orders.csv?from=2026-09-30&to=2026-09-01', a.ownerCookie), 400, 'validation_error');
    resetExportLimits();
    expectError(await req('/exports/orders.csv?from=2020-01-01&to=2026-09-30', a.ownerCookie), 400, 'validation_error');
    resetExportLimits();
    expectError(await req('/exports/orders.csv?from=kasim&to=2026-09-30', a.ownerCookie), 400, 'validation_error');
  });

  it('hız sınırı: pencerede sınır kadar dosya, sonrası 429', async () => {
    const fresh = await ctx.createTenantWithOwner();
    for (let i = 0; i < EXPORT_RATE_LIMIT.limit; i++) {
      const ok = await req(`/exports/orders.csv?${RANGE}`, fresh.ownerCookie);
      expect(ok.statusCode, `${i}. istek`).toBe(200);
    }
    expectError(await req(`/exports/orders.csv?${RANGE}`, fresh.ownerCookie), 429, 'rate_limited');
    // Kova dosya türü başına ayrıdır: müşteri dosyası aynı istekte engellenmez
    expect((await req('/exports/customers.csv', fresh.ownerCookie)).statusCode).toBe(200);
  });
});

describe('GET /panel/exports/orders.json', () => {
  it('tek geçerli JSON belgesi: üstbilgi, satırlar, sayaç', async () => {
    const res = await req(`/exports/orders.json?${RANGE}`, a.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('siparisler-pide-evi-');
    const doc = JSON.parse(res.body) as {
      format: string;
      kind: string;
      includesPersonalData: boolean;
      range: { from: string; to: string };
      scope: { tenantId: string; branchId: string | null };
      rows: { number: number; totalKurus: number; customerPhone: string | null; addressLine: string | null; items: string }[];
      rowCount: number;
      truncated: boolean;
    };
    expect(doc.format).toBe('yemekgelsin.tenant_export.v1');
    expect(doc.kind).toBe('orders');
    expect(doc.includesPersonalData).toBe(false);
    expect(doc.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(doc.scope).toEqual({ tenantId: a.tenantId, branchId: null });
    expect(doc.rowCount).toBe(doc.rows.length);
    expect(doc.rowCount).toBe(3); // iki birinci şube + bir ikinci şube; test siparişi hariç
    expect(doc.truncated).toBe(false);
    expect(doc.rows[0]!.customerPhone).toBe('0*** *** 88 77');
    expect(doc.rows[0]!.addressLine).toBeNull();
    // Sıralama: placed_at artan
    expect(doc.rows.map((r) => r.totalKurus)).toEqual([23500, 9000, 44400]);
  });
});

describe('GET /panel/exports/customers.csv', () => {
  it('KVKK silinmiş müşteri dosyada yok; tenant yalıtımı; maskeli telefon', async () => {
    const res = await req('/exports/customers.csv', a.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-disposition']).toContain('musteriler-pide-evi-');
    expect(res.body.startsWith('﻿ad;telefon;')).toBe(true);
    expect(res.body).toContain('Ayşe Yılmaz');
    expect(res.body).toContain('0*** *** 22 33');
    expect(res.body).not.toContain('+905321112233');
    expect(res.body).not.toContain('Silinecek');
    expect(res.body).not.toContain('Başka Tenant Müşterisi');
    // Müşteri adı formülle başlıyorsa tek tırnakla metne çevrilir (dosya muhasebeciye de gidiyor)
    expect(res.body).toContain(`"'=HYPERLINK(""http://kotu.example"",""Tıkla"")"`);
    // Not alanındaki telefon maskelenmez (işletmenin kendi notu) ama formül kaçışı uygulanır
    expect(res.body).toContain(`'+905320000000`);
  });

  it('teslim edilen sipariş sayısı ve toplamı satırda', async () => {
    const res = await req('/exports/customers.json', a.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    const doc = JSON.parse(res.body) as { kind: string; range: null; rows: { name: string | null; deliveredCount: number; deliveredTotalKurus: number }[] };
    expect(doc.kind).toBe('customers');
    expect(doc.range).toBeNull();
    const ayse = doc.rows.find((r) => r.name === 'Ayşe Yılmaz')!;
    expect(ayse.deliveredCount).toBe(1);
    expect(ayse.deliveredTotalKurus).toBe(23500);
    expect(doc.rows.some((r) => r.name === 'Silinecek')).toBe(false);
  });

  it('şube kısıtlı üyelik yalnız o şubede siparişi olan müşterileri görür', async () => {
    const res = await req('/exports/customers.csv', branchManager.cookie);
    expect(res.statusCode, res.body).toBe(200);
    // İkinci şube siparişinin müşterisi yok → dosya başlıktan ibarettir
    expect(res.body).not.toContain('Ayşe Yılmaz');
    expect(res.body.trim().split('\r\n').length).toBe(1);
  });

  it('tarih aralığı verilirse ilk görülme tarihine göre süzer', async () => {
    const res = await req('/exports/customers.csv?from=2000-01-01&to=2000-12-31', a.ownerCookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body.trim().split('\r\n').length).toBe(1);
  });

  it('yetki: kasiyer indiremez', async () => {
    expectError(await req('/exports/customers.csv', cashier.cookie), 403, 'forbidden');
    expectError(await req('/exports/customers.json', kitchen.cookie), 403, 'forbidden');
  });

  it('silinmiş müşteri kaydı gerçekten duruyor (test kurulumu doğru)', async () => {
    const rows = await ctx.db.select().from(customerErasures).where(eq(customerErasures.customerId, erasedId));
    expect(rows).toHaveLength(1);
  });
});

describe('dışa aktarma yardımcıları', () => {
  it('parseExportRange: varsayılan dönem, ters aralık, en uzun dönem', () => {
    const now = new Date('2026-09-30T10:00:00+03:00');
    const def = parseExportRange(undefined, undefined, now);
    expect(def.toDate).toBe('2026-09-30');
    expect(def.fromDate).toBe('2026-09-01'); // 30 gün dahil
    expect(EXPORT_DEFAULT_DAYS).toBe(30);
    expect(def.from.toISOString()).toBe('2026-08-31T21:00:00.000Z');
    expect(def.to.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(() => parseExportRange('2026-09-30', '2026-09-01')).toThrow();
    expect(() => parseExportRange('2025-01-01', '2026-09-30')).toThrow();
    expect(EXPORT_MAX_DAYS).toBe(366);
    expect(parseOptionalRange(undefined, undefined)).toBeNull();
    expect(parseOptionalRange('2026-09-01', '2026-09-02')?.fromDate).toBe('2026-09-01');
  });

  it('csvCell: ayraç/tırnak kaçışı ve formül kırma', () => {
    expect(csvCell('Pide')).toBe('Pide');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('di"ye')).toBe('"di""ye"');
    expect(csvCell('=1+1')).toBe(`'=1+1`);
    expect(csvCell('@kullanici')).toBe(`'@kullanici`);
    expect(csvCell('-125,50')).toBe('-125,50'); // negatif sayı bozulmaz
    expect(csvCell('-- not')).toBe(`'-- not`);
    expect(csvCell(' bosluk ')).toBe('" bosluk "');
  });
});

describe('akış ve kapasite kapıları', () => {
  /** Üreticiyi satırlara + dönüş değerine ayırır. */
  async function collect<T>(rows: ExportRows<T>): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    for (;;) {
      const next = await rows.next();
      if (next.done) return { items, truncated: next.value.truncated };
      items.push(next.value);
    }
  }

  const range = () => parseExportRange('2026-09-01', '2026-09-30');
  const scope = () => ({ tenantId: a.tenantId, branchId: null });

  it('öbek sınırı satırları atlamaz ve tekrarlamaz', async () => {
    const whole = await collect(exportOrders(ctx.db, scope(), range()));
    // Tek satırlık öbeklerle aynı sonuç gelmeli (keyset imleci doğru taşınıyor)
    const paged = await collect(exportOrders(ctx.db, scope(), range(), { batchSize: 1 }));
    expect(paged.items).toEqual(whole.items);
    expect(whole.truncated).toBe(false);
    expect(paged.truncated).toBe(false);
    expect(whole.items).toHaveLength(3);
  });

  it('satır tavanı aşılırsa kırpılma bildirilir; tam oturan dosya kırpılmış sayılmaz', async () => {
    const cut = await collect(exportOrders(ctx.db, scope(), range(), { maxRows: 2, batchSize: 1 }));
    expect(cut.items).toHaveLength(2);
    expect(cut.truncated).toBe(true);

    // Veri kümesi tam 3 satır: tavan 3 olduğunda kırpılma YOK (yoklama sorgusu boş döner)
    const exact = await collect(exportOrders(ctx.db, scope(), range(), { maxRows: 3, batchSize: 1 }));
    expect(exact.items).toHaveLength(3);
    expect(exact.truncated).toBe(false);
  });

  it('kırpılma CSV dosyasının İÇİNDE görünür', async () => {
    const rows = exportOrders(ctx.db, scope(), range(), { maxRows: 1 });
    let out = '';
    for await (const chunk of csvChunks(ORDER_CSV_HEADER, rows, orderCsvCells)) out += chunk;
    const lines = out.trim().split('\r\n');
    expect(lines).toHaveLength(3); // başlık + 1 satır + kırpılma notu
    expect(lines[2]).toContain('KIRPILDI');
    expect(CSV_TRUNCATED_MARKER).toContain('200000');
  });

  it('eşzamanlılık kapısı sızdırmaz: istek bitince sayaç sıfıra döner', async () => {
    expect(EXPORT_MAX_CONCURRENT).toBeGreaterThan(0);
    expect(activeExportCount()).toBe(0);
    expect((await req(`/exports/orders.csv?${RANGE}`, a.ownerCookie)).statusCode).toBe(200);
    expect(activeExportCount()).toBe(0);
    // Doğrulama hatasında da bırakılır
    expectError(await req('/exports/orders.csv?from=2026-09-30&to=2026-09-01', a.ownerCookie), 400, 'validation_error');
    expect(activeExportCount()).toBe(0);
    // Yetkisiz istek kapıya hiç girmez
    expectError(await req(`/exports/orders.csv?${RANGE}`, cashier.cookie), 403, 'forbidden');
    expect(activeExportCount()).toBe(0);
  });
});
