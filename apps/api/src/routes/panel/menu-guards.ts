// Panel menü rotalarının ortak yetki yardımcıları (04 §2.3–2.4):
// owner/manager menüyü düzenler; cashier/kitchen yalnız okur ve "tükendi" aç/kapar.
// Abonelik salt-okunur/askıda ise menü düzenleme kapalıdır (05 dunning: G+10 salt-okunur); "tükendi" operasyoneldir, açık kalır.

import type { LifecycleStage, TenantRole } from '@siparis/core';
import { tenants, type Database } from '@siparis/db';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../../lib/errors';
import { requireTenantRole, tenantAuth } from '../../plugins/auth';

export const MENU_EDIT_ROLES: readonly TenantRole[] = ['owner', 'manager'];
export const MENU_READ_ROLES: readonly TenantRole[] = ['owner', 'manager', 'cashier', 'kitchen'];

const LOCKED_STAGES: readonly LifecycleStage[] = ['read_only', 'suspended', 'churned'];

/** Tenant aboneliği menü düzenlemeye kapalıysa 403 tenant_read_only. */
export function tenantMenuWritable(db: Database): preHandlerAsyncHookHandler {
  return async function tenantMenuWritableHook(request: FastifyRequest, _reply: FastifyReply) {
    const auth = tenantAuth(request);
    const [t] = await db.select({ stage: tenants.lifecycleStage }).from(tenants).where(eq(tenants.id, auth.tenantId));
    if (t && LOCKED_STAGES.includes(t.stage)) {
      throw new AppError(
        403,
        'tenant_read_only',
        'Aboneliğiniz şu an salt-okunur durumda; menü düzenlenemez. Ödeme alındığında düzenleme yeniden açılır.',
      );
    }
  };
}

/** Menü düzenleme: owner/manager + yazılabilir oturum + yazılabilir abonelik. */
export function menuEditGuard(db: Database): preHandlerAsyncHookHandler[] {
  return [requireTenantRole(MENU_EDIT_ROLES), tenantMenuWritable(db)];
}
