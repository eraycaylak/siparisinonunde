// Dilim 1 (menü + storefront vitrini) sözleşmeleri: panel menü API'si (14 §6.3 Menü) ve
// storefront yanıtlarının geriye uyumlu genişletmeleri (14 §6.2). Web ve API aynı şemaları kullanır.
// İçe aktarma: `@siparis/core/menu/contracts`.

import { z } from 'zod';
import { idSchema, isoDateTimeSchema, kurusSchema } from '../contracts/common';
import { storefrontResponseSchema, storeSessionResponseSchema, type StorefrontResponse } from '../contracts/store';

// ---------------------------------------------------------------------------
// Sınırlar (04 §6.2)

export const MENU_LIMITS = {
  categoryName: 60,
  productName: 60,
  description: 300,
  groupName: 60,
  optionName: 60,
  /** 100.000 TL */
  maxPriceKurus: 10_000_000,
  maxOptionDeltaKurus: 1_000_000,
  maxGroupsPerProduct: 20,
  maxOptionsPerGroup: 50,
  uploadMaxBytes: 5 * 1024 * 1024,
} as const;

export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// ---------------------------------------------------------------------------
// Storefront vitrini: GET /store/:slug yanıtının tek tanımı core contracts/store.ts storefrontResponseSchema'dadır
// (whatsappPhone, closesAt, pausedUntil, phone, pickupMinOrderKurus dahil). Aşağıdakiler geriye dönük takma adlardır;
// API ve web aynı şemayı/tipi kullanır.

/** @deprecated storefrontResponseSchema ile aynı nesne. */
export const storefrontViewSchema = storefrontResponseSchema;
export type StorefrontView = StorefrontResponse;
export type StorefrontViewProduct = StorefrontView['categories'][number]['products'][number];
export type StorefrontViewCategory = StorefrontView['categories'][number];

/** Akış A bağlantısının durumu: active = geçerli token/çerez; expired = süresi dolmuş ya da geçersiz; none = yok. */
export const STORE_LINK_STATUSES = ['active', 'expired', 'none'] as const;
export type StoreLinkStatus = (typeof STORE_LINK_STATUSES)[number];

/** POST /store/:slug/session yanıtı: çekirdek şema + bağlantı durumu. */
export const storeSessionViewSchema = storeSessionResponseSchema.extend({
  linkStatus: z.enum(STORE_LINK_STATUSES),
  /** lastOrder kaynağı: WhatsApp bağlantısı ya da "bu cihazda hatırla" çerezi. */
  lastOrderSource: z.enum(['link', 'device']).nullable().optional(),
});
export type StoreSessionView = z.infer<typeof storeSessionViewSchema>;

// ---------------------------------------------------------------------------
// Panel menü ağacı (GET /panel/menu)

export const panelCategorySchema = z.object({
  id: idSchema,
  name: z.string(),
  sort: z.number().int(),
  isActive: z.boolean(),
  productCount: z.number().int(),
});
export type PanelCategory = z.infer<typeof panelCategorySchema>;

export const panelProductSchema = z.object({
  id: idSchema,
  categoryId: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  /** Mutfak rolünde yok (fiyat görmez, 04 §2.4). */
  priceKurus: kurusSchema.optional(),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  soldOut: z.boolean(),
  soldOutUntil: isoDateTimeSchema.nullable(),
  waRestricted: z.boolean(),
  sort: z.number().int(),
  optionGroupIds: z.array(idSchema),
  version: z.number().int(),
});
export type PanelProduct = z.infer<typeof panelProductSchema>;

export const panelOptionSchema = z.object({
  id: idSchema,
  groupId: idSchema,
  name: z.string(),
  priceDeltaKurus: kurusSchema.optional(),
  isActive: z.boolean(),
  sort: z.number().int(),
});
export type PanelOption = z.infer<typeof panelOptionSchema>;

export const panelOptionGroupSchema = z.object({
  id: idSchema,
  name: z.string(),
  internalName: z.string().nullable(),
  minSelect: z.number().int(),
  maxSelect: z.number().int().nullable(),
  sort: z.number().int(),
  options: z.array(panelOptionSchema),
  productCount: z.number().int(),
});
export type PanelOptionGroup = z.infer<typeof panelOptionGroupSchema>;

export const panelMenuResponseSchema = z.object({
  categories: z.array(panelCategorySchema),
  products: z.array(panelProductSchema),
  optionGroups: z.array(panelOptionGroupSchema),
  /** Menü düzenleme yetkisi (owner/manager ve salt-okunur olmayan oturum). Diğerleri yalnız "tükendi". */
  canEdit: z.boolean(),
  /** Fiyatlar görünür mü (mutfak rolünde false). */
  showPrices: z.boolean(),
});
export type PanelMenuResponse = z.infer<typeof panelMenuResponseSchema>;

// ---------------------------------------------------------------------------
// İstekler

const nameField = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} boş olamaz.`)
    .max(max, `${label} en çok ${max} karakter olabilir.`);

const descriptionField = z
  .string()
  .trim()
  .max(MENU_LIMITS.description, `Açıklama en çok ${MENU_LIMITS.description} karakter olabilir.`)
  .nullable()
  .transform((v) => (v ? v : null));

const priceField = z
  .number()
  .int('Fiyat kuruş cinsinden tam sayı olmalı.')
  .min(0, 'Fiyat negatif olamaz.')
  .max(MENU_LIMITS.maxPriceKurus, 'Fiyat çok yüksek.');

/** Görsel adresi: yalnız kendi yüklemelerimiz ya da https. */
const imageUrlField = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('/api/v1/uploads/') || v.startsWith('https://'), 'Görsel adresi geçersiz.')
  .nullable();

export const categoryCreateSchema = z.object({
  name: nameField(MENU_LIMITS.categoryName, 'Kategori adı'),
  isActive: z.boolean().optional(),
});
export type CategoryCreateRequest = z.infer<typeof categoryCreateSchema>;

export const categoryUpdateSchema = z.object({
  name: nameField(MENU_LIMITS.categoryName, 'Kategori adı').optional(),
  isActive: z.boolean().optional(),
});
export type CategoryUpdateRequest = z.infer<typeof categoryUpdateSchema>;

export const productCreateSchema = z.object({
  categoryId: idSchema,
  name: nameField(MENU_LIMITS.productName, 'Ürün adı'),
  description: descriptionField.optional(),
  priceKurus: priceField,
  imageUrl: imageUrlField.optional(),
  isActive: z.boolean().optional(),
  waRestricted: z.boolean().optional(),
  optionGroupIds: z.array(idSchema).max(MENU_LIMITS.maxGroupsPerProduct).optional(),
});
export type ProductCreateRequest = z.infer<typeof productCreateSchema>;

export const productUpdateSchema = z.object({
  categoryId: idSchema.optional(),
  name: nameField(MENU_LIMITS.productName, 'Ürün adı').optional(),
  description: descriptionField.optional(),
  priceKurus: priceField.optional(),
  imageUrl: imageUrlField.optional(),
  isActive: z.boolean().optional(),
  waRestricted: z.boolean().optional(),
  /** Bayrak kaldırılırken sebep (audit, 04 §6.8). */
  waRestrictedReason: z.string().trim().max(200).optional(),
  optionGroupIds: z.array(idSchema).max(MENU_LIMITS.maxGroupsPerProduct).optional(),
});
export type ProductUpdateRequest = z.infer<typeof productUpdateSchema>;

export const productOptionGroupsSchema = z.object({
  groupIds: z.array(idSchema).max(MENU_LIMITS.maxGroupsPerProduct),
});
export type ProductOptionGroupsRequest = z.infer<typeof productOptionGroupsSchema>;

export const soldOutRequestSchema = z.object({
  until: z.enum(['end_of_day']).nullable(),
});
export type SoldOutRequest = z.infer<typeof soldOutRequestSchema>;

export const soldOutResponseSchema = z.object({
  id: idSchema,
  soldOut: z.boolean(),
  soldOutUntil: isoDateTimeSchema.nullable(),
});
export type SoldOutResponse = z.infer<typeof soldOutResponseSchema>;

const deltaField = z
  .number()
  .int('Fiyat farkı kuruş cinsinden tam sayı olmalı.')
  .min(-MENU_LIMITS.maxOptionDeltaKurus)
  .max(MENU_LIMITS.maxOptionDeltaKurus);

export const optionInputSchema = z.object({
  id: idSchema.optional(),
  name: nameField(MENU_LIMITS.optionName, 'Seçenek adı'),
  priceDeltaKurus: deltaField.default(0),
  isActive: z.boolean().optional(),
});
export type OptionInput = z.input<typeof optionInputSchema>;

const minField = z.number().int().min(0, 'En az seçim negatif olamaz.').max(20);
const maxField = z.number().int().min(1, 'En çok seçim en az 1 olmalı.').max(MENU_LIMITS.maxOptionsPerGroup).nullable();

export const optionGroupCreateSchema = z
  .object({
    name: nameField(MENU_LIMITS.groupName, 'Grup adı'),
    internalName: z.string().trim().max(80).nullable().optional(),
    minSelect: minField,
    maxSelect: maxField,
    options: z.array(optionInputSchema).max(MENU_LIMITS.maxOptionsPerGroup).optional(),
  })
  .refine((v) => v.maxSelect === null || v.minSelect <= v.maxSelect, {
    message: 'En az seçim, en çok seçimden büyük olamaz.',
    path: ['minSelect'],
  });
export type OptionGroupCreateRequest = z.input<typeof optionGroupCreateSchema>;

export const optionGroupUpdateSchema = z.object({
  name: nameField(MENU_LIMITS.groupName, 'Grup adı').optional(),
  internalName: z.string().trim().max(80).nullable().optional(),
  minSelect: minField.optional(),
  maxSelect: maxField.optional(),
  /** Verilirse seçenek listesinin tamamı: id'li olanlar güncellenir, id'siz eklenir, listede olmayanlar silinir. */
  options: z.array(optionInputSchema).max(MENU_LIMITS.maxOptionsPerGroup).optional(),
});
export type OptionGroupUpdateRequest = z.input<typeof optionGroupUpdateSchema>;

export const optionCreateSchema = z.object({
  name: nameField(MENU_LIMITS.optionName, 'Seçenek adı'),
  priceDeltaKurus: deltaField.default(0),
  isActive: z.boolean().optional(),
});
export type OptionCreateRequest = z.input<typeof optionCreateSchema>;

export const optionUpdateSchema = z.object({
  name: nameField(MENU_LIMITS.optionName, 'Seçenek adı').optional(),
  priceDeltaKurus: deltaField.optional(),
  isActive: z.boolean().optional(),
});
export type OptionUpdateRequest = z.infer<typeof optionUpdateSchema>;

export const reorderRequestSchema = z
  .object({
    categories: z.array(idSchema).max(500).optional(),
    products: z.object({ categoryId: idSchema, ids: z.array(idSchema).max(1000) }).optional(),
    optionGroups: z.array(idSchema).max(500).optional(),
  })
  .refine((v) => v.categories || v.products || v.optionGroups, { message: 'Sıralanacak bir liste gönderin.' });
export type ReorderRequest = z.infer<typeof reorderRequestSchema>;

// ---------------------------------------------------------------------------
// Toplu fiyat (04 §6.5)

export const BULK_PRICE_ROUNDINGS = ['none', '0.5', '1', '5', '10'] as const;
export type BulkPriceRounding = (typeof BULK_PRICE_ROUNDINGS)[number];

export const bulkPriceRequestSchema = z.object({
  productIds: z.array(idSchema).min(1, 'En az bir ürün seçin.').max(2000),
  kind: z.enum(['percent', 'fixed']),
  /** percent: yüzde (12 = +%12, −5 = −%5; en çok 2 ondalık); fixed: kuruş (1500 = +15 TL, −1000 = −10 TL). */
  value: z.number().finite(),
  rounding: z.enum(BULK_PRICE_ROUNDINGS).default('none'),
  preview: z.boolean(),
});
export type BulkPriceRequest = z.input<typeof bulkPriceRequestSchema>;

export const bulkPriceItemSchema = z.object({
  productId: idSchema,
  name: z.string(),
  categoryName: z.string().nullable(),
  oldPriceKurus: kurusSchema,
  newPriceKurus: kurusSchema,
  diffKurus: kurusSchema,
  /** Yeni fiyat negatif ya da 0 (engellenir). */
  invalid: z.boolean(),
});
export type BulkPriceItem = z.infer<typeof bulkPriceItemSchema>;

export const bulkPriceResponseSchema = z.object({
  preview: z.boolean(),
  batchId: idSchema.nullable(),
  items: z.array(bulkPriceItemSchema),
  changedCount: z.number().int(),
  invalidCount: z.number().int(),
  /** 'large_change': %50'yi aşan değişim var (ikinci onay). */
  warnings: z.array(z.enum(['large_change'])),
});
export type BulkPriceResponse = z.infer<typeof bulkPriceResponseSchema>;

export const bulkPriceRevertResponseSchema = z.object({
  ok: z.literal(true),
  restoredCount: z.number().int(),
});
export type BulkPriceRevertResponse = z.infer<typeof bulkPriceRevertResponseSchema>;

// ---------------------------------------------------------------------------
// CSV içe/dışa aktarma (04 §6.6, Faz 1 temel: kategori;ürün;açıklama;fiyat)

export const MENU_CSV_HEADER = ['kategori', 'ürün', 'açıklama', 'fiyat'] as const;

export const menuImportRequestSchema = z.object({
  csv: z.string().min(1, 'Dosya boş.').max(1_500_000, 'Dosya çok büyük.'),
  preview: z.boolean(),
});
export type MenuImportRequest = z.infer<typeof menuImportRequestSchema>;

export const menuImportRowSchema = z.object({
  line: z.number().int(),
  category: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceKurus: kurusSchema.nullable(),
  action: z.enum(['create', 'update', 'unchanged', 'error']),
  error: z.string().optional(),
  /** Alkol/tütün vb. anahtar kelime: "WhatsApp'ta satılamaz" önerildi (yeni ürün bayraklı eklenir). */
  restrictedSuggested: z.boolean().optional(),
  productId: idSchema.optional(),
});
export type MenuImportRow = z.infer<typeof menuImportRowSchema>;

export const menuImportResponseSchema = z.object({
  preview: z.boolean(),
  rows: z.array(menuImportRowSchema),
  summary: z.object({
    create: z.number().int(),
    update: z.number().int(),
    unchanged: z.number().int(),
    error: z.number().int(),
    newCategories: z.array(z.string()),
  }),
});
export type MenuImportResponse = z.infer<typeof menuImportResponseSchema>;

export const uploadResponseSchema = z.object({
  url: z.string(),
  contentType: z.enum(UPLOAD_CONTENT_TYPES),
  size: z.number().int(),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

// ---------------------------------------------------------------------------
// "WhatsApp'ta satılamaz" önerisi (04 §6.8)

/** Aksansız, küçük harf tam kelimeler. */
const RESTRICTED_KEYWORDS = new Set([
  'bira',
  'biralar',
  'raki',
  'sarap',
  'saraplar',
  'viski',
  'votka',
  'likor',
  'cin',
  'tekila',
  'alkol',
  'alkollu',
  'sigara',
  'sigaralar',
  'nargile',
  'tutun',
  'puro',
  'tup',
  'lpg',
  'ilac',
  'ilaclar',
]);

function foldTr(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u');
}

/** Ad/açıklamada alkol, tütün, tüp, ilaç gibi anahtar kelime var mı (öneri; karar işletmenin). */
export function suggestRestricted(...texts: Array<string | null | undefined>): boolean {
  const words = foldTr(texts.filter(Boolean).join(' ')).split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((w) => RESTRICTED_KEYWORDS.has(w));
}
