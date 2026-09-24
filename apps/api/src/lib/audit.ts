// Denetim kaydı (her yazma işleminde; 14 §10).

import { auditLog, type Database } from '@siparis/db';
import type { FastifyRequest } from 'fastify';

export interface AuditEntry {
  tenantId?: string | null;
  actorUserId?: string | null;
  impersonatorUserId?: string | null;
  /** ör. 'menu.product_update', 'order.cancel', 'tenant.signup' */
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  data?: Record<string, unknown> | null;
  ip?: string | null;
}

export async function audit(tx: Database, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: entry.tenantId ?? null,
    actorUserId: entry.actorUserId ?? null,
    impersonatorUserId: entry.impersonatorUserId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    data: entry.data ?? null,
    ip: entry.ip ?? null,
  });
}

/** İstekten aktör alanları: `audit(tx, { ...auditActor(request), action, entityType, entityId, data })`. */
export function auditActor(request: FastifyRequest): Pick<AuditEntry, 'tenantId' | 'actorUserId' | 'impersonatorUserId' | 'ip'> {
  const a = request.auth;
  return {
    tenantId: a?.tenantId ?? null,
    actorUserId: a?.user.id ?? null,
    impersonatorUserId: a?.session.impersonatorUserId ?? null,
    ip: request.ip ?? null,
  };
}
