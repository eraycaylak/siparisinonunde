// Panel menü araçları: toplu fiyat (önizleme/uygulama/yuvarlama/geri al), görsel yükleme (tür/boyut), CSV içe/dışa aktarma.

import type { BulkPriceResponse, MenuImportResponse, PanelMenuResponse } from '@siparis/core/menu/contracts';
import { auditLog, categories, priceChangeBatches, products } from '@siparis/db';
import { and, eq, isNull } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeNewPrice } from '../src/services/menu/bulk-price';
import { parseCsv, parseMenuCsv } from '../src/services/menu/csv';
import { createTestContext, expectError, type TestContext, type TestTenant } from './helpers';
import { TINY_PNG, multipartBody, seedMenu, type SeededMenu } from './menu-helpers';

let ctx: TestContext;
let a: TestTenant;
let b: TestTenant;
let menuA: SeededMenu;
let menuB: SeededMenu;
let cashier: string;

const P = '/api/v1/panel';

beforeAll(async () => {
  ctx = await createTestContext();
  a = await ctx.createTenantWithOwner({ name: 'Araç A', slug: 'arac-a' });
  b = await ctx.createTenantWithOwner({ name: 'Araç B', slug: 'arac-b' });
  menuA = await seedMenu(ctx, a.tenantId, a.branchId);
  menuB = await seedMenu(ctx, b.tenantId, b.branchId);
  cashier = (await ctx.createStaff(a.tenantId, 'cashier')).cookie;
});

afterAll(async () => {
  await ctx.close();
});

const post = (url: string, cookie: string, body: unknown) => ctx.request({ method: 'POST', url: `${P}${url}`, cookie, body });

async function price(id: string) {
  const [row] = await ctx.db.select({ p: products.priceKurus }).from(products).where(eq(products.id, id));
  return row!.p;
}

describe('toplu fiyat — hesap', () => {
  it('yüzde, sabit ve yuvarlama', () => {
    expect(computeNewPrice(20000, 'percent', 12, 'none')).toBe(22400);
    expect(computeNewPrice(20000, 'percent', 12, '5')).toBe(22500);
    expect(computeNewPrice(9000, 'percent', 7.5, '1')).toBe(9700);
    expect(computeNewPrice(9000, 'percent', 7.5, 'none')).toBe(9675);
    expect(computeNewPrice(3000, 'fixed', 1550, '0.5')).toBe(4550);
    expect(computeNewPrice(3000, 'fixed', -1000, 'none')).toBe(2000);
    expect(computeNewPrice(12345, 'percent', 0, '10')).toBe(12000);
  });
});

describe('POST /panel/menu/bulk-price', () => {
  it('önizleme: eski/yeni fiyat listesi, veritabanı değişmez', async () => {
    const res = await post('/menu/bulk-price', a.ownerCookie, {
      productIds: [menuA.pide, menuA.ayran],
      kind: 'percent',
      value: 12,
      rounding: '5',
      preview: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as BulkPriceResponse;
    expect(body).toMatchObject({ preview: true, batchId: null, changedCount: 2, invalidCount: 0, warnings: [] });
    const pide = body.items.find((i) => i.productId === menuA.pide)!;
    expect(pide).toMatchObject({ name: 'Kıymalı Pide', categoryName: 'Pideler', oldPriceKurus: 20000, newPriceKurus: 22500, diffKurus: 2500 });
    expect(body.items.find((i) => i.productId === menuA.ayran)!.newPriceKurus).toBe(3500);
    expect(await price(menuA.pide)).toBe(20000);
  });

  it('uygulama: fiyatlar, price_change_batches kaydı ve audit', async () => {
    const res = await post('/menu/bulk-price', a.ownerCookie, {
      productIds: [menuA.pide, menuA.ayran],
      kind: 'percent',
      value: 12,
      rounding: '5',
      preview: false,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as BulkPriceResponse;
    expect(body.preview).toBe(false);
    expect(body.batchId).toBeTruthy();
    expect(await price(menuA.pide)).toBe(22500);
    expect(await price(menuA.ayran)).toBe(3500);
    const [batch] = await ctx.db.select().from(priceChangeBatches).where(eq(priceChangeBatches.id, body.batchId!));
    expect(batch).toMatchObject({ tenantId: a.tenantId, kind: 'percent', value: 1200, appliedByUserId: a.owner.id });
    expect(batch!.previousPrices).toEqual({ [menuA.pide]: 20000, [menuA.ayran]: 3000 });
    const audits = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'menu.bulk_price'));
    expect(audits.at(-1)).toMatchObject({ entityId: body.batchId, tenantId: a.tenantId });

    // 24 sa içinde geri al
    const revert = await post(`/menu/bulk-price/${body.batchId}/revert`, a.ownerCookie, {});
    expect(revert.statusCode, revert.body).toBe(200);
    expect(revert.json()).toEqual({ ok: true, restoredCount: 2 });
    expect(await price(menuA.pide)).toBe(20000);
    expectError(await post(`/menu/bulk-price/${body.batchId}/revert`, a.ownerCookie, {}), 409, 'already_reverted');
  });

  it('negatif fiyat yasak: önizlemede işaretlenir, uygulama 400 invalid_price', async () => {
    const input = { productIds: [menuA.ayran, menuA.pide], kind: 'fixed', value: -5000, rounding: 'none' } as const;
    const pre = (await post('/menu/bulk-price', a.ownerCookie, { ...input, preview: true })).json() as BulkPriceResponse;
    expect(pre.invalidCount).toBe(1);
    expect(pre.items.find((i) => i.productId === menuA.ayran)).toMatchObject({ newPriceKurus: -2000, invalid: true });
    expectError(await post('/menu/bulk-price', a.ownerCookie, { ...input, preview: false }), 400, 'invalid_price');
    expect(await price(menuA.ayran)).toBe(3000);
  });

  it('%50\'yi aşan değişimde uyarı', async () => {
    const pre = (await post('/menu/bulk-price', a.ownerCookie, { productIds: [menuA.pide], kind: 'percent', value: 60, preview: true })).json() as BulkPriceResponse;
    expect(pre.warnings).toEqual(['large_change']);
  });

  it('geçersiz değer: sabit tutar kuruş tam sayı olmalı; yüzde en çok 2 ondalık', async () => {
    expectError(await post('/menu/bulk-price', a.ownerCookie, { productIds: [menuA.pide], kind: 'fixed', value: 10.5, preview: true }), 400, 'invalid_value');
    expectError(await post('/menu/bulk-price', a.ownerCookie, { productIds: [menuA.pide], kind: 'percent', value: 1.234, preview: true }), 400, 'invalid_value');
    expectError(await post('/menu/bulk-price', a.ownerCookie, { productIds: [], kind: 'percent', value: 5, preview: true }), 400, 'validation_error');
  });

  it('yetki ve yalıtım: kasiyer 403; başka tenant\'ın ürünü 404 ve değişmez', async () => {
    expectError(await post('/menu/bulk-price', cashier, { productIds: [menuA.pide], kind: 'percent', value: 5, preview: true }), 403, 'forbidden');
    expectError(
      await post('/menu/bulk-price', a.ownerCookie, { productIds: [menuA.pide, menuB.pide], kind: 'percent', value: 5, preview: false }),
      404,
      'not_found',
    );
    expect(await price(menuB.pide)).toBe(20000);
    const [batch] = await ctx.db.select().from(priceChangeBatches).where(eq(priceChangeBatches.tenantId, b.tenantId));
    expect(batch).toBeUndefined();
  });
});

describe('POST /panel/uploads', () => {
  const upload = (cookie: string, file: Parameters<typeof multipartBody>[0]) => {
    const { payload, contentType } = multipartBody(file);
    return ctx.app.inject({ method: 'POST', url: `${P}/uploads`, headers: { cookie, 'content-type': contentType }, payload });
  };

  it('PNG yüklenir, rastgele adla kaydedilir ve /api/v1/uploads altından servis edilir', async () => {
    const res = await upload(a.ownerCookie, { filename: 'logo.png', contentType: 'image/png', data: TINY_PNG });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { url: string; contentType: string; size: number };
    expect(body).toMatchObject({ contentType: 'image/png', size: TINY_PNG.length });
    expect(body.url).toMatch(/^\/api\/v1\/uploads\/[A-Za-z0-9_-]+\.png$/);
    const name = body.url.split('/').pop()!;
    expect(existsSync(join(ctx.config.uploadDirAbs, name))).toBe(true);
    const get = await ctx.request({ method: 'GET', url: body.url });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toContain('image/png');
  });

  it('tür dosya imzasından belirlenir: PNG adlı metin dosyası 415', async () => {
    const res = await upload(a.ownerCookie, { filename: 'sahte.png', contentType: 'image/png', data: Buffer.from('<svg onload=alert(1)>') });
    expectError(res, 415, 'unsupported_media_type');
  });

  it('1 MB üstü (5 MB altı) görsel kabul edilir', async () => {
    const mid = Buffer.concat([TINY_PNG, Buffer.alloc(2 * 1024 * 1024, 1)]);
    const res = await upload(a.ownerCookie, { filename: 'orta.png', contentType: 'image/png', data: mid });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('5 MB üstü 413', async () => {
    const big = Buffer.concat([TINY_PNG, Buffer.alloc(5 * 1024 * 1024 + 10, 1)]);
    const res = await upload(a.ownerCookie, { filename: 'buyuk.png', contentType: 'image/png', data: big });
    expectError(res, 413, 'payload_too_large');
  });

  it('multipart olmayan istek 415; kasiyer 403; oturumsuz 401', async () => {
    expectError(await post('/uploads', a.ownerCookie, { url: 'x' }), 415, 'unsupported_media_type');
    expectError(await upload(cashier, { filename: 'a.png', contentType: 'image/png', data: TINY_PNG }), 403, 'forbidden');
    const { payload, contentType } = multipartBody({ filename: 'a.png', contentType: 'image/png', data: TINY_PNG });
    const anon = await ctx.app.inject({ method: 'POST', url: `${P}/uploads`, headers: { 'content-type': contentType }, payload });
    expectError(anon, 401, 'unauthorized');
  });
});

describe('CSV', () => {
  it('ayrıştırıcı: tırnak, ondalık virgül, BOM, başlık', () => {
    const rows = parseCsv('﻿kategori;ürün;açıklama;fiyat\r\nPideler;"Kaşarlı; bol";"""Özel"" harç";125,50\n');
    expect(rows[1]!.cells).toEqual(['Pideler', 'Kaşarlı; bol', '"Özel" harç', '125,50']);
    const menu = parseMenuCsv('kategori;ürün;açıklama;fiyat\nPideler;Kaşarlı;;1.250,50\nPideler;;;10\nX;Y;;abc', {
      categoryName: 60,
      productName: 60,
      description: 300,
      maxPriceKurus: 10_000_000,
    });
    expect(menu[0]).toMatchObject({ line: 2, category: 'Pideler', name: 'Kaşarlı', description: null, priceKurus: 125050 });
    expect(menu[1]!.error).toBe('Ürün adı boş.');
    expect(menu[2]!.error).toContain('Fiyat okunamadı');
  });

  it('dışa aktarma: BOM, başlık, Türkçe ondalık, yalnız kendi menüsü', async () => {
    const res = await ctx.request({ method: 'GET', url: `${P}/menu/export.csv`, cookie: a.ownerCookie });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('menu-arac-a-');
    expect(res.body.startsWith('﻿kategori;ürün;açıklama;fiyat\r\n')).toBe(true);
    expect(res.body).toContain('Pideler;Kıymalı Pide;Taş fırında;200,00');
    expect(res.body).toContain('İçecekler;Ayran;;30,00');
    expect(res.body).not.toContain('Silinmiş Ürün');
    expectError(await ctx.request({ method: 'GET', url: `${P}/menu/export.csv`, cookie: cashier }), 403, 'forbidden');
  });

  const csv = [
    'kategori;ürün;açıklama;fiyat',
    'Pideler;Kıymalı Pide;Taş fırında;210,00', // güncelle (fiyat)
    'İçecekler;Ayran;;30,00', // değişmedi
    'Tatlılar;Sütlaç;Fırında;90', // yeni kategori + yeni ürün
    'İçecekler;Efes Bira;50 cl;120,00', // yeni ürün, kısıt önerisi
    'Tatlılar;;;10', // hata
    'Pideler;kıymalı pide;;5', // dosyada tekrar → hata
  ].join('\n');

  it('içe aktarma önizlemesi: satır eylemleri ve özet; veritabanı değişmez', async () => {
    const res = await post('/menu/import.csv', a.ownerCookie, { csv, preview: true });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as MenuImportResponse;
    expect(body.rows.map((r) => r.action)).toEqual(['update', 'unchanged', 'create', 'create', 'error', 'error']);
    expect(body.rows[3]!.restrictedSuggested).toBe(true);
    expect(body.rows[5]!.error).toContain('satır 2');
    expect(body.summary).toEqual({ create: 2, update: 1, unchanged: 1, error: 2, newCategories: ['Tatlılar'] });
    expect(await price(menuA.pide)).toBe(20000);
  });

  it('uygula: kategoriler ve ürünler oluşur/güncellenir, hatalı satırlar atlanır, audit', async () => {
    const res = await post('/menu/import.csv', a.ownerCookie, { csv, preview: false });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as MenuImportResponse;
    expect(body.preview).toBe(false);
    expect(await price(menuA.pide)).toBe(21000);
    const [tatli] = await ctx.db
      .select()
      .from(categories)
      .where(and(eq(categories.tenantId, a.tenantId), eq(categories.name, 'Tatlılar'), isNull(categories.deletedAt)));
    expect(tatli).toBeDefined();
    const menu = (await ctx.request({ method: 'GET', url: `${P}/menu`, cookie: a.ownerCookie })).json() as PanelMenuResponse;
    const sutlac = menu.products.find((p) => p.name === 'Sütlaç')!;
    expect(sutlac).toMatchObject({ categoryId: tatli!.id, priceKurus: 9000, description: 'Fırında' });
    expect(menu.products.find((p) => p.name === 'Efes Bira')!.waRestricted).toBe(true);
    const audits = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'menu.csv_import'));
    expect(audits.at(-1)!.data).toMatchObject({ create: 2, update: 1, error: 2 });

    // Aynı dosya ikinci kez: yeni kayıt yok
    const again = (await post('/menu/import.csv', a.ownerCookie, { csv, preview: true })).json() as MenuImportResponse;
    expect(again.summary).toMatchObject({ create: 0, update: 0, unchanged: 4, newCategories: [] });
  });

  it('yalıtım: B tenant\'ının menüsü etkilenmez; kasiyer 403; boş dosya 400', async () => {
    const bRows = await ctx.db.select().from(products).where(eq(products.tenantId, b.tenantId));
    expect(bRows.find((p) => p.name === 'Sütlaç')).toBeUndefined();
    expect(bRows.find((p) => p.id === menuB.pide)!.priceKurus).toBe(20000);
    expectError(await post('/menu/import.csv', cashier, { csv, preview: true }), 403, 'forbidden');
    expectError(await post('/menu/import.csv', a.ownerCookie, { csv: 'kategori;ürün;açıklama;fiyat\n', preview: true }), 400, 'csv_empty');
  });
});
