// Admin yardımcıları: tarih biçimi, imleç (cursor), ham SQL satırları, maskeleme, yetki ve denetim.

import { ADMIN_PERMISSIONS, type AdminPermission } from '@siparis/core/admin/permissions';
import { maskPhone, type PlatformRole } from '@siparis/core';
import { auditLog, type Database } from '@siparis/db';
import { and, eq, gt, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { audit } from '../../lib/audit';
import { badRequest, unauthorized } from '../../lib/errors';
import { requirePlatform } from '../../plugins/auth';

/** Date | Postgres metni → ISO 8601. */
export function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function isoOrNull(value: Date | string | null | undefined): string | null {
  return value == null ? null : iso(value);
}

/** Ham sorgu satırları (postgres-js; sayılar ::int ile dönmeli). */
export async function rows<T>(db: Database, query: SQL): Promise<T[]> {
  const res = await db.execute(query);
  return [...(res as unknown as T[])];
}

// ---------------------------------------------------------------------------
// İmleç: base64url("<iso zaman>|<uuid>") — (zaman desc, id desc) sıralı listeler için.

export interface Cursor {
  at: string;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(at: Date | string, id: string): string {
  return Buffer.from(`${iso(at)}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  let raw: string;
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw badRequest('Geçersiz sayfa imleci.', undefined, 'invalid_cursor');
  }
  const [at, id] = raw.split('|');
  if (!at || !id || Number.isNaN(Date.parse(at)) || !UUID_RE.test(id)) {
    throw badRequest('Geçersiz sayfa imleci.', undefined, 'invalid_cursor');
  }
  return { at: new Date(at).toISOString(), id };
}

/**
 * İmleç koşulu ve sıralaması. Zaman milisaniyeye kesilir: JS Date ms hassasiyetindedir, Postgres µs;
 * aynı transaction'daki satırlar aynı zamanı paylaşır — eşitlikte id belirler.
 */
export function cursorWhere(at: AnyColumn | SQL, id: AnyColumn | SQL, cursor: Cursor): SQL {
  return sql`(date_trunc('milliseconds', ${at}), ${id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
}

export function cursorOrder(at: AnyColumn | SQL, id: AnyColumn | SQL): SQL[] {
  return [sql`date_trunc('milliseconds', ${at}) desc`, sql`${id} desc`];
}

/** limit+1 satır çekildiyse sonraki imleci üretir ve fazlayı atar. */
export function paginate<T>(list: T[], limit: number, key: (item: T) => { at: Date | string; id: string }) {
  const hasMore = list.length > limit;
  const items = hasMore ? list.slice(0, limit) : list;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(key(last).at, key(last).id) : undefined;
  return nextCursor ? { items, nextCursor } : { items };
}

// ---------------------------------------------------------------------------
// Maskeleme (05 A-11 "maskeli yük"; 00 §12 loglarda telefon maskeli)

const PHONE_KEYS = /phone|^to$|msisdn|wa_id|bsuid/i;
const ADDRESS_KEYS = /address|directions|^lat$|^lng$|location/i;
const SECRET_KEYS = /token|secret|password|api_?key|code_hash|^code$/i;
const PHONE_IN_TEXT = /(\+?90\s?)?0?5\d{2}\s?\d{3}\s?\d{2}\s?\d{2}/g;

export function maskPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => maskPayload(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.test(k)) out[k] = '[gizli]';
      else if (PHONE_KEYS.test(k) && typeof v === 'string') out[k] = maskPhone(v);
      else if (ADDRESS_KEYS.test(k) && v != null) out[k] = '[maskeli]';
      else out[k] = maskPayload(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.replace(PHONE_IN_TEXT, (m) => maskPhone(m));
  return value;
}

// ---------------------------------------------------------------------------
// Yetki ve denetim

/** Platform oturumu + 05 §A.3 matrisi (platform_owner her şeyi geçer). */
export function requireAdmin(permission?: AdminPermission): preHandlerAsyncHookHandler {
  return requirePlatform(permission ? ADMIN_PERMISSIONS[permission] : undefined);
}

export interface AdminActor {
  userId: string;
  name: string;
  role: PlatformRole | null;
  ip: string | null;
}

export function adminActor(request: FastifyRequest): AdminActor {
  const a = request.auth;
  if (!a) throw unauthorized();
  return { userId: a.user.id, name: a.user.name, role: a.user.platformRole, ip: request.ip ?? null };
}

/** Admin yazması denetim kaydı (aynı transaction; 05 §A.1 #6). */
export async function adminAudit(
  tx: Database,
  actor: AdminActor,
  entry: {
    tenantId?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    data?: Record<string, unknown>;
    impersonatorUserId?: string | null;
  },
): Promise<void> {
  await audit(tx, {
    tenantId: entry.tenantId ?? null,
    actorUserId: actor.userId,
    impersonatorUserId: entry.impersonatorUserId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    data: { ...(entry.data ?? {}), actorRole: actor.role },
    ip: actor.ip,
  });
}

/** Hassas okuma kaydı (05 §A.1 #6): aynı aktör + işletme + aksiyon için 10 dk'da bir yazılır (yenilemeler kaydı şişirmesin). */
export async function auditSensitiveRead(db: Database, actor: AdminActor, tenantId: string, action: string): Promise<void> {
  const since = new Date(Date.now() - 10 * 60_000);
  const [recent] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, action), eq(auditLog.actorUserId, actor.userId), gt(auditLog.createdAt, since)))
    .limit(1);
  if (recent) return;
  await adminAudit(db, actor, { tenantId, action, entityType: 'tenant', entityId: tenantId });
}
