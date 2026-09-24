// Menü: kategori, ürün, seçenek grupları (14 §4).

import { PRICE_CHANGE_KINDS, type PriceChangeKind } from '@siparis/core';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, pk, tstz, updatedAt } from './_helpers';
import { tenants } from './platform';

export const categories = pgTable(
  'categories',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sort: integer('sort').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: tstz('deleted_at'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('categories_tenant_sort_idx').on(t.tenantId, t.sort)],
);

export const products = pgTable(
  'products',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** KDV dahil, kuruş */
    priceKurus: integer('price_kurus').notNull(),
    imageUrl: text('image_url'),
    isActive: boolean('is_active').notNull().default(true),
    /** "Bugün tükendi": bu ana kadar satılamaz */
    soldOutUntil: tstz('sold_out_until'),
    /** Alkol/tütün vb. — storefront'ta satılamaz (00 §6.10) */
    waRestricted: boolean('wa_restricted').notNull().default(false),
    sort: integer('sort').notNull().default(0),
    deletedAt: tstz('deleted_at'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('products_tenant_category_sort_idx').on(t.tenantId, t.categoryId, t.sort),
    check('products_price_ck', sql`${t.priceKurus} >= 0`),
  ],
);

export const optionGroups = pgTable(
  'option_groups',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Panelde ayırt etmek için iç ad (ör. "Porsiyon — kebap") */
    internalName: text('internal_name'),
    minSelect: integer('min_select').notNull().default(0),
    /** null = sınırsız */
    maxSelect: integer('max_select'),
    sort: integer('sort').notNull().default(0),
    deletedAt: tstz('deleted_at'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('option_groups_tenant_idx').on(t.tenantId),
    check('option_groups_min_ck', sql`${t.minSelect} >= 0`),
    check('option_groups_max_ck', sql`${t.maxSelect} is null or ${t.maxSelect} >= ${t.minSelect}`),
  ],
);

export const options = pgTable(
  'options',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Negatif olabilir; satır toplamı < 0 olamaz */
    priceDeltaKurus: integer('price_delta_kurus').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    deletedAt: tstz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('options_group_sort_idx').on(t.groupId, t.sort), index('options_tenant_idx').on(t.tenantId)],
);

export const productOptionGroups = pgTable(
  'product_option_groups',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'cascade' }),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.groupId] }), index('product_option_groups_tenant_idx').on(t.tenantId)],
);

export const priceChangeBatches = pgTable(
  'price_change_batches',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<PriceChangeKind>().notNull(),
    /** percent: baz puan (%10 = 1000); fixed: kuruş */
    value: integer('value').notNull(),
    productIds: uuid('product_ids').array().notNull(),
    /** Geri alma için eski fiyatlar: { productId: priceKurus } */
    previousPrices: jsonb('previous_prices').$type<Record<string, number>>(),
    appliedByUserId: uuid('applied_by_user_id'),
    revertedAt: tstz('reverted_at'),
    createdAt: createdAt(),
  },
  (t) => [index('price_change_batches_tenant_idx').on(t.tenantId, t.createdAt), enumCheck('price_change_batches_kind_ck', t.kind, PRICE_CHANGE_KINDS)],
);
