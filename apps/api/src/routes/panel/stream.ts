// GET /api/v1/panel/stream?branchId= — SSE (14 §7.1). Last-Event-ID ile kaçırılan olaylar tekrar oynatılır.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { openBranchStream, parseLastEventId } from '../../lib/sse';
import { assertBranchAccess, defaultBranchId, requireTenantRole, tenantAuth } from '../../plugins/auth';

const streamQuery = z.object({
  branchId: z.uuid().optional(),
  lastEventId: z.string().regex(/^\d+$/).optional(),
});

const streamRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/stream',
    {
      preHandler: requireTenantRole(['owner', 'manager', 'cashier', 'kitchen']),
      schema: { querystring: streamQuery },
    },
    async (request, reply) => {
      const auth = tenantAuth(request);
      const branchId = request.query.branchId ?? auth.branchId ?? (await defaultBranchId(app.db, auth.tenantId));
      if (!branchId) throw notFound('Şube bulunamadı.');
      await assertBranchAccess(app.db, auth, branchId);
      await openBranchStream(request, reply, {
        db: app.db,
        hub: app.branchEvents,
        tenantId: auth.tenantId,
        branchId,
        role: auth.role,
        lastEventId: parseLastEventId(request),
      });
    },
  );
};

export default streamRoutes;
