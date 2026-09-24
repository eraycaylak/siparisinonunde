// Kimlik yanıtları için DTO üreticileri (core/contracts/auth şemalarıyla uyumlu).

import type { MembershipDto, MeResponse, TenantDto, UserDto } from '@siparis/core';
import { branches, memberships, tenants, users, type Database } from '@siparis/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { AuthContext } from '../../types';

type UserRow = typeof users.$inferSelect;
type TenantRow = typeof tenants.$inferSelect;

export function toUserDto(u: Pick<UserRow, 'id' | 'name' | 'email' | 'phone' | 'isPlatformAdmin' | 'platformRole'>): UserDto {
  return {
    id: u.id,
    name: u.name,
    email: u.email ?? null,
    phone: u.phone ?? null,
    isPlatformAdmin: u.isPlatformAdmin,
    platformRole: u.platformRole ?? null,
  };
}

export function toTenantDto(t: TenantRow, defaultBranchId: string | null): TenantDto {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    lifecycleStage: t.lifecycleStage,
    planCode: t.planCode,
    trialEndsAt: t.trialEndsAt ? t.trialEndsAt.toISOString() : null,
    orderingEnabled: t.orderingEnabled,
    brandColor: t.brandColor ?? null,
    logoUrl: t.logoUrl ?? null,
    defaultBranchId,
  };
}

/** Kullanıcının etkin üyelikleri (oluşturulma sırasıyla). */
export async function listMemberships(db: Database, userId: string): Promise<MembershipDto[]> {
  const rows = await db
    .select({
      tenantId: memberships.tenantId,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      role: memberships.role,
      branchId: memberships.branchId,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), isNull(memberships.disabledAt)))
    .orderBy(asc(memberships.createdAt));
  return rows;
}

export async function loadTenantDto(db: Database, tenantId: string): Promise<TenantDto | null> {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) return null;
  const [b] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.tenantId, tenantId))
    .orderBy(asc(branches.createdAt))
    .limit(1);
  return toTenantDto(t, b?.id ?? null);
}

export async function buildMe(db: Database, auth: AuthContext): Promise<MeResponse> {
  const tenant = auth.tenantId ? await loadTenantDto(db, auth.tenantId) : null;
  return {
    user: toUserDto(auth.user),
    tenant,
    role: tenant ? auth.role : null,
    branchId: tenant ? auth.branchId : null,
    memberships: await listMemberships(db, auth.user.id),
    isPlatformAdmin: auth.isPlatformAdmin,
    readOnly: auth.readOnly,
    impersonating:
      auth.session.kind === 'impersonation' && auth.session.impersonatorUserId && auth.tenantId
        ? {
            tenantId: auth.tenantId,
            impersonatorUserId: auth.session.impersonatorUserId,
            expiresAt: auth.session.expiresAt.toISOString(),
          }
        : null,
  };
}
