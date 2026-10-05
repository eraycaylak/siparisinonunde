// Destek erişimi (00 §4, 05 A-09): salt-okunur, en fazla 30 dk, gerekçe zorunlu, işletmeye bildirim, audit.
// Çerez stratejisi: services/admin/impersonation.ts başındaki açıklama.
// İşletmeye bildirim: başlangıç ve bitiş kaydı services/admin/support-access.ts ile yazılır; işletme kendi
// oturumuyla GET /admin/support-access/notices'ten okur (denetim: yazılan satır hiçbir yerden okunmuyordu).

import {
  adminImpersonateRequestSchema,
  adminImpersonateResponseSchema,
  adminImpersonationEndResponseSchema,
} from '@siparis/core/admin/contracts';
import { supportAccessNoticesResponseSchema } from '@siparis/core/admin/support-access';
import { memberships, sessions, tenants, users, type Database } from '@siparis/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { notFound, unauthorized } from '../../lib/errors';
import { requireTenantRole, tenantAuth } from '../../plugins/auth';
import { sha256Hex } from '../../lib/tokens';
import { ADMIN_STASH_COOKIE, clearAdminStashCookie, setAdminStashCookie } from '../../services/admin/impersonation';
import { loadSupportAccessNotices, supportAccessNotice } from '../../services/admin/support-access';
import { adminActor, adminAudit, requireAdmin } from '../../services/admin/util';
import {
  SESSION_COOKIE,
  SESSION_TTL,
  clearSessionCookie,
  createSession,
  resolveSession,
  setSessionCookie,
} from '../../services/auth/sessions';

/** İşletmenin etkin sahipleri (bildirim alıcıları). */
async function ownerIds(tx: Database, tenantId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'owner'), isNull(memberships.disabledAt)));
  return rows.map((r) => r.userId);
}

/**
 * Destek erişimi kapanış kaydı. Destek görevlisinin adı oturumu açan kullanıcıdan okunur: `end` çağrısı destek
 * oturumundan gelebilir ve o oturumun `auth.user.name`'i aynı kişi olsa da, admin oturumundan toplu kapatmada
 * başka tenant'ların kaydı da yazılır — ad tek yerden, `impersonator_user_id`den gelsin.
 */
async function writeEndNotice(
  tx: Database,
  tenantId: string,
  impersonatorUserId: string,
  sessionId: string,
  endedBy: 'support_session' | 'admin_session',
): Promise<void> {
  const [agent] = await tx.select({ name: users.name }).from(users).where(eq(users.id, impersonatorUserId));
  await supportAccessNotice(tx, {
    tenantId,
    kind: 'ended',
    recipientUserIds: await ownerIds(tx, tenantId),
    supportAgentName: agent?.name ?? 'Destek ekibi',
    data: { sessionId, endedBy },
  });
}

const routes: FastifyPluginAsyncZod = async (app) => {
  // POST /admin/tenants/:id/impersonate {reason, ticketRef?}
  app.post(
    '/tenants/:id/impersonate',
    {
      preHandler: requireAdmin('impersonation:start'),
      schema: {
        params: z.object({ id: z.uuid() }),
        body: adminImpersonateRequestSchema,
        response: { 200: adminImpersonateResponseSchema },
      },
    },
    async (request, reply) => {
      const actor = adminActor(request);
      const adminToken = request.cookies[SESSION_COOKIE];
      if (!adminToken || !request.auth) throw unauthorized();
      const adminSession = request.auth.session;
      const tenantId = request.params.id;
      const { reason, ticketRef } = request.body;

      const [tenant] = await app.db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
      if (!tenant) throw notFound('İşletme bulunamadı.');

      const owners = await ownerIds(app.db, tenantId);

      // Oturum, işletme bildirimi ve audit aynı transaction'da: bildirim ya da audit yazılamazsa oturum başlamaz.
      const { token, session } = await app.db.transaction(async (tx) => {
        const created = await createSession(tx, {
          userId: actor.userId,
          kind: 'impersonation',
          tenantId,
          ttlMs: SESSION_TTL.impersonation,
          ip: actor.ip,
          userAgent: request.headers['user-agent'] ?? null,
          readOnly: true,
          impersonatorUserId: actor.userId,
          impersonationReason: reason,
        });
        const now = new Date();
        // İşletmeye görünen kayıt (panelde kırmızı bant + "Destek erişimi" listesi; services/admin/support-access.ts)
        await supportAccessNotice(tx, {
          tenantId,
          kind: 'started',
          recipientUserIds: owners,
          supportAgentName: actor.name,
          data: {
            sessionId: created.session.id,
            startedAt: now.toISOString(),
            expiresAt: created.session.expiresAt.toISOString(),
            readOnly: true,
          },
          now,
        });
        await adminAudit(tx, actor, {
          tenantId,
          action: 'admin.impersonation_start',
          entityType: 'session',
          entityId: created.session.id,
          impersonatorUserId: actor.userId,
          data: { reason, ticketRef: ticketRef ?? null, readOnly: true, expiresAt: created.session.expiresAt.toISOString() },
        });
        return created;
      });

      // `sid` → destek oturumu; admin oturumu `sid_admin`da saklanır (yalnız end yoluna gönderilir)
      setSessionCookie(reply, app.config, token, session.expiresAt);
      setAdminStashCookie(reply, app.config, adminToken, adminSession.expiresAt);
      return {
        ok: true as const,
        sessionId: session.id,
        tenantId,
        readOnly: true as const,
        expiresAt: session.expiresAt.toISOString(),
        redirectTo: '/panel',
      };
    },
  );

  // POST /admin/impersonation/end — destek oturumunu kapatır ve admin oturumunu geri yükler.
  // Çağıran: destek oturumu (panel bandı), admin oturumu (kendi açık destek oturumlarını kapatır) ya da
  // süresi dolmuş destek oturumundan dönen admin (yalnız `sid_admin` çerezi).
  app.post('/impersonation/end', { schema: { response: { 200: adminImpersonationEndResponseSchema } } }, async (request, reply) => {
    const auth = request.auth;
    const stash = request.cookies[ADMIN_STASH_COOKIE];
    const isImpersonation = auth?.session.kind === 'impersonation';
    const isAdminSession = Boolean(auth?.isPlatformAdmin && auth.session.kind === 'user');
    if (!isImpersonation && !isAdminSession && !stash) throw unauthorized();

    let ended = 0;
    let impersonatorId: string | null = null;
    await app.db.transaction(async (tx) => {
      if (auth && isImpersonation) {
        impersonatorId = auth.session.impersonatorUserId ?? auth.user.id;
        const deleted = await tx.delete(sessions).where(eq(sessions.id, auth.session.id)).returning({ id: sessions.id });
        ended = deleted.length;
        await audit(tx, {
          tenantId: auth.session.tenantId,
          actorUserId: impersonatorId,
          impersonatorUserId: impersonatorId,
          action: 'admin.impersonation_end',
          entityType: 'session',
          entityId: auth.session.id,
          data: { actorRole: auth.user.platformRole, endedBy: 'support_session' },
          ip: request.ip ?? null,
        });
        // Kapanış kaydı işletmeye de yazılır (başlangıç kaydının karşılığı)
        if (deleted.length && auth.session.tenantId) {
          await writeEndNotice(tx, auth.session.tenantId, impersonatorId, auth.session.id, 'support_session');
        }
      } else if (auth && isAdminSession) {
        const deleted = await tx
          .delete(sessions)
          .where(and(eq(sessions.kind, 'impersonation'), eq(sessions.impersonatorUserId, auth.user.id), gt(sessions.expiresAt, new Date())))
          .returning({ id: sessions.id, tenantId: sessions.tenantId });
        ended = deleted.length;
        const actor = adminActor(request);
        for (const d of deleted) {
          await adminAudit(tx, actor, {
            tenantId: d.tenantId,
            action: 'admin.impersonation_end',
            entityType: 'session',
            entityId: d.id,
            impersonatorUserId: actor.userId,
            data: { endedBy: 'admin_session' },
          });
          if (d.tenantId) await writeEndNotice(tx, d.tenantId, actor.userId, d.id, 'admin_session');
        }
      }
    });

    let restored = false;
    if (stash) {
      // Destek oturumu boyunca admin etkindi: hareketsizlik kilidini (30 dk) bu süre için yenile
      if (impersonatorId) {
        await app.db
          .update(sessions)
          .set({ lastSeenAt: new Date() })
          .where(and(eq(sessions.tokenHash, sha256Hex(stash)), eq(sessions.userId, impersonatorId), eq(sessions.kind, 'user')));
      }
      const adminAuth = await resolveSession(app.db, stash);
      if (
        adminAuth &&
        adminAuth.isPlatformAdmin &&
        adminAuth.session.kind === 'user' &&
        (!impersonatorId || adminAuth.user.id === impersonatorId) &&
        !isAdminSession
      ) {
        setSessionCookie(reply, app.config, stash, adminAuth.session.expiresAt);
        restored = true;
      }
      clearAdminStashCookie(reply, app.config);
    }
    if (isImpersonation && !restored) clearSessionCookie(reply, app.config);

    return { ok: true as const, ended, restored, redirectTo: restored || isAdminSession ? '/admin' : '/admin/giris' };
  });

  /**
   * GET /admin/support-access/notices — İŞLETME ucu (platform rolü gerekmez; `requireAdminTotpEnrollment`
   * platform olmayan oturumda erken döner). İşletme sahibi/yöneticisi kendi işletmesinde açık destek
   * oturumlarını ve son destek kayıtlarını görür; başka işletmenin kaydı görünmez (tenant yalıtımı oturumdaki
   * `tenantId` ile sağlanır, istekte işletme kimliği ALINMAZ).
   *
   * Destek oturumunun kendisi de bu ucu çağırabilir (panel kabuğu aynı koddur); gördüğü şey yine o işletmenin
   * kaydıdır, yeni bir bilgi açılmaz.
   */
  app.get(
    '/support-access/notices',
    {
      preHandler: requireTenantRole(['owner', 'manager']),
      schema: { response: { 200: supportAccessNoticesResponseSchema } },
    },
    async (request) => {
      const auth = tenantAuth(request);
      return loadSupportAccessNotices(app.db, { tenantId: auth.tenantId, userId: auth.userId });
    },
  );
};

export default routes;
