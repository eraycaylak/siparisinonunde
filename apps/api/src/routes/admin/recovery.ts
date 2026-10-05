// İşletme hesabı kurtarma (A-04 üyeler sekmesi; denetim H29): parolasını unutan işletme sahibini kurtarma.
// Karar ve güvenlik sınırları services/admin/recovery.ts başında.

import { adminPasswordResetRequestSchema, adminPasswordResetResponseSchema } from '@siparis/core/admin/support-access';
import { tenants } from '@siparis/db';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { createRateLimiter, enforceRateLimit } from '../../lib/rate-limit';
import { resetMemberPassword } from '../../services/admin/recovery';
import { adminActor, iso, requireAdmin } from '../../services/admin/util';

const memberParams = z.object({ id: z.uuid(), userId: z.uuid() });

/**
 * Hız sınırı (05 §A.1): sıfırlama hesabı ele geçirme aracı olabilir, bu yüzden hem YAPAN yönetici hem de HEDEF
 * hesap başına sınırlıdır. Bellek içi sınırlayıcı tek süreç için yeterlidir (14 §5); süreç yeniden başlarsa
 * sayaç sıfırlanır — bu yolda asıl kayıt denetim kaydıdır, sınır yalnız kaza/kötüye kullanımı yavaşlatır.
 */
const RESET_PER_ACTOR = { limit: 5, windowMs: 60 * 60_000 } as const;
const RESET_PER_TARGET = { limit: 3, windowMs: 60 * 60_000 } as const;

const routes: FastifyPluginAsyncZod = async (app) => {
  const perActor = createRateLimiter(RESET_PER_ACTOR);
  const perTarget = createRateLimiter(RESET_PER_TARGET);

  // POST /admin/tenants/:id/members/:userId/reset-password {reason}
  // Yanıt TEK SEFERLİK yeni parolayı taşır: loga, denetim kaydına ve e-postaya yazılmaz.
  app.post(
    '/tenants/:id/members/:userId/reset-password',
    {
      preHandler: requireAdmin('users:reset_password'),
      schema: {
        params: memberParams,
        body: adminPasswordResetRequestSchema,
        response: { 200: adminPasswordResetResponseSchema },
      },
    },
    async (request) => {
      const actor = adminActor(request);
      const { id: tenantId, userId } = request.params;
      enforceRateLimit(perActor, `pwreset:actor:${actor.userId}`);
      enforceRateLimit(perTarget, `pwreset:user:${userId}`);

      const [tenant] = await app.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
      if (!tenant) throw notFound('İşletme bulunamadı.');

      const result = await app.db.transaction((tx) => resetMemberPassword(tx, actor, { tenantId, userId, reason: request.body.reason }));

      return {
        ok: true as const,
        userId,
        userName: result.userName,
        password: result.password,
        sessionsEnded: result.sessionsEnded,
        otherTenantCount: result.otherTenantCount,
        at: iso(result.at),
      };
    },
  );
};

export default routes;
