// İşletme bilgileri ve künye (04 §7.2, P-26): GET/PATCH /panel/tenant.

import { isValidSlug, normalizePhone, RESERVED_SLUGS, SLUG_PATTERN, type TenantRole } from '@siparis/core';
import type { TenantPatch, TenantSettings } from '@siparis/core/settings/contracts';
import { tenants, type Database } from '@siparis/db';
import { and, eq, ne } from 'drizzle-orm';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { isoOrNull, isUniqueViolation, validationError } from './common';

export type TenantRow = typeof tenants.$inferSelect;

/** Künye (6563 m.3; 08 §4.7) eksik alanları: storefront yayını için gerekli. */
export function imprintMissing(t: Pick<TenantRow, 'name' | 'legalName' | 'taxNo' | 'phone' | 'address'>, branchAddress?: string | null): string[] {
  const missing: string[] = [];
  if (!t.legalName) missing.push('Unvan ya da ad-soyad');
  if (!t.taxNo) missing.push('VKN/TCKN');
  if (!t.phone) missing.push('Telefon');
  if (!t.address && !branchAddress) missing.push('Adres');
  return missing;
}

export function toTenantSettings(t: TenantRow, branchAddress?: string | null): TenantSettings {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    legalName: t.legalName ?? null,
    taxNo: t.taxNo ?? null,
    taxOffice: t.taxOffice ?? null,
    phone: t.phone ?? null,
    email: t.email ?? null,
    address: t.address ?? null,
    brandColor: t.brandColor ?? null,
    logoUrl: t.logoUrl ?? null,
    coverUrl: t.coverUrl ?? null,
    marketplaceCommissionBp: t.marketplaceCommissionBp,
    lifecycleStage: t.lifecycleStage,
    planCode: t.planCode,
    trialEndsAt: isoOrNull(t.trialEndsAt),
    liveAt: isoOrNull(t.liveAt),
    webLiveAt: isoOrNull(t.webLiveAt),
    orderingEnabled: t.orderingEnabled,
    imprintMissing: imprintMissing(t, branchAddress),
  };
}

export async function loadTenant(db: Database, tenantId: string): Promise<TenantRow> {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw notFound('İşletme bulunamadı.');
  return t;
}

/** Slug kuralı: biçim + ayrılmış adlar (core). Hata metni Türkçe. */
export function slugProblem(slug: string): string | null {
  if (!SLUG_PATTERN.test(slug)) return 'Adres yalnız küçük harf, rakam ve tire içerebilir (3–40 karakter, tire ile başlayamaz/bitemez).';
  if (RESERVED_SLUGS.has(slug) || !isValidSlug(slug)) return 'Bu adres ayrılmış, başka bir adres seçin.';
  return null;
}

export interface TenantPatchResult {
  row: TenantRow;
  changed: Record<string, { from: unknown; to: unknown }>;
}

/** PATCH /panel/tenant — değişen alanları yazar (çağıran transaction'ında) ve farkı döner. */
export async function patchTenant(tx: Database, tenantId: string, role: TenantRole, body: TenantPatch): Promise<TenantPatchResult> {
  const [current] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update');
  if (!current) throw notFound('İşletme bulunamadı.');
  const patch: Partial<typeof tenants.$inferInsert> = {};

  if (body.name !== undefined) patch.name = body.name;
  if (body.phone !== undefined) {
    if (body.phone === null || body.phone === '') patch.phone = null;
    else {
      const p = normalizePhone(body.phone);
      if (!p) throw validationError('Geçerli bir telefon numarası girin.', 'phone');
      patch.phone = p;
    }
  }
  if (body.email !== undefined) patch.email = body.email ? body.email.toLowerCase() : null;
  if (body.legalName !== undefined) patch.legalName = body.legalName;
  if (body.taxNo !== undefined) patch.taxNo = body.taxNo;
  if (body.taxOffice !== undefined) patch.taxOffice = body.taxOffice;
  if (body.address !== undefined) patch.address = body.address;
  if (body.brandColor !== undefined) patch.brandColor = body.brandColor ? body.brandColor.toUpperCase() : null;
  if (body.logoUrl !== undefined) patch.logoUrl = body.logoUrl;
  if (body.coverUrl !== undefined) patch.coverUrl = body.coverUrl;
  if (body.marketplaceCommissionBp !== undefined) patch.marketplaceCommissionBp = body.marketplaceCommissionBp;

  if (body.slug !== undefined && body.slug !== current.slug) {
    if (role !== 'owner') throw forbidden('Mağaza adresini yalnız işletme sahibi değiştirebilir.');
    const problem = slugProblem(body.slug);
    if (problem) throw validationError(problem, 'slug');
    const [hit] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.slug, body.slug), ne(tenants.id, tenantId)));
    if (hit) throw conflict('slug_taken', 'Bu adres başka bir işletme tarafından kullanılıyor.', { issues: [{ path: 'slug', message: 'Bu adres kullanılıyor.' }] });
    patch.slug = body.slug;
  }

  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(patch)) {
    const before = (current as Record<string, unknown>)[k];
    if (before !== v) changed[k] = { from: before ?? null, to: v ?? null };
  }
  if (Object.keys(changed).length === 0) return { row: current, changed };

  try {
    const [row] = await tx
      .update(tenants)
      .set({ ...patch, version: current.version + 1 })
      .where(eq(tenants.id, tenantId))
      .returning();
    return { row: row!, changed };
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('slug_taken', 'Bu adres başka bir işletme tarafından kullanılıyor.');
    throw err;
  }
}
