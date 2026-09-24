// request.auth çözümü ve yetki yardımcıları (14 §5).

import type { PlatformRole, TenantRole } from '@siparis/core';
import { branches, type Database } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { AppError, forbidden, notFound, unauthorized } from '../lib/errors';
import { resolveSession, SESSION_COOKIE } from '../services/auth/sessions';
import type { AuthContext } from '../types';

/** Kök düzeyde onRequest: `sid` çerezinden oturum çözer. */
export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (request) => {
    const token = request.cookies?.[SESSION_COOKIE];
    request.auth = token ? await resolveSession(app.db, token) : null;
  });
});

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Salt-okunur oturumda (impersonation) yazma → 403 read_only_session. */
export function assertWritable(request: FastifyRequest): void {
  if (request.auth?.readOnly && !SAFE_METHODS.has(request.method)) {
    throw new AppError(403, 'read_only_session', 'Salt-okunur oturumda değişiklik yapılamaz.');
  }
}

export function requireAuth(): preHandlerAsyncHookHandler {
  return async function requireAuthHook(request: FastifyRequest, _reply: FastifyReply) {
    if (!request.auth) throw unauthorized();
  };
}

export interface TenantRoleOptions {
  /** true: salt-okunur oturumda da yazmaya izin (nadiren; ör. çıkış). */
  allowReadOnly?: boolean;
}

/**
 * Panel rotaları: oturum + seçili tenant + rol. Rol listesi boşsa tüm tenant rolleri.
 * Yazma metotlarında salt-okunur oturum reddedilir.
 */
export function requireTenantRole(roles?: readonly TenantRole[], opts: TenantRoleOptions = {}): preHandlerAsyncHookHandler {
  return async function requireTenantRoleHook(request: FastifyRequest, _reply: FastifyReply) {
    const auth = request.auth;
    if (!auth) throw unauthorized();
    if (!auth.tenantId || !auth.role) throw forbidden('Önce bir işletme seçin.', 'tenant_required');
    if (roles && roles.length && !roles.includes(auth.role)) throw forbidden();
    if (!opts.allowReadOnly) assertWritable(request);
  };
}

/** Admin rotaları: platform yöneticisi (+ opsiyonel platform rolü). platform_owner her şeye erişir. */
export function requirePlatform(roles?: readonly PlatformRole[]): preHandlerAsyncHookHandler {
  return async function requirePlatformHook(request: FastifyRequest, _reply: FastifyReply) {
    const auth = request.auth;
    if (!auth) throw unauthorized();
    if (!auth.isPlatformAdmin) throw forbidden();
    if (auth.session.kind === 'impersonation') throw forbidden('Destek görünümündeyken admin işlemi yapılamaz.');
    const role = auth.user.platformRole;
    if (roles && roles.length && role !== 'platform_owner' && (!role || !roles.includes(role))) throw forbidden();
    assertWritable(request);
  };
}

export interface TenantAuth extends AuthContext {
  tenantId: string;
  role: TenantRole;
  userId: string;
}

/** requireTenantRole sonrası tipli erişim. */
export function tenantAuth(request: FastifyRequest): TenantAuth {
  const a = request.auth;
  if (!a) throw unauthorized();
  if (!a.tenantId || !a.role) throw forbidden('Önce bir işletme seçin.', 'tenant_required');
  return { ...a, tenantId: a.tenantId, role: a.role, userId: a.user.id };
}

/**
 * Şube bu tenant'a ait mi ve üyelik şube kısıtına uyuyor mu. Değilse 404 (başka tenant'ın kaydı görünmez).
 * Şube satırını döner.
 */
export async function assertBranchAccess(db: Database, auth: TenantAuth, branchId: string) {
  const [branch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.tenantId, auth.tenantId)));
  if (!branch) throw notFound('Şube bulunamadı.');
  if (auth.branchId && auth.branchId !== branchId) throw notFound('Şube bulunamadı.');
  return branch;
}

/** Tenant'ın varsayılan (ilk) şubesi. */
export async function defaultBranchId(db: Database, tenantId: string): Promise<string | null> {
  const [b] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.tenantId, tenantId))
    .orderBy(branches.createdAt)
    .limit(1);
  return b?.id ?? null;
}
