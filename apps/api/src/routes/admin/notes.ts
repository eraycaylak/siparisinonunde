// Destek notları ve etiketleri (05 A-10): CRUD /admin/tenants/:id/notes. Etiketler 05 A-10 sözlüğünden.

import {
  adminNoteCreateSchema,
  adminNoteSchema,
  adminNotesResponseSchema,
  adminNoteUpdateSchema,
} from '@siparis/core/admin/contracts';
import { adminCan } from '@siparis/core/admin/permissions';
import { okResponseSchema } from '@siparis/core';
import { adminNotes, tenants, type Database } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors';
import { loadNotes } from '../../services/admin/tenants';
import { adminActor, adminAudit, iso, requireAdmin, type AdminActor } from '../../services/admin/util';

const tenantParams = z.object({ id: z.uuid() });
const noteParams = z.object({ id: z.uuid(), noteId: z.uuid() });

async function assertTenant(db: Database, tenantId: string) {
  const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw notFound('İşletme bulunamadı.');
}

/** Not bu işletmeye ait mi ve aktör düzenleyebilir mi (yazar ya da PO/PA). */
async function editableNote(db: Database, actor: AdminActor, tenantId: string, noteId: string) {
  const [note] = await db
    .select()
    .from(adminNotes)
    .where(and(eq(adminNotes.id, noteId), eq(adminNotes.tenantId, tenantId)));
  if (!note) throw notFound('Not bulunamadı.');
  if (note.authorUserId !== actor.userId && !adminCan(actor.role, 'notes:manage_any')) {
    throw forbidden('Yalnız kendi notunuzu değiştirebilirsiniz.');
  }
  return note;
}

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/tenants/:id/notes',
    { preHandler: requireAdmin('tenants:read'), schema: { params: tenantParams, response: { 200: adminNotesResponseSchema } } },
    async (request) => {
      await assertTenant(app.db, request.params.id);
      return { items: await loadNotes(app.db, request.params.id) };
    },
  );

  app.post(
    '/tenants/:id/notes',
    {
      preHandler: requireAdmin('notes:write'),
      schema: { params: tenantParams, body: adminNoteCreateSchema, response: { 201: adminNoteSchema } },
    },
    async (request, reply) => {
      const actor = adminActor(request);
      const tenantId = request.params.id;
      await assertTenant(app.db, tenantId);
      const tags = Array.from(new Set(request.body.tags));
      const note = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(adminNotes)
          .values({ tenantId, authorUserId: actor.userId, body: request.body.body, tags })
          .returning();
        await adminAudit(tx, actor, {
          tenantId,
          action: 'admin.note_create',
          entityType: 'admin_note',
          entityId: row!.id,
          data: { tags },
        });
        return row!;
      });
      reply.status(201);
      return {
        id: note.id,
        tenantId: note.tenantId,
        body: note.body,
        tags: note.tags,
        authorUserId: note.authorUserId ?? null,
        authorName: actor.name,
        createdAt: iso(note.createdAt),
      };
    },
  );

  app.patch(
    '/tenants/:id/notes/:noteId',
    {
      preHandler: requireAdmin('notes:write'),
      schema: { params: noteParams, body: adminNoteUpdateSchema, response: { 200: adminNoteSchema } },
    },
    async (request) => {
      const actor = adminActor(request);
      const { id: tenantId, noteId } = request.params;
      const before = await editableNote(app.db, actor, tenantId, noteId);
      const patch: Partial<typeof adminNotes.$inferInsert> = {};
      if (request.body.body !== undefined) patch.body = request.body.body;
      if (request.body.tags !== undefined) patch.tags = Array.from(new Set(request.body.tags));
      await app.db.transaction(async (tx) => {
        await tx.update(adminNotes).set(patch).where(eq(adminNotes.id, noteId));
        await adminAudit(tx, actor, {
          tenantId,
          action: 'admin.note_update',
          entityType: 'admin_note',
          entityId: noteId,
          data: { tagsBefore: before.tags, tagsAfter: patch.tags ?? before.tags, bodyChanged: patch.body !== undefined },
        });
      });
      const [note] = (await loadNotes(app.db, tenantId)).filter((n) => n.id === noteId);
      if (!note) throw notFound('Not bulunamadı.');
      return note;
    },
  );

  app.delete(
    '/tenants/:id/notes/:noteId',
    { preHandler: requireAdmin('notes:write'), schema: { params: noteParams, response: { 200: okResponseSchema } } },
    async (request) => {
      const actor = adminActor(request);
      const { id: tenantId, noteId } = request.params;
      const before = await editableNote(app.db, actor, tenantId, noteId);
      await app.db.transaction(async (tx) => {
        await tx.delete(adminNotes).where(eq(adminNotes.id, noteId));
        await adminAudit(tx, actor, {
          tenantId,
          action: 'admin.note_delete',
          entityType: 'admin_note',
          entityId: noteId,
          data: { tags: before.tags, authorUserId: before.authorUserId },
        });
      });
      return { ok: true as const };
    },
  );
};

export default routes;
