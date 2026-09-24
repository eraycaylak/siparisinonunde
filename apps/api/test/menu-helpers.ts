// Dilim 1 (menü + storefront) test yardımcıları.

import { categories, deliveryZones, optionGroups, options, productOptionGroups, products } from '@siparis/db';
import type { TestContext } from './helpers';

export interface SeededMenu {
  catPide: string;
  catIcecek: string;
  catEmpty: string;
  catInactive: string;
  pide: string;
  lahmacun: string;
  ayran: string;
  bira: string;
  kunefeSoldOut: string;
  inactiveProduct: string;
  deletedProduct: string;
  impossible: string;
  gAci: string;
  gEkstra: string;
  gBos: string;
  optAcili: string;
  optAcisiz: string;
  optKasar: string;
  optYumurta: string;
  optInactive: string;
  zoneA: string;
  zoneInactive: string;
}

/** Tenant'a küçük bir menü + bölgeler yazar (storefront ve panel testleri). */
export async function seedMenu(ctx: TestContext, tenantId: string, branchId: string): Promise<SeededMenu> {
  const db = ctx.db;
  const [catPide, catIcecek, catEmpty, catInactive] = await db
    .insert(categories)
    .values([
      { tenantId, name: 'Pideler', sort: 1 },
      { tenantId, name: 'İçecekler', sort: 2 },
      { tenantId, name: 'Boş Kategori', sort: 3 },
      { tenantId, name: 'Kapalı Kategori', sort: 4, isActive: false },
    ])
    .returning();
  const [gAci, gEkstra, gBos] = await db
    .insert(optionGroups)
    .values([
      { tenantId, name: 'Acı', minSelect: 1, maxSelect: 1, sort: 0 },
      { tenantId, name: 'Ekstralar', minSelect: 0, maxSelect: 2, sort: 1 },
      { tenantId, name: 'Ekmek', minSelect: 1, maxSelect: 1, sort: 2 },
    ])
    .returning();
  const optRows = await db
    .insert(options)
    .values([
      { tenantId, groupId: gAci!.id, name: 'Acılı', priceDeltaKurus: 0, sort: 0 },
      { tenantId, groupId: gAci!.id, name: 'Acısız', priceDeltaKurus: 0, sort: 1 },
      { tenantId, groupId: gEkstra!.id, name: 'Kaşar', priceDeltaKurus: 3000, sort: 0 },
      { tenantId, groupId: gEkstra!.id, name: 'Yumurta', priceDeltaKurus: 2000, sort: 1 },
      { tenantId, groupId: gEkstra!.id, name: 'Sucuk (kapalı)', priceDeltaKurus: 4000, sort: 2, isActive: false },
      // gBos: yalnız pasif seçenek → zorunlu grup karşılanamaz
      { tenantId, groupId: gBos!.id, name: 'Tombik', priceDeltaKurus: 0, sort: 0, isActive: false },
    ])
    .returning();
  const opt = (name: string) => optRows.find((o) => o.name === name)!.id;
  const future = new Date(Date.now() + 6 * 3600_000);
  const past = new Date(Date.now() - 3600_000);
  const prodRows = await db
    .insert(products)
    .values([
      { tenantId, categoryId: catPide!.id, name: 'Kıymalı Pide', description: 'Taş fırında', priceKurus: 20000, sort: 1 },
      { tenantId, categoryId: catPide!.id, name: 'Lahmacun', priceKurus: 9000, sort: 0, soldOutUntil: past },
      { tenantId, categoryId: catPide!.id, name: 'Künefe', priceKurus: 15000, sort: 2, soldOutUntil: future },
      { tenantId, categoryId: catPide!.id, name: 'Pasif Ürün', priceKurus: 1000, sort: 3, isActive: false },
      { tenantId, categoryId: catPide!.id, name: 'Silinmiş Ürün', priceKurus: 1000, sort: 4, deletedAt: past },
      { tenantId, categoryId: catPide!.id, name: 'Dürüm', priceKurus: 12000, sort: 5 },
      { tenantId, categoryId: catIcecek!.id, name: 'Ayran', priceKurus: 3000, sort: 0 },
      { tenantId, categoryId: catIcecek!.id, name: 'Bira', priceKurus: 9000, sort: 1, waRestricted: true },
      { tenantId, categoryId: catInactive!.id, name: 'Gizli Kategori Ürünü', priceKurus: 1000, sort: 0 },
    ])
    .returning();
  const prod = (name: string) => prodRows.find((p) => p.name === name)!.id;
  await db.insert(productOptionGroups).values([
    { tenantId, productId: prod('Kıymalı Pide'), groupId: gEkstra!.id, sort: 1 },
    { tenantId, productId: prod('Kıymalı Pide'), groupId: gAci!.id, sort: 0 },
    { tenantId, productId: prod('Lahmacun'), groupId: gAci!.id, sort: 0 },
    { tenantId, productId: prod('Dürüm'), groupId: gBos!.id, sort: 0 },
  ]);
  const [zoneA, zoneInactive] = await db
    .insert(deliveryZones)
    .values([
      { tenantId, branchId, name: 'Merkez', kind: 'neighborhoods', neighborhoods: ['Medrese', 'Çapanoğlu'], feeKurus: 2000, minOrderKurus: 15000, etaMinutes: 25, sort: 0 },
      { tenantId, branchId, name: 'Kapalı Bölge', kind: 'neighborhoods', neighborhoods: ['Uzak'], feeKurus: 5000, minOrderKurus: 30000, etaMinutes: 40, sort: 1, isActive: false },
    ])
    .returning();
  return {
    catPide: catPide!.id,
    catIcecek: catIcecek!.id,
    catEmpty: catEmpty!.id,
    catInactive: catInactive!.id,
    pide: prod('Kıymalı Pide'),
    lahmacun: prod('Lahmacun'),
    ayran: prod('Ayran'),
    bira: prod('Bira'),
    kunefeSoldOut: prod('Künefe'),
    inactiveProduct: prod('Pasif Ürün'),
    deletedProduct: prod('Silinmiş Ürün'),
    impossible: prod('Dürüm'),
    gAci: gAci!.id,
    gEkstra: gEkstra!.id,
    gBos: gBos!.id,
    optAcili: opt('Acılı'),
    optAcisiz: opt('Acısız'),
    optKasar: opt('Kaşar'),
    optYumurta: opt('Yumurta'),
    optInactive: opt('Sucuk (kapalı)'),
    zoneA: zoneA!.id,
    zoneInactive: zoneInactive!.id,
  };
}

/** multipart/form-data gövdesi (inject için). */
export function multipartBody(file: { field?: string; filename: string; contentType: string; data: Buffer }) {
  const boundary = `----siparis${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.field ?? 'file'}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, file.data, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** 1×1 PNG. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
