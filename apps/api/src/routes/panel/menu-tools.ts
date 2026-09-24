// Panel menü araçları (14 §6.3 Menü) — dilim 1; menu.ts içinden kaydedilir (aynı /panel öneki).
//   POST /panel/menu/bulk-price {productIds[], kind, value, rounding?, preview}   (04 §6.5)
//   POST /panel/menu/bulk-price/:batchId/revert                                  (24 sa içinde geri al)
//   POST /panel/uploads (multipart, ≤ 5 MB, JPEG/PNG/WebP) → { url: '/api/v1/uploads/<ad>' }
//   GET  /panel/menu/export.csv · POST /panel/menu/import.csv {csv, preview}      (04 §6.6)

import multipart from '@fastify/multipart';
import {
  MENU_LIMITS,
  bulkPriceRequestSchema,
  bulkPriceResponseSchema,
  bulkPriceRevertResponseSchema,
  menuImportRequestSchema,
  menuImportResponseSchema,
  suggestRestricted,
  uploadResponseSchema,
  type MenuImportRow,
} from '@siparis/core/menu/contracts';
import { categories, priceChangeBatches, products, tenants } from '@siparis/db';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit, auditActor } from '../../lib/audit';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { requireTenantRole, tenantAuth } from '../../plugins/auth';
import { batchValue, computeBulkPrice } from '../../services/menu/bulk-price';
import { formatMenuCsv, nameKey, parseMenuCsv } from '../../services/menu/csv';
import { saveImage, sniffImageType } from '../../services/menu/uploads';
import { MENU_EDIT_ROLES, menuEditGuard } from './menu-guards';

const REVERT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_IMPORT_ROWS = 2000;

function isFileTooLarge(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_PARTS_LIMIT' || code === 'FST_FILES_LIMIT';
}

const menuToolsRoutes: FastifyPluginAsyncZod = async (app) => {
  const editGuard = menuEditGuard(app.db);

  // Kapsüllü: multipart ayrıştırıcısı yalnız bu eklentinin rotalarında etkin.
  await app.register(multipart, {
    limits: { fileSize: MENU_LIMITS.uploadMaxBytes, files: 1, fields: 5, parts: 6 },
  });

  // --- Toplu fiyat --------------------------------------------------------------------------------
  app.post(
    '/menu/bulk-price',
    { preHandler: editGuard, schema: { body: bulkPriceRequestSchema, response: { 200: bulkPriceResponseSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const body = request.body;
      if (body.kind === 'percent') {
        if (body.value <= -100 || body.value > 1000) throw badRequest('Yüzde değişim −%99 ile +%1000 arasında olmalı.', undefined, 'invalid_value');
        if (Math.abs(Math.round(body.value * 100) - body.value * 100) > 1e-6) throw badRequest('Yüzde en çok 2 ondalık basamak içerebilir.', undefined, 'invalid_value');
      } else if (!Number.isInteger(body.value) || Math.abs(body.value) > MENU_LIMITS.maxPriceKurus) {
        throw badRequest('Tutar kuruş cinsinden tam sayı olmalı.', undefined, 'invalid_value');
      }
      const ids = [...new Set(body.productIds.map((i) => i.toLowerCase()))];
      const rows = await app.db
        .select({ id: products.id, name: products.name, priceKurus: products.priceKurus, categoryName: categories.name })
        .from(products)
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .where(and(eq(products.tenantId, auth.tenantId), inArray(products.id, ids), isNull(products.deletedAt)))
        .orderBy(asc(categories.sort), asc(products.sort));
      if (rows.length !== ids.length) throw notFound('Ürün bulunamadı.');

      const result = computeBulkPrice(rows, body.kind, body.value, body.rounding);
      if (body.preview) return { preview: true, batchId: null, ...result };

      if (result.invalidCount > 0) {
        throw new AppError(400, 'invalid_price', 'Bazı ürünlerin yeni fiyatı 0 TL ya da altına düşüyor. Değişimi küçültün ya da bu ürünleri seçimden çıkarın.', {
          productIds: result.items.filter((i) => i.invalid).map((i) => i.productId),
        });
      }
      const changed = result.items.filter((i) => i.diffKurus !== 0);
      if (!changed.length) return { preview: false, batchId: null, ...result };

      const batchId = await app.db.transaction(async (tx) => {
        for (const item of changed) {
          await tx
            .update(products)
            .set({ priceKurus: item.newPriceKurus, version: sql`${products.version} + 1` })
            .where(and(eq(products.id, item.productId), eq(products.tenantId, auth.tenantId)));
        }
        const [batch] = await tx
          .insert(priceChangeBatches)
          .values({
            tenantId: auth.tenantId,
            kind: body.kind,
            value: batchValue(body.kind, body.value),
            productIds: changed.map((i) => i.productId),
            previousPrices: Object.fromEntries(changed.map((i) => [i.productId, i.oldPriceKurus])),
            appliedByUserId: auth.userId,
          })
          .returning({ id: priceChangeBatches.id });
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.bulk_price',
          entityType: 'price_change_batch',
          entityId: batch!.id,
          data: {
            kind: body.kind,
            value: body.value,
            rounding: body.rounding,
            count: changed.length,
            prices: Object.fromEntries(changed.map((i) => [i.productId, [i.oldPriceKurus, i.newPriceKurus]])),
          },
        });
        return batch!.id;
      });
      return { preview: false, batchId, ...result };
    },
  );

  app.post(
    '/menu/bulk-price/:batchId/revert',
    { preHandler: editGuard, schema: { params: z.object({ batchId: z.uuid() }), response: { 200: bulkPriceRevertResponseSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const [batch] = await app.db
        .select()
        .from(priceChangeBatches)
        .where(and(eq(priceChangeBatches.id, request.params.batchId), eq(priceChangeBatches.tenantId, auth.tenantId)));
      if (!batch) throw notFound('Toplu fiyat değişikliği bulunamadı.');
      if (batch.revertedAt) throw conflict('already_reverted', 'Bu toplu değişiklik zaten geri alındı.');
      if (Date.now() - batch.createdAt.getTime() > REVERT_WINDOW_MS) {
        throw conflict('revert_window_passed', 'Toplu fiyat değişikliği yalnız 24 saat içinde geri alınabilir.');
      }
      const previous = batch.previousPrices ?? {};
      const restoredCount = await app.db.transaction(async (tx) => {
        let n = 0;
        for (const [productId, price] of Object.entries(previous)) {
          const res = await tx
            .update(products)
            .set({ priceKurus: price, version: sql`${products.version} + 1` })
            .where(and(eq(products.id, productId), eq(products.tenantId, auth.tenantId), isNull(products.deletedAt)))
            .returning({ id: products.id });
          n += res.length;
        }
        await tx.update(priceChangeBatches).set({ revertedAt: new Date() }).where(eq(priceChangeBatches.id, batch.id));
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.bulk_price_revert',
          entityType: 'price_change_batch',
          entityId: batch.id,
          data: { restoredCount: n },
        });
        return n;
      });
      return { ok: true as const, restoredCount };
    },
  );

  // --- Görsel yükleme -----------------------------------------------------------------------------
  app.post(
    '/uploads',
    { preHandler: editGuard, bodyLimit: MENU_LIMITS.uploadMaxBytes + 512 * 1024, schema: { response: { 201: uploadResponseSchema } } },
    async (request, reply) => {
      if (!request.isMultipart()) {
        throw new AppError(415, 'unsupported_media_type', 'Görseli dosya olarak gönderin (multipart/form-data).');
      }
      let buf: Buffer;
      try {
        const file = await request.file();
        if (!file) throw badRequest('Bir görsel seçin.', undefined, 'file_required');
        buf = await file.toBuffer();
      } catch (err) {
        if (isFileTooLarge(err)) throw new AppError(413, 'payload_too_large', 'Görsel en fazla 5 MB olabilir.');
        throw err;
      }
      if (!buf.length) throw badRequest('Dosya boş.', undefined, 'file_required');
      const type = sniffImageType(buf);
      if (!type) throw new AppError(415, 'unsupported_media_type', 'Yalnız JPEG, PNG ya da WebP görsel yükleyebilirsiniz.');
      const saved = await saveImage(app.config.uploadDirAbs, buf, type);
      await audit(app.db, {
        ...auditActor(request),
        action: 'menu.upload',
        entityType: 'upload',
        data: { url: saved.url, contentType: saved.contentType, size: saved.size },
      });
      reply.status(201);
      return saved;
    },
  );

  // --- CSV dışa aktarma ---------------------------------------------------------------------------
  app.get('/menu/export.csv', { preHandler: requireTenantRole(MENU_EDIT_ROLES) }, async (request, reply) => {
    const auth = tenantAuth(request);
    const [tenant] = await app.db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, auth.tenantId));
    const rows = await app.db
      .select({ category: categories.name, name: products.name, description: products.description, priceKurus: products.priceKurus })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(and(eq(products.tenantId, auth.tenantId), isNull(products.deletedAt), isNull(categories.deletedAt)))
      .orderBy(asc(categories.sort), asc(categories.createdAt), asc(products.sort), asc(products.createdAt));
    const date = new Date().toISOString().slice(0, 10);
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="menu-${tenant?.slug ?? 'isletme'}-${date}.csv"`)
      .header('cache-control', 'no-store');
    return formatMenuCsv(rows);
  });

  // --- CSV içe aktarma (önizleme + uygula) ---------------------------------------------------------
  app.post(
    '/menu/import.csv',
    {
      preHandler: editGuard,
      bodyLimit: 2 * 1024 * 1024,
      schema: { body: menuImportRequestSchema, response: { 200: menuImportResponseSchema } },
    },
    async (request) => {
      const auth = tenantAuth(request);
      const t = auth.tenantId;
      const parsed = parseMenuCsv(request.body.csv, MENU_LIMITS);
      if (!parsed.length) throw badRequest('Dosyada ürün satırı bulunamadı. Biçim: kategori;ürün;açıklama;fiyat', undefined, 'csv_empty');
      if (parsed.length > MAX_IMPORT_ROWS) throw badRequest(`En çok ${MAX_IMPORT_ROWS} satır içe aktarılabilir.`, undefined, 'csv_too_large');

      const [catRows, prodRows] = await Promise.all([
        app.db.select().from(categories).where(and(eq(categories.tenantId, t), isNull(categories.deletedAt))),
        app.db.select().from(products).where(and(eq(products.tenantId, t), isNull(products.deletedAt))),
      ]);
      const catByKey = new Map(catRows.map((c) => [nameKey(c.name), c]));
      const prodByKey = new Map(prodRows.map((p) => [`${p.categoryId}|${nameKey(p.name)}`, p]));

      const seen = new Map<string, number>();
      const newCategories = new Map<string, string>();
      const rows: MenuImportRow[] = parsed.map((r) => {
        const base = { line: r.line, category: r.category, name: r.name, description: r.description, priceKurus: r.priceKurus };
        if (r.error) return { ...base, action: 'error' as const, error: r.error };
        const key = `${nameKey(r.category)}|${nameKey(r.name)}`;
        const prevLine = seen.get(key);
        if (prevLine !== undefined) return { ...base, action: 'error' as const, error: `Bu ürün dosyada daha önce geçti (satır ${prevLine}).` };
        seen.set(key, r.line);
        const cat = catByKey.get(nameKey(r.category));
        if (!cat && !newCategories.has(nameKey(r.category))) newCategories.set(nameKey(r.category), r.category);
        const existing = cat ? prodByKey.get(`${cat.id}|${nameKey(r.name)}`) : undefined;
        if (!existing) return { ...base, action: 'create' as const, ...(suggestRestricted(r.name, r.description) ? { restrictedSuggested: true } : {}) };
        const changed = existing.priceKurus !== r.priceKurus || (existing.description ?? null) !== r.description;
        return { ...base, action: changed ? ('update' as const) : ('unchanged' as const), productId: existing.id };
      });

      const summary = {
        create: rows.filter((r) => r.action === 'create').length,
        update: rows.filter((r) => r.action === 'update').length,
        unchanged: rows.filter((r) => r.action === 'unchanged').length,
        error: rows.filter((r) => r.action === 'error').length,
        newCategories: [...newCategories.values()],
      };
      if (request.body.preview) return { preview: true, rows, summary };

      const applied = await app.db.transaction(async (tx) => {
        const [maxCat] = await tx
          .select({ m: sql<number | null>`max(${categories.sort})` })
          .from(categories)
          .where(and(eq(categories.tenantId, t), isNull(categories.deletedAt)));
        let catSort = (maxCat?.m ?? -1) + 1;
        const catIdByKey = new Map([...catByKey.entries()].map(([k, c]) => [k, c.id]));
        for (const [key, name] of newCategories) {
          const [c] = await tx.insert(categories).values({ tenantId: t, name, sort: catSort++ }).returning({ id: categories.id });
          catIdByKey.set(key, c!.id);
        }
        const sortByCategory = new Map<string, number>();
        for (const p of prodRows) sortByCategory.set(p.categoryId, Math.max(sortByCategory.get(p.categoryId) ?? -1, p.sort));

        const out: MenuImportRow[] = [];
        for (const row of rows) {
          if (row.action === 'create') {
            const categoryId = catIdByKey.get(nameKey(row.category))!;
            const sort = (sortByCategory.get(categoryId) ?? -1) + 1;
            sortByCategory.set(categoryId, sort);
            const [p] = await tx
              .insert(products)
              .values({
                tenantId: t,
                categoryId,
                name: row.name,
                description: row.description,
                priceKurus: row.priceKurus ?? 0,
                waRestricted: row.restrictedSuggested ?? false,
                sort,
              })
              .returning({ id: products.id });
            out.push({ ...row, productId: p!.id });
          } else if (row.action === 'update' && row.productId) {
            await tx
              .update(products)
              .set({ priceKurus: row.priceKurus ?? 0, description: row.description, version: sql`${products.version} + 1` })
              .where(and(eq(products.id, row.productId), eq(products.tenantId, t)));
            out.push(row);
          } else {
            out.push(row);
          }
        }
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.csv_import',
          entityType: 'menu',
          data: { ...summary },
        });
        return out;
      });
      return { preview: false, rows: applied, summary };
    },
  );
};

export default menuToolsRoutes;
