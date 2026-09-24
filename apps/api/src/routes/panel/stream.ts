// GET /api/v1/panel/stream?branchId= — SSE (14 §7.1). Last-Event-ID ile kaçırılan olaylar tekrar oynatılır.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { openBranchStream, parseLastEventId } from '../../lib/sse';
import { computeBranchOrderingState } from '../../services/orders/store-context';
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
      const branch = await assertBranchAccess(app.db, auth, branchId);
      // Dilim 2: akış açılınca şubenin güncel sipariş alma durumu tek 'branch.state' olayı olarak gönderilir
      // (branch_events'e yazılmaz, id taşımaz → Last-Event-ID etkilenmez). Adsız "message" çerçevesi olarak
      // {type:'branch.state', data} biçiminde gider: web/lib/sse.ts bunu 'branch.state' olarak dağıtır; adlı olay
      // bekleyen istemciler (ör. sse.test.ts) onu yok sayar.
      const state = await computeBranchOrderingState(app.db, branch);
      await openBranchStream(request, reply, {
        db: app.db,
        hub: app.branchEvents,
        tenantId: auth.tenantId,
        branchId,
        role: auth.role,
        lastEventId: parseLastEventId(request),
      });
      if (!reply.raw.writableEnded) {
        const data = {
          orderingState: state.state,
          pausedUntil: state.pausedUntil?.toISOString() ?? null,
          busyExtraMinutes: state.busyExtraMinutes,
          nextOpenAt: state.nextOpenAt?.toISOString() ?? null,
        };
        reply.raw.write(`data: ${JSON.stringify({ type: 'branch.state', data })}\n\n`);
      }
    },
  );
};

export default streamRoutes;
