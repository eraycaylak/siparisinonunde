// Panel menü (14 §6.3 Menü) — dilim 1.
//   GET    /panel/menu                          tam ağaç (kategoriler, ürünler, seçenek grupları, bağlar)
//   POST   /panel/categories · PATCH/DELETE /panel/categories/:id
//   POST   /panel/products · PATCH/DELETE /panel/products/:id · PUT /panel/products/:id/option-groups
//   POST   /panel/products/:id/sold-out {until:'end_of_day'|null}   (cashier/kitchen da kullanır)
//   POST   /panel/option-groups · PATCH/DELETE /panel/option-groups/:id · POST /panel/option-groups/:id/options
//   PATCH/DELETE /panel/options/:id
//   POST   /panel/menu/reorder
//   + menu-tools.ts: bulk-price, uploads, CSV içe/dışa aktarma
// Roller (04 §2.3–2.4): owner/manager yazar; cashier/kitchen okur + tükendi. Mutfak fiyat görmez.
// Her yazma audit'e gider; her sorgu tenant kapsamlıdır (başka tenant'ın kaydı 404).

import { endOfLocalDay, okResponseSchema } from '@siparis/core';
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  optionCreateSchema,
  optionGroupCreateSchema,
  optionGroupUpdateSchema,
  optionUpdateSchema,
  panelCategorySchema,
  panelMenuResponseSchema,
  panelOptionGroupSchema,
  panelOptionSchema,
  panelProductSchema,
  productCreateSchema,
  productOptionGroupsSchema,
  productUpdateSchema,
  reorderRequestSchema,
  soldOutRequestSchema,
  soldOutResponseSchema,
} from '@siparis/core/menu/contracts';
import { categories, optionGroups, options, productOptionGroups, products, type Database } from '@siparis/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit, auditActor } from '../../lib/audit';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { requireTenantRole, tenantAuth } from '../../plugins/auth';
import { loadOptionGroupDto, loadPanelMenu, productGroupIds, toPanelProduct } from '../../services/menu/tree';
import { MENU_EDIT_ROLES, MENU_READ_ROLES, menuEditGuard } from './menu-guards';
import menuToolsRoutes from './menu-tools';

const idParams = z.object({ id: z.uuid() });

const categoryNotFound = () => notFound('Kategori bulunamadı.');
const productNotFound = () => notFound('Ürün bulunamadı.');
const groupNotFound = () => notFound('Seçenek grubu bulunamadı.');
const optionNotFound = () => notFound('Seçenek bulunamadı.');

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids.map((i) => i.toLowerCase()))];
}

async function findCategory(db: Database, tenantId: string, id: string) {
  const [c] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.tenantId, tenantId), isNull(categories.deletedAt)));
  return c ?? null;
}

async function findProduct(db: Database, tenantId: string, id: string) {
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.tenantId, tenantId), isNull(products.deletedAt)));
  return p ?? null;
}

async function findGroup(db: Database, tenantId: string, id: string) {
  const [g] = await db
    .select()
    .from(optionGroups)
    .where(and(eq(optionGroups.id, id), eq(optionGroups.tenantId, tenantId), isNull(optionGroups.deletedAt)));
  return g ?? null;
}

/** Grup kimliklerinin tamamı bu tenant'a ait ve silinmemiş mi; değilse 404. Sırayı korur, tekrarı atar. */
async function assertGroups(db: Database, tenantId: string, ids: readonly string[]): Promise<string[]> {
  const list = unique(ids);
  if (!list.length) return list;
  const rows = await db
    .select({ id: optionGroups.id })
    .from(optionGroups)
    .where(and(eq(optionGroups.tenantId, tenantId), inArray(optionGroups.id, list), isNull(optionGroups.deletedAt)));
  if (rows.length !== list.length) throw groupNotFound();
  return list;
}

async function replaceProductGroups(tx: Database, tenantId: string, productId: string, groupIds: readonly string[]) {
  await tx.delete(productOptionGroups).where(and(eq(productOptionGroups.tenantId, tenantId), eq(productOptionGroups.productId, productId)));
  if (groupIds.length) {
    await tx.insert(productOptionGroups).values(groupIds.map((groupId, sort) => ({ tenantId, productId, groupId, sort })));
  }
}

async function nextCategorySort(tx: Database, tenantId: string): Promise<number> {
  const [r] = await tx
    .select({ m: sql<number | null>`max(${categories.sort})` })
    .from(categories)
    .where(and(eq(categories.tenantId, tenantId), isNull(categories.deletedAt)));
  return (r?.m ?? -1) + 1;
}

async function nextProductSort(tx: Database, tenantId: string, categoryId: string): Promise<number> {
  const [r] = await tx
    .select({ m: sql<number | null>`max(${products.sort})` })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.categoryId, categoryId), isNull(products.deletedAt)));
  return (r?.m ?? -1) + 1;
}

async function categoryProductCount(db: Database, tenantId: string, categoryId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.categoryId, categoryId), isNull(products.deletedAt)));
  return r?.n ?? 0;
}

/** Aktif seçenek sayısı zorunlu grubun en az seçimini karşılamalı (04 §6.3). */
function assertGroupSatisfiable(minSelect: number, maxSelect: number | null, activeCount: number) {
  if (maxSelect !== null && minSelect > maxSelect) {
    throw badRequest('En az seçim, en çok seçimden büyük olamaz.', undefined, 'option_group_invalid');
  }
  if (minSelect > 0 && activeCount < minSelect) {
    throw badRequest(`Zorunlu grupta en az ${minSelect} aktif seçenek olmalı.`, undefined, 'option_group_invalid');
  }
}

const menuRoutes: FastifyPluginAsyncZod = async (app) => {
  const editGuard = menuEditGuard(app.db);

  // --- Menü ağacı ---------------------------------------------------------------------------------
  app.get(
    '/menu',
    { preHandler: requireTenantRole(MENU_READ_ROLES), schema: { response: { 200: panelMenuResponseSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      return loadPanelMenu(app.db, auth.tenantId, {
        showPrices: auth.role !== 'kitchen',
        canEdit: MENU_EDIT_ROLES.includes(auth.role) && !auth.readOnly,
      });
    },
  );

  // --- Kategoriler --------------------------------------------------------------------------------
  app.post(
    '/categories',
    { preHandler: editGuard, schema: { body: categoryCreateSchema, response: { 201: panelCategorySchema } } },
    async (request, reply) => {
      const auth = tenantAuth(request);
      const body = request.body;
      const row = await app.db.transaction(async (tx) => {
        const sort = await nextCategorySort(tx, auth.tenantId);
        const [c] = await tx
          .insert(categories)
          .values({ tenantId: auth.tenantId, name: body.name, isActive: body.isActive ?? true, sort })
          .returning();
        await audit(tx, { ...auditActor(request), action: 'menu.category_create', entityType: 'category', entityId: c!.id, data: { name: body.name } });
        return c!;
      });
      reply.status(201);
      return { id: row.id, name: row.name, sort: row.sort, isActive: row.isActive, productCount: 0 };
    },
  );

  app.patch(
    '/categories/:id',
    { preHandler: editGuard, schema: { params: idParams, body: categoryUpdateSchema, response: { 200: panelCategorySchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const existing = await findCategory(app.db, auth.tenantId, request.params.id);
      if (!existing) throw categoryNotFound();
      const body = request.body;
      const row = await app.db.transaction(async (tx) => {
        const [c] = await tx
          .update(categories)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
            version: sql`${categories.version} + 1`,
          })
          .where(and(eq(categories.id, existing.id), eq(categories.tenantId, auth.tenantId)))
          .returning();
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.category_update',
          entityType: 'category',
          entityId: existing.id,
          data: { from: { name: existing.name, isActive: existing.isActive }, to: body },
        });
        return c!;
      });
      return {
        id: row.id,
        name: row.name,
        sort: row.sort,
        isActive: row.isActive,
        productCount: await categoryProductCount(app.db, auth.tenantId, row.id),
      };
    },
  );

  app.delete(
    '/categories/:id',
    { preHandler: editGuard, schema: { params: idParams, response: { 200: okResponseSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const existing = await findCategory(app.db, auth.tenantId, request.params.id);
      if (!existing) throw categoryNotFound();
      const count = await categoryProductCount(app.db, auth.tenantId, existing.id);
      if (count > 0) {
        throw conflict(
          'category_not_empty',
          `Bu kategoride ${count} ürün var. Önce ürünleri başka kategoriye taşıyın ya da silin.`,
          { productCount: count },
        );
      }
      await app.db.transaction(async (tx) => {
        await tx
          .update(categories)
          .set({ deletedAt: new Date(), isActive: false })
          .where(and(eq(categories.id, existing.id), eq(categories.tenantId, auth.tenantId)));
        await audit(tx, { ...auditActor(request), action: 'menu.category_delete', entityType: 'category', entityId: existing.id, data: { name: existing.name } });
      });
      return { ok: true as const };
    },
  );

  // --- Ürünler ------------------------------------------------------------------------------------
  app.post(
    '/products',
    { preHandler: editGuard, schema: { body: productCreateSchema, response: { 201: panelProductSchema } } },
    async (request, reply) => {
      const auth = tenantAuth(request);
      const body = request.body;
      const category = await findCategory(app.db, auth.tenantId, body.categoryId);
      if (!category) throw categoryNotFound();
      const groupIds = await assertGroups(app.db, auth.tenantId, body.optionGroupIds ?? []);
      const row = await app.db.transaction(async (tx) => {
        const sort = await nextProductSort(tx, auth.tenantId, category.id);
        const [p] = await tx
          .insert(products)
          .values({
            tenantId: auth.tenantId,
            categoryId: category.id,
            name: body.name,
            description: body.description ?? null,
            priceKurus: body.priceKurus,
            imageUrl: body.imageUrl ?? null,
            isActive: body.isActive ?? true,
            waRestricted: body.waRestricted ?? false,
            sort,
          })
          .returning();
        await replaceProductGroups(tx, auth.tenantId, p!.id, groupIds);
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.product_create',
          entityType: 'product',
          entityId: p!.id,
          data: { name: p!.name, categoryId: category.id, priceKurus: p!.priceKurus, waRestricted: p!.waRestricted, optionGroupIds: groupIds },
        });
        return p!;
      });
      reply.status(201);
      return toPanelProduct(row, groupIds, new Date());
    },
  );

  app.patch(
    '/products/:id',
    { preHandler: editGuard, schema: { params: idParams, body: productUpdateSchema, response: { 200: panelProductSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const existing = await findProduct(app.db, auth.tenantId, request.params.id);
      if (!existing) throw productNotFound();
      const body = request.body;
      let categoryId = existing.categoryId;
      if (body.categoryId && body.categoryId !== existing.categoryId) {
        const category = await findCategory(app.db, auth.tenantId, body.categoryId);
        if (!category) throw categoryNotFound();
        categoryId = category.id;
      }
      const groupIds = body.optionGroupIds ? await assertGroups(app.db, auth.tenantId, body.optionGroupIds) : null;

      const row = await app.db.transaction(async (tx) => {
        const sort = categoryId !== existing.categoryId ? await nextProductSort(tx, auth.tenantId, categoryId) : existing.sort;
        const [p] = await tx
          .update(products)
          .set({
            categoryId,
            sort,
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.priceKurus !== undefined ? { priceKurus: body.priceKurus } : {}),
            ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
            ...(body.waRestricted !== undefined ? { waRestricted: body.waRestricted } : {}),
            version: sql`${products.version} + 1`,
          })
          .where(and(eq(products.id, existing.id), eq(products.tenantId, auth.tenantId)))
          .returning();
        if (groupIds) await replaceProductGroups(tx, auth.tenantId, existing.id, groupIds);

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const track = (key: string, from: unknown, to: unknown) => {
          if (to !== undefined && from !== to) changes[key] = { from, to };
        };
        track('name', existing.name, body.name);
        track('description', existing.description, body.description);
        track('priceKurus', existing.priceKurus, body.priceKurus);
        track('categoryId', existing.categoryId, body.categoryId);
        track('imageUrl', existing.imageUrl, body.imageUrl);
        track('isActive', existing.isActive, body.isActive);
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.product_update',
          entityType: 'product',
          entityId: existing.id,
          data: { changes, ...(groupIds ? { optionGroupIds: groupIds } : {}) },
        });
        if (body.waRestricted !== undefined && body.waRestricted !== existing.waRestricted) {
          // "WhatsApp'ta satılamaz" bayrağı değişimi ayrıca kayda geçer (04 §6.8)
          await audit(tx, {
            ...auditActor(request),
            action: 'menu.product_restriction_change',
            entityType: 'product',
            entityId: existing.id,
            data: { from: existing.waRestricted, to: body.waRestricted, reason: body.waRestrictedReason ?? null },
          });
        }
        return p!;
      });
      return toPanelProduct(row, groupIds ?? (await productGroupIds(app.db, auth.tenantId, row.id)), new Date());
    },
  );

  app.delete(
    '/products/:id',
    { preHandler: editGuard, schema: { params: idParams, response: { 200: okResponseSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const existing = await findProduct(app.db, auth.tenantId, request.params.id);
      if (!existing) throw productNotFound();
      await app.db.transaction(async (tx) => {
        await tx
          .update(products)
          .set({ deletedAt: new Date(), isActive: false, version: sql`${products.version} + 1` })
          .where(and(eq(products.id, existing.id), eq(products.tenantId, auth.tenantId)));
        await audit(tx, { ...auditActor(request), action: 'menu.product_delete', entityType: 'product', entityId: existing.id, data: { name: existing.name } });
      });
      return { ok: true as const };
    },
  );

  app.put(
    '/products/:id/option-groups',
    { preHandler: editGuard, schema: { params: idParams, body: productOptionGroupsSchema, response: { 200: panelProductSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const existing = await findProduct(app.db, auth.tenantId, request.params.id);
      if (!existing) throw productNotFound();
      const groupIds = await assertGroups(app.db, auth.tenantId, request.body.groupIds);
      await app.db.transaction(async (tx) => {
        await replaceProductGroups(tx, auth.tenantId, existing.id, groupIds);
        await tx
          .update(products)
          .set({ version: sql`${products.version} + 1` })
          .where(and(eq(products.id, existing.id), eq(products.tenantId, auth.tenantId)));
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.product_option_groups',
          entityType: 'product',
          entityId: existing.id,
          data: { optionGroupIds: groupIds },
        });
      });
      return toPanelProduct({ ...existing, version: existing.version + 1 }, groupIds, new Date());
    },
  );

  // "Bugün tükendi" — kasiyer ve mutfak da kullanır (04 §6.4). Abonelik kilidinden muaf (operasyonel).
  app.post(
    '/products/:id/sold-out',
    {
      preHandler: requireTenantRole(MENU_READ_ROLES),
      schema: { params: idParams, body: soldOutRequestSchema, response: { 200: soldOutResponseSchema } },
    },
    async (request) => {
      const auth = tenantAuth(request);
      const existing = await findProduct(app.db, auth.tenantId, request.params.id);
      if (!existing) throw productNotFound();
      const now = new Date();
      const until = request.body.until === 'end_of_day' ? endOfLocalDay(now) : null;
      await app.db.transaction(async (tx) => {
        await tx
          .update(products)
          .set({ soldOutUntil: until, version: sql`${products.version} + 1` })
          .where(and(eq(products.id, existing.id), eq(products.tenantId, auth.tenantId)));
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.product_sold_out',
          entityType: 'product',
          entityId: existing.id,
          data: { name: existing.name, until: until?.toISOString() ?? null },
        });
      });
      return { id: existing.id, soldOut: until !== null && until > now, soldOutUntil: until?.toISOString() ?? null };
    },
  );

  // --- Seçenek grupları ---------------------------------------------------------------------------
  app.post(
    '/option-groups',
    { preHandler: editGuard, schema: { body: optionGroupCreateSchema, response: { 201: panelOptionGroupSchema } } },
    async (request, reply) => {
      const auth = tenantAuth(request);
      const body = request.body;
      const opts = body.options ?? [];
      if (body.options) assertGroupSatisfiable(body.minSelect, body.maxSelect, opts.filter((o) => o.isActive !== false).length);
      const groupId = await app.db.transaction(async (tx) => {
        const [r] = await tx
          .select({ m: sql<number | null>`max(${optionGroups.sort})` })
          .from(optionGroups)
          .where(and(eq(optionGroups.tenantId, auth.tenantId), isNull(optionGroups.deletedAt)));
        const [g] = await tx
          .insert(optionGroups)
          .values({
            tenantId: auth.tenantId,
            name: body.name,
            internalName: body.internalName ?? null,
            minSelect: body.minSelect,
            maxSelect: body.maxSelect,
            sort: (r?.m ?? -1) + 1,
          })
          .returning();
        if (opts.length) {
          await tx.insert(options).values(
            opts.map((o, sort) => ({
              tenantId: auth.tenantId,
              groupId: g!.id,
              name: o.name,
              priceDeltaKurus: o.priceDeltaKurus,
              isActive: o.isActive ?? true,
              sort,
            })),
          );
        }
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.option_group_create',
          entityType: 'option_group',
          entityId: g!.id,
          data: { name: body.name, minSelect: body.minSelect, maxSelect: body.maxSelect, optionCount: opts.length },
        });
        return g!.id;
      });
      reply.status(201);
      return (await loadOptionGroupDto(app.db, auth.tenantId, groupId))!;
    },
  );

  app.patch(
    '/option-groups/:id',
    { preHandler: editGuard, schema: { params: idParams, body: optionGroupUpdateSchema, response: { 200: panelOptionGroupSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const group = await findGroup(app.db, auth.tenantId, request.params.id);
      if (!group) throw groupNotFound();
      const body = request.body;
      const minSelect = body.minSelect ?? group.minSelect;
      const maxSelect = body.maxSelect !== undefined ? body.maxSelect : group.maxSelect;
      const existingOptions = await app.db
        .select()
        .from(options)
        .where(and(eq(options.tenantId, auth.tenantId), eq(options.groupId, group.id), isNull(options.deletedAt)));
      const existingIds = new Set(existingOptions.map((o) => o.id));
      if (body.options) {
        for (const o of body.options) if (o.id && !existingIds.has(o.id.toLowerCase())) throw optionNotFound();
      }
      if (body.options || body.minSelect !== undefined || body.maxSelect !== undefined) {
        const activeCount = body.options
          ? body.options.filter((o) => o.isActive !== false).length
          : existingOptions.filter((o) => o.isActive).length;
        assertGroupSatisfiable(minSelect, maxSelect, activeCount);
      }

      await app.db.transaction(async (tx) => {
        await tx
          .update(optionGroups)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.internalName !== undefined ? { internalName: body.internalName } : {}),
            minSelect,
            maxSelect,
            version: sql`${optionGroups.version} + 1`,
          })
          .where(and(eq(optionGroups.id, group.id), eq(optionGroups.tenantId, auth.tenantId)));
        if (body.options) {
          const keep = new Set<string>();
          for (const [sort, o] of body.options.entries()) {
            if (o.id) {
              keep.add(o.id.toLowerCase());
              await tx
                .update(options)
                .set({ name: o.name, priceDeltaKurus: o.priceDeltaKurus ?? 0, isActive: o.isActive ?? true, sort })
                .where(and(eq(options.id, o.id), eq(options.tenantId, auth.tenantId), eq(options.groupId, group.id)));
            } else {
              await tx.insert(options).values({
                tenantId: auth.tenantId,
                groupId: group.id,
                name: o.name,
                priceDeltaKurus: o.priceDeltaKurus ?? 0,
                isActive: o.isActive ?? true,
                sort,
              });
            }
          }
          const removed = existingOptions.filter((o) => !keep.has(o.id)).map((o) => o.id);
          if (removed.length) {
            await tx
              .update(options)
              .set({ deletedAt: new Date(), isActive: false })
              .where(and(eq(options.tenantId, auth.tenantId), inArray(options.id, removed)));
          }
        }
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.option_group_update',
          entityType: 'option_group',
          entityId: group.id,
          data: {
            from: { name: group.name, minSelect: group.minSelect, maxSelect: group.maxSelect },
            to: { name: body.name, minSelect: body.minSelect, maxSelect: body.maxSelect },
            ...(body.options ? { options: body.options.map((o) => ({ id: o.id ?? null, name: o.name, priceDeltaKurus: o.priceDeltaKurus, isActive: o.isActive ?? true })) } : {}),
          },
        });
      });
      return (await loadOptionGroupDto(app.db, auth.tenantId, group.id))!;
    },
  );

  app.delete(
    '/option-groups/:id',
    { preHandler: editGuard, schema: { params: idParams, response: { 200: okResponseSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const group = await findGroup(app.db, auth.tenantId, request.params.id);
      if (!group) throw groupNotFound();
      await app.db.transaction(async (tx) => {
        const removedLinks = await tx
          .delete(productOptionGroups)
          .where(and(eq(productOptionGroups.tenantId, auth.tenantId), eq(productOptionGroups.groupId, group.id)))
          .returning({ productId: productOptionGroups.productId });
        await tx
          .update(optionGroups)
          .set({ deletedAt: new Date(), version: sql`${optionGroups.version} + 1` })
          .where(and(eq(optionGroups.id, group.id), eq(optionGroups.tenantId, auth.tenantId)));
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.option_group_delete',
          entityType: 'option_group',
          entityId: group.id,
          data: { name: group.name, unlinkedProducts: removedLinks.length },
        });
      });
      return { ok: true as const };
    },
  );

  app.post(
    '/option-groups/:id/options',
    { preHandler: editGuard, schema: { params: idParams, body: optionCreateSchema, response: { 201: panelOptionSchema } } },
    async (request, reply) => {
      const auth = tenantAuth(request);
      const group = await findGroup(app.db, auth.tenantId, request.params.id);
      if (!group) throw groupNotFound();
      const body = request.body;
      const row = await app.db.transaction(async (tx) => {
        const [r] = await tx
          .select({ m: sql<number | null>`max(${options.sort})` })
          .from(options)
          .where(and(eq(options.tenantId, auth.tenantId), eq(options.groupId, group.id), isNull(options.deletedAt)));
        const [o] = await tx
          .insert(options)
          .values({
            tenantId: auth.tenantId,
            groupId: group.id,
            name: body.name,
            priceDeltaKurus: body.priceDeltaKurus,
            isActive: body.isActive ?? true,
            sort: (r?.m ?? -1) + 1,
          })
          .returning();
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.option_create',
          entityType: 'option',
          entityId: o!.id,
          data: { groupId: group.id, name: body.name, priceDeltaKurus: body.priceDeltaKurus },
        });
        return o!;
      });
      reply.status(201);
      return { id: row.id, groupId: row.groupId, name: row.name, priceDeltaKurus: row.priceDeltaKurus, isActive: row.isActive, sort: row.sort };
    },
  );

  async function findOption(db: Database, tenantId: string, id: string) {
    const [o] = await db
      .select({ option: options })
      .from(options)
      .innerJoin(optionGroups, eq(optionGroups.id, options.groupId))
      .where(and(eq(options.id, id), eq(options.tenantId, tenantId), isNull(options.deletedAt), isNull(optionGroups.deletedAt)));
    return o?.option ?? null;
  }

  app.patch(
    '/options/:id',
    { preHandler: editGuard, schema: { params: idParams, body: optionUpdateSchema, response: { 200: panelOptionSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const existing = await findOption(app.db, auth.tenantId, request.params.id);
      if (!existing) throw optionNotFound();
      const body = request.body;
      const row = await app.db.transaction(async (tx) => {
        const [o] = await tx
          .update(options)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.priceDeltaKurus !== undefined ? { priceDeltaKurus: body.priceDeltaKurus } : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          })
          .where(and(eq(options.id, existing.id), eq(options.tenantId, auth.tenantId)))
          .returning();
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.option_update',
          entityType: 'option',
          entityId: existing.id,
          data: { from: { name: existing.name, priceDeltaKurus: existing.priceDeltaKurus, isActive: existing.isActive }, to: body },
        });
        return o!;
      });
      return { id: row.id, groupId: row.groupId, name: row.name, priceDeltaKurus: row.priceDeltaKurus, isActive: row.isActive, sort: row.sort };
    },
  );

  app.delete(
    '/options/:id',
    { preHandler: editGuard, schema: { params: idParams, response: { 200: okResponseSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const existing = await findOption(app.db, auth.tenantId, request.params.id);
      if (!existing) throw optionNotFound();
      await app.db.transaction(async (tx) => {
        await tx
          .update(options)
          .set({ deletedAt: new Date(), isActive: false })
          .where(and(eq(options.id, existing.id), eq(options.tenantId, auth.tenantId)));
        await audit(tx, { ...auditActor(request), action: 'menu.option_delete', entityType: 'option', entityId: existing.id, data: { name: existing.name } });
      });
      return { ok: true as const };
    },
  );

  // --- Sıralama -----------------------------------------------------------------------------------
  app.post(
    '/menu/reorder',
    { preHandler: editGuard, schema: { body: reorderRequestSchema, response: { 200: okResponseSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const body = request.body;
      const t = auth.tenantId;

      const catIds = body.categories ? unique(body.categories) : null;
      if (catIds?.length) {
        const rows = await app.db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.tenantId, t), inArray(categories.id, catIds), isNull(categories.deletedAt)));
        if (rows.length !== catIds.length) throw categoryNotFound();
      }
      const prod = body.products ? { categoryId: body.products.categoryId, ids: unique(body.products.ids) } : null;
      if (prod) {
        if (!(await findCategory(app.db, t, prod.categoryId))) throw categoryNotFound();
        if (prod.ids.length) {
          const rows = await app.db
            .select({ id: products.id })
            .from(products)
            .where(and(eq(products.tenantId, t), eq(products.categoryId, prod.categoryId), inArray(products.id, prod.ids), isNull(products.deletedAt)));
          if (rows.length !== prod.ids.length) throw productNotFound();
        }
      }
      const groupIds = body.optionGroups ? await assertGroups(app.db, t, body.optionGroups) : null;

      await app.db.transaction(async (tx) => {
        for (const [sort, id] of (catIds ?? []).entries()) {
          await tx.update(categories).set({ sort }).where(and(eq(categories.id, id), eq(categories.tenantId, t)));
        }
        for (const [sort, id] of (prod?.ids ?? []).entries()) {
          await tx.update(products).set({ sort }).where(and(eq(products.id, id), eq(products.tenantId, t)));
        }
        for (const [sort, id] of (groupIds ?? []).entries()) {
          await tx.update(optionGroups).set({ sort }).where(and(eq(optionGroups.id, id), eq(optionGroups.tenantId, t)));
        }
        await audit(tx, {
          ...auditActor(request),
          action: 'menu.reorder',
          entityType: 'menu',
          data: { categories: catIds, products: prod, optionGroups: groupIds },
        });
      });
      return { ok: true as const };
    },
  );

  // Toplu fiyat, görsel yükleme, CSV (ayrı eklenti; multipart yalnız orada kayıtlı)
  await app.register(menuToolsRoutes);
};

export default menuRoutes;
