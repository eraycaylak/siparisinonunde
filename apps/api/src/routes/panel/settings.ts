// Panel ayarlar (14 §6.3 Ayarlar) — dilim 4: tenant, şubeler, saatler, özel günler, duraklat/yoğun, bölgeler.
// Yetki (04 §2.3–§2.4): ayar yazma owner/manager; sipariş alma durumu (pause/busy) cashier dahil.

import type { TenantRole } from '@siparis/core';
import {
  branchListItemSchema,
  branchPatchSchema,
  branchSettingsSchema,
  branchStateSchema,
  busyRequestSchema,
  hoursPutSchema,
  openingHourDtoSchema,
  pauseRequestSchema,
  specialDayCreateSchema,
  specialDayDtoSchema,
  specialDayPatchSchema,
  tenantPatchSchema,
  tenantSettingsSchema,
  zoneCheckRequestSchema,
  zoneCheckResponseSchema,
  zoneCreateSchema,
  zoneDtoSchema,
  zonePatchSchema,
} from '@siparis/core/settings/contracts';
import { branches, specialDays } from '@siparis/db';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit, auditActor } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { assertBranchAccess, defaultBranchId, requireTenantRole, tenantAuth } from '../../plugins/auth';
import {
  computeBranchState,
  createSpecialDays,
  emitBranchState,
  findSpecialDay,
  loadBranchSettings,
  loadSpecialDays,
  lockBranch,
  patchBranch,
  pauseBranch,
  replaceHours,
  setBusy,
  toSpecialDayDto,
  updateSpecialDay,
} from '../../services/settings/branch';
import { loadTenant, patchTenant, toTenantSettings } from '../../services/settings/tenant';
import { checkZone, createZone, deleteZone, findZone, listZones, toZoneDto, updateZone } from '../../services/settings/zones';

const OM: readonly TenantRole[] = ['owner', 'manager'];
const OMC: readonly TenantRole[] = ['owner', 'manager', 'cashier'];

const idParams = z.object({ id: z.uuid() });
const dayParams = z.object({ id: z.uuid(), dayId: z.uuid() });
const okSchema = z.object({ ok: z.literal(true) });

const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ------------------------------------------------------------------ İşletme
  app.get('/tenant', { preValidation: requireTenantRole(OM), schema: { response: { 200: tenantSettingsSchema } } }, async (request) => {
    const auth = tenantAuth(request);
    const tenant = await loadTenant(app.db, auth.tenantId);
    const branchId = await defaultBranchId(app.db, auth.tenantId);
    const [b] = branchId ? await app.db.select({ addressLine: branches.addressLine }).from(branches).where(eq(branches.id, branchId)) : [];
    return toTenantSettings(tenant, b?.addressLine ?? null);
  });

  app.patch(
    '/tenant',
    { preValidation: requireTenantRole(OM), schema: { body: tenantPatchSchema, response: { 200: tenantSettingsSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const row = await app.db.transaction(async (tx) => {
        const { row, changed } = await patchTenant(tx, auth.tenantId, auth.role, request.body);
        if (Object.keys(changed).length) {
          await audit(tx, { ...auditActor(request), action: 'settings.tenant_update', entityType: 'tenant', entityId: auth.tenantId, data: { changed } });
        }
        return row;
      });
      const branchId = await defaultBranchId(app.db, auth.tenantId);
      const [b] = branchId ? await app.db.select({ addressLine: branches.addressLine }).from(branches).where(eq(branches.id, branchId)) : [];
      return toTenantSettings(row, b?.addressLine ?? null);
    },
  );

  // ------------------------------------------------------------------ Şubeler
  app.get(
    '/branches',
    { preValidation: requireTenantRole(OMC), schema: { response: { 200: z.object({ items: z.array(branchListItemSchema) }) } } },
    async (request) => {
      const auth = tenantAuth(request);
      const rows = await app.db.select().from(branches).where(eq(branches.tenantId, auth.tenantId)).orderBy(asc(branches.createdAt));
      const visible = auth.branchId ? rows.filter((r) => r.id === auth.branchId) : rows;
      const items = await Promise.all(
        visible.map(async (b) => ({ id: b.id, name: b.name, isDefault: b.isDefault, state: (await computeBranchState(app.db, b)).state })),
      );
      return { items };
    },
  );

  app.get(
    '/branches/:id',
    { preValidation: requireTenantRole(OMC), schema: { params: idParams, response: { 200: branchSettingsSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const branch = await assertBranchAccess(app.db, auth, request.params.id);
      return loadBranchSettings(app.db, branch);
    },
  );

  app.patch(
    '/branches/:id',
    { preValidation: requireTenantRole(OM), schema: { params: idParams, body: branchPatchSchema, response: { 200: branchSettingsSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      await assertBranchAccess(app.db, auth, request.params.id);
      const row = await app.db.transaction(async (tx) => {
        const current = await lockBranch(tx, auth.tenantId, request.params.id);
        const { row, changedKeys } = await patchBranch(tx, current, request.body);
        if (changedKeys.length) {
          await audit(tx, {
            ...auditActor(request),
            action: 'settings.branch_update',
            entityType: 'branch',
            entityId: row.id,
            data: { changed: changedKeys, body: request.body as Record<string, unknown> },
          });
        }
        return row;
      });
      return loadBranchSettings(app.db, row);
    },
  );

  app.put(
    '/branches/:id/hours',
    {
      preValidation: requireTenantRole(OM),
      schema: {
        params: idParams,
        body: hoursPutSchema,
        response: { 200: z.object({ hours: z.array(openingHourDtoSchema), state: branchStateSchema }) },
      },
    },
    async (request) => {
      const auth = tenantAuth(request);
      await assertBranchAccess(app.db, auth, request.params.id);
      return app.db.transaction(async (tx) => {
        const branch = await lockBranch(tx, auth.tenantId, request.params.id);
        const hours = await replaceHours(tx, branch, request.body);
        await audit(tx, { ...auditActor(request), action: 'settings.hours_update', entityType: 'branch', entityId: branch.id, data: { hours } });
        const state = await emitBranchState(tx, branch);
        return { hours, state };
      });
    },
  );

  // ------------------------------------------------------------------ Özel günler
  app.get(
    '/branches/:id/special-days',
    { preValidation: requireTenantRole(OM), schema: { params: idParams, response: { 200: z.object({ items: z.array(specialDayDtoSchema) }) } } },
    async (request) => {
      const auth = tenantAuth(request);
      const branch = await assertBranchAccess(app.db, auth, request.params.id);
      const rows = await loadSpecialDays(app.db, branch, new Date(), 0);
      return { items: rows.map(toSpecialDayDto) };
    },
  );

  app.post(
    '/branches/:id/special-days',
    {
      preValidation: requireTenantRole(OM),
      schema: { params: idParams, body: specialDayCreateSchema, response: { 201: z.object({ items: z.array(specialDayDtoSchema), state: branchStateSchema }) } },
    },
    async (request, reply) => {
      const auth = tenantAuth(request);
      await assertBranchAccess(app.db, auth, request.params.id);
      const result = await app.db.transaction(async (tx) => {
        const branch = await lockBranch(tx, auth.tenantId, request.params.id);
        const rows = await createSpecialDays(tx, branch, request.body);
        await audit(tx, {
          ...auditActor(request),
          action: 'settings.special_day_create',
          entityType: 'branch',
          entityId: branch.id,
          data: { dates: rows.map((r) => r.date), isClosed: request.body.isClosed, note: request.body.note ?? null },
        });
        const state = await emitBranchState(tx, branch);
        return { items: rows.map(toSpecialDayDto), state };
      });
      reply.status(201);
      return result;
    },
  );

  app.patch(
    '/branches/:id/special-days/:dayId',
    { preValidation: requireTenantRole(OM), schema: { params: dayParams, body: specialDayPatchSchema, response: { 200: specialDayDtoSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      await assertBranchAccess(app.db, auth, request.params.id);
      return app.db.transaction(async (tx) => {
        const branch = await lockBranch(tx, auth.tenantId, request.params.id);
        const day = await findSpecialDay(tx, branch, request.params.dayId);
        const row = await updateSpecialDay(tx, day, request.body);
        await audit(tx, { ...auditActor(request), action: 'settings.special_day_update', entityType: 'special_day', entityId: row.id, data: { date: row.date, body: request.body } });
        await emitBranchState(tx, branch);
        return toSpecialDayDto(row);
      });
    },
  );

  app.delete(
    '/branches/:id/special-days/:dayId',
    { preValidation: requireTenantRole(OM), schema: { params: dayParams, response: { 200: okSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      await assertBranchAccess(app.db, auth, request.params.id);
      await app.db.transaction(async (tx) => {
        const branch = await lockBranch(tx, auth.tenantId, request.params.id);
        const day = await findSpecialDay(tx, branch, request.params.dayId);
        await tx.delete(specialDays).where(eq(specialDays.id, day.id));
        await audit(tx, { ...auditActor(request), action: 'settings.special_day_delete', entityType: 'special_day', entityId: day.id, data: { date: day.date } });
        await emitBranchState(tx, branch);
      });
      return { ok: true as const };
    },
  );

  // ------------------------------------------------------------------ Sipariş alma durumu (04 §4.10)
  app.post(
    '/branches/:id/pause',
    { preValidation: requireTenantRole(OMC), schema: { params: idParams, body: pauseRequestSchema, response: { 200: branchStateSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      await assertBranchAccess(app.db, auth, request.params.id);
      return app.db.transaction(async (tx) => {
        const branch = await lockBranch(tx, auth.tenantId, request.params.id);
        const row = await pauseBranch(tx, branch, request.body.minutes, request.body.reason ?? null);
        await audit(tx, {
          ...auditActor(request),
          action: row.pausedUntil ? 'branch.pause' : 'branch.resume',
          entityType: 'branch',
          entityId: row.id,
          data: { minutes: request.body.minutes, pausedUntil: row.pausedUntil?.toISOString() ?? null, reason: request.body.reason ?? null },
        });
        return emitBranchState(tx, row);
      });
    },
  );

  app.post(
    '/branches/:id/busy',
    { preValidation: requireTenantRole(OMC), schema: { params: idParams, body: busyRequestSchema, response: { 200: branchStateSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      await assertBranchAccess(app.db, auth, request.params.id);
      return app.db.transaction(async (tx) => {
        const branch = await lockBranch(tx, auth.tenantId, request.params.id);
        const row = await setBusy(tx, branch, request.body.extraMinutes);
        await audit(tx, {
          ...auditActor(request),
          action: 'branch.busy',
          entityType: 'branch',
          entityId: row.id,
          data: { extraMinutes: request.body.extraMinutes, previous: branch.busyExtraMinutes },
        });
        return emitBranchState(tx, row);
      });
    },
  );

  // ------------------------------------------------------------------ Teslimat bölgeleri
  const resolveBranch = async (auth: ReturnType<typeof tenantAuth>, branchId?: string) => {
    const id = branchId ?? auth.branchId ?? (await defaultBranchId(app.db, auth.tenantId));
    if (!id) throw notFound('Şube bulunamadı.');
    return assertBranchAccess(app.db, auth, id);
  };

  app.get(
    '/zones',
    {
      preValidation: requireTenantRole(OMC),
      schema: { querystring: z.object({ branchId: z.uuid().optional() }), response: { 200: z.object({ items: z.array(zoneDtoSchema) }) } },
    },
    async (request) => {
      const auth = tenantAuth(request);
      const branch = await resolveBranch(auth, request.query.branchId);
      const rows = await listZones(app.db, auth.tenantId, branch.id);
      return { items: rows.map(toZoneDto) };
    },
  );

  app.post(
    '/zones',
    { preValidation: requireTenantRole(OM), schema: { body: zoneCreateSchema, response: { 201: zoneDtoSchema } } },
    async (request, reply) => {
      const auth = tenantAuth(request);
      const branch = await resolveBranch(auth, request.body.branchId);
      const row = await app.db.transaction(async (tx) => {
        const row = await createZone(tx, auth.tenantId, branch, request.body);
        await audit(tx, { ...auditActor(request), action: 'settings.zone_create', entityType: 'delivery_zone', entityId: row.id, data: { zone: toZoneDto(row) } });
        return row;
      });
      reply.status(201);
      return toZoneDto(row);
    },
  );

  app.patch(
    '/zones/:id',
    { preValidation: requireTenantRole(OM), schema: { params: idParams, body: zonePatchSchema, response: { 200: zoneDtoSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const zone = await findZone(app.db, auth.tenantId, request.params.id);
      const branch = await assertBranchAccess(app.db, auth, zone.branchId);
      const row = await app.db.transaction(async (tx) => {
        const row = await updateZone(tx, auth.tenantId, branch, zone, request.body);
        await audit(tx, { ...auditActor(request), action: 'settings.zone_update', entityType: 'delivery_zone', entityId: row.id, data: { body: request.body as Record<string, unknown> } });
        return row;
      });
      return toZoneDto(row);
    },
  );

  app.delete(
    '/zones/:id',
    { preValidation: requireTenantRole(OM), schema: { params: idParams, response: { 200: okSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const zone = await findZone(app.db, auth.tenantId, request.params.id);
      await assertBranchAccess(app.db, auth, zone.branchId);
      await app.db.transaction(async (tx) => {
        await deleteZone(tx, zone);
        await audit(tx, { ...auditActor(request), action: 'settings.zone_delete', entityType: 'delivery_zone', entityId: zone.id, data: { name: zone.name } });
      });
      return { ok: true as const };
    },
  );

  app.post(
    '/zones/check',
    { preValidation: requireTenantRole(OMC), schema: { body: zoneCheckRequestSchema, response: { 200: zoneCheckResponseSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const branch = await resolveBranch(auth, request.body.branchId);
      const zones = await listZones(app.db, auth.tenantId, branch.id);
      return { match: checkZone(zones, branch, request.body) };
    },
  );
};

export default settingsRoutes;
