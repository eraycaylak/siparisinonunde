// Destek erişimi (impersonation) istek kaydı (05 A-09 "Her istek audit_log'a yazılır").
//
// Kök düzeyde onResponse kancası: `kind = 'impersonation'` oturumuyla gelen her panel isteği
// (method, path, status) `admin.impersonation_request` olarak audit_log'a yazılır. Aynı oturumda aynı
// method + yol + durum 10 sn içinde tekrarlanırsa yeni satır açılmaz; ilk satırın sayacı artar
// (panel yoklamaları kaydı şişirmesin). Sorgu dizesi yazılmaz (arama metni kişisel veri içerebilir);
// yalnız anahtar adları tutulur. Kayıt hatası isteği etkilemez (loglanır).

import { auditLog } from '@siparis/db';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

export const IMPERSONATION_REQUEST_ACTION = 'admin.impersonation_request';
/** Aynı istek tekrarlarının tek satırda birleştirildiği pencere. */
export const IMPERSONATION_MERGE_WINDOW_MS = 10_000;
/** Kayda giren yollar (panel API'si). */
const AUDITED_PREFIXES = ['/api/v1/panel/'];

function splitUrl(url: string): { path: string; queryKeys: string[] } {
  const q = url.indexOf('?');
  if (q < 0) return { path: url, queryKeys: [] };
  const keys = [...new URLSearchParams(url.slice(q + 1)).keys()];
  return { path: url.slice(0, q), queryKeys: [...new Set(keys)].sort() };
}

export async function recordImpersonationRequest(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = request.auth;
  if (!auth || auth.session.kind !== 'impersonation') return;
  const { path, queryKeys } = splitUrl(request.url);
  if (!AUDITED_PREFIXES.some((p) => path.startsWith(p))) return;

  const method = request.method;
  const status = reply.statusCode;
  const sessionId = auth.session.id;
  const tenantId = auth.session.tenantId ?? auth.tenantId ?? null;
  const now = new Date();
  const since = new Date(now.getTime() - IMPERSONATION_MERGE_WINDOW_MS);

  await app.db.transaction(async (tx) => {
    // Aynı oturum + istek için süreçler arası yarışı önle (kısa, tx sonunda serbest kalır)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`imp:${sessionId}:${method}:${path}:${status}`}))`);
    const [prev] = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          tenantId ? eq(auditLog.tenantId, tenantId) : sql`${auditLog.tenantId} is null`,
          eq(auditLog.action, IMPERSONATION_REQUEST_ACTION),
          eq(auditLog.entityId, sessionId),
          gt(auditLog.createdAt, since),
          sql`${auditLog.data}->>'method' = ${method}`,
          sql`${auditLog.data}->>'path' = ${path}`,
          sql`(${auditLog.data}->>'status')::int = ${status}`,
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(1);

    if (prev) {
      await tx
        .update(auditLog)
        .set({
          data: sql`${auditLog.data} || jsonb_build_object('count', coalesce((${auditLog.data}->>'count')::int, 1) + 1, 'lastAt', ${now.toISOString()}::text)`,
        })
        .where(eq(auditLog.id, prev.id));
      return;
    }
    await tx.insert(auditLog).values({
      tenantId,
      actorUserId: auth.user.id,
      impersonatorUserId: auth.session.impersonatorUserId ?? auth.user.id,
      action: IMPERSONATION_REQUEST_ACTION,
      entityType: 'session',
      entityId: sessionId,
      data: {
        method,
        path,
        route: request.routeOptions?.url ?? null,
        status,
        ...(queryKeys.length ? { queryKeys } : {}),
        readOnly: auth.session.readOnly,
        count: 1,
        firstAt: now.toISOString(),
        lastAt: now.toISOString(),
      },
      ip: request.ip ?? null,
    });
  });
}

export const impersonationAuditPlugin = fp(async (app: FastifyInstance) => {
  app.addHook('onResponse', async (request, reply) => {
    if (request.auth?.session.kind !== 'impersonation') return;
    try {
      await recordImpersonationRequest(app, request, reply);
    } catch (err) {
      request.log.error({ err }, 'impersonation audit yazılamadı');
    }
  });
});
