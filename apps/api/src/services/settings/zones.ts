// Teslimat bölgeleri (04 §7.5, P-17): mahalle listesi / poligon / yarıçap. PostGIS yok (00 §12a).

import { neighborhoodKey, resolveZone, type GeoJsonPolygon } from '@siparis/core';
import type { ZoneCreate, ZoneDto, ZonePatch } from '@siparis/core/settings/contracts';
import {
  ZONE_RADIUS_LIMITS,
  cleanNeighborhoodName,
  validateNeighborhoods,
  validatePolygon,
  type ValidationIssue,
} from '@siparis/core/settings/validation';
import { branches, deliveryZones, type Database } from '@siparis/db';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { notFound } from '../../lib/errors';
import { assertNoIssues, validationError } from './common';

export type ZoneRow = typeof deliveryZones.$inferSelect;
type BranchRow = typeof branches.$inferSelect;

export function toZoneDto(z: ZoneRow): ZoneDto {
  return {
    id: z.id,
    branchId: z.branchId,
    name: z.name,
    kind: z.kind,
    neighborhoods: z.neighborhoods ?? [],
    polygon: z.kind === 'polygon' && z.polygon ? { type: 'Polygon', coordinates: z.polygon.coordinates } : null,
    radiusM: z.radiusM ?? null,
    feeKurus: z.feeKurus,
    minOrderKurus: z.minOrderKurus,
    etaMinutes: z.etaMinutes,
    isActive: z.isActive,
    sort: z.sort,
  };
}

export async function listZones(db: Database, tenantId: string, branchId?: string): Promise<ZoneRow[]> {
  const conds = [eq(deliveryZones.tenantId, tenantId), isNull(deliveryZones.deletedAt)];
  if (branchId) conds.push(eq(deliveryZones.branchId, branchId));
  return db
    .select()
    .from(deliveryZones)
    .where(and(...conds))
    .orderBy(asc(deliveryZones.sort), asc(deliveryZones.createdAt));
}

export async function findZone(db: Database, tenantId: string, id: string): Promise<ZoneRow> {
  const [z] = await db
    .select()
    .from(deliveryZones)
    .where(and(eq(deliveryZones.id, id), eq(deliveryZones.tenantId, tenantId), isNull(deliveryZones.deletedAt)));
  if (!z) throw notFound('Bölge bulunamadı.');
  return z;
}

/** Tenant'ın diğer (silinmemiş) bölgelerindeki mahalle anahtarları → bölge adı. */
async function takenNeighborhoods(db: Database, tenantId: string, exceptZoneId?: string): Promise<Map<string, string>> {
  const conds = [eq(deliveryZones.tenantId, tenantId), isNull(deliveryZones.deletedAt), eq(deliveryZones.kind, 'neighborhoods')];
  if (exceptZoneId) conds.push(ne(deliveryZones.id, exceptZoneId));
  const rows = await db.select({ name: deliveryZones.name, neighborhoods: deliveryZones.neighborhoods }).from(deliveryZones).where(and(...conds));
  const map = new Map<string, string>();
  for (const r of rows) for (const n of r.neighborhoods ?? []) map.set(neighborhoodKey(n), r.name);
  return map;
}

interface ZoneShape {
  kind: ZoneRow['kind'];
  neighborhoods: string[];
  polygon: GeoJsonPolygon | null;
  radiusM: number | null;
}

/** Türe göre geometri kuralları; kind dışındaki geometri alanları temizlenir. */
async function normalizeShape(db: Database, tenantId: string, branch: BranchRow, shape: ZoneShape, exceptZoneId?: string): Promise<ZoneShape> {
  const issues: ValidationIssue[] = [];
  if (shape.kind === 'neighborhoods') {
    const cleaned = shape.neighborhoods.map(cleanNeighborhoodName).filter(Boolean);
    issues.push(...validateNeighborhoods(cleaned, await takenNeighborhoods(db, tenantId, exceptZoneId)));
    assertNoIssues(issues);
    return { kind: 'neighborhoods', neighborhoods: cleaned, polygon: null, radiusM: null };
  }
  if (shape.kind === 'polygon') {
    const problem = validatePolygon(shape.polygon);
    if (problem) throw validationError(problem, 'polygon');
    return { kind: 'polygon', neighborhoods: [], polygon: shape.polygon, radiusM: null };
  }
  const r = shape.radiusM;
  if (r == null || !Number.isInteger(r) || r < ZONE_RADIUS_LIMITS.min || r > ZONE_RADIUS_LIMITS.max) {
    throw validationError(`Yarıçap ${ZONE_RADIUS_LIMITS.min} m ile ${ZONE_RADIUS_LIMITS.max / 1000} km arasında olmalı.`, 'radiusM');
  }
  if (branch.lat == null || branch.lng == null) {
    throw validationError('Yarıçaplı bölge için önce şube konumunu haritadan seçin.', 'radiusM');
  }
  return { kind: 'radius', neighborhoods: [], polygon: null, radiusM: r };
}

export async function createZone(tx: Database, tenantId: string, branch: BranchRow, body: ZoneCreate): Promise<ZoneRow> {
  const shape = await normalizeShape(tx, tenantId, branch, {
    kind: body.kind,
    neighborhoods: body.neighborhoods ?? [],
    polygon: (body.polygon as GeoJsonPolygon | null | undefined) ?? null,
    radiusM: body.radiusM ?? null,
  });
  let sort = body.sort;
  if (sort === undefined) {
    const existing = await listZones(tx, tenantId, branch.id);
    sort = existing.reduce((m, z) => Math.max(m, z.sort + 1), 0);
  }
  const [row] = await tx
    .insert(deliveryZones)
    .values({
      tenantId,
      branchId: branch.id,
      name: body.name,
      kind: shape.kind,
      neighborhoods: shape.neighborhoods,
      polygon: shape.polygon,
      radiusM: shape.radiusM,
      feeKurus: body.feeKurus,
      minOrderKurus: body.minOrderKurus,
      etaMinutes: body.etaMinutes,
      isActive: body.isActive ?? true,
      sort,
    })
    .returning();
  return row!;
}

export async function updateZone(tx: Database, tenantId: string, branch: BranchRow, zone: ZoneRow, body: ZonePatch): Promise<ZoneRow> {
  const geometryTouched = body.kind !== undefined || body.neighborhoods !== undefined || body.polygon !== undefined || body.radiusM !== undefined;
  const patch: Partial<typeof deliveryZones.$inferInsert> = {};
  if (geometryTouched) {
    const shape = await normalizeShape(
      tx,
      tenantId,
      branch,
      {
        kind: body.kind ?? zone.kind,
        neighborhoods: body.neighborhoods ?? zone.neighborhoods ?? [],
        polygon: body.polygon !== undefined ? ((body.polygon as GeoJsonPolygon | null) ?? null) : (zone.polygon ?? null),
        radiusM: body.radiusM !== undefined ? body.radiusM : (zone.radiusM ?? null),
      },
      zone.id,
    );
    Object.assign(patch, shape);
  }
  for (const k of ['name', 'feeKurus', 'minOrderKurus', 'etaMinutes', 'isActive', 'sort'] as const) {
    if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k];
  }
  if (Object.keys(patch).length === 0) return zone;
  const [row] = await tx
    .update(deliveryZones)
    .set({ ...patch, version: zone.version + 1 })
    .where(eq(deliveryZones.id, zone.id))
    .returning();
  return row!;
}

export async function deleteZone(tx: Database, zone: ZoneRow): Promise<void> {
  await tx.update(deliveryZones).set({ deletedAt: new Date(), isActive: false, version: zone.version + 1 }).where(eq(deliveryZones.id, zone.id));
}

/** "Bu adrese teslimat var mı?" (04 §7.5) — core resolveZone. */
export function checkZone(zones: ZoneRow[], branch: BranchRow, q: { neighborhood?: string; lat?: number; lng?: number }) {
  const center = branch.lat != null && branch.lng != null ? { lat: branch.lat, lng: branch.lng } : null;
  const m = resolveZone(
    zones.map((z) => ({ ...z, neighborhoods: z.neighborhoods ?? [], polygon: z.polygon ?? null })),
    { neighborhood: q.neighborhood ?? null, lat: q.lat ?? null, lng: q.lng ?? null },
    { center },
  );
  if (!m) return null;
  return {
    zoneId: m.zone.id,
    zoneName: m.zone.name,
    neighborhood: m.neighborhood,
    via: m.via,
    distanceM: m.distanceM ?? null,
    feeKurus: m.zone.feeKurus,
    minOrderKurus: m.zone.minOrderKurus,
    etaMinutes: m.zone.etaMinutes,
  };
}
