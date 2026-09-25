// GET /api/v1/panel/stream?branchId= — SSE (14 §7.1). Last-Event-ID ile kaçırılan olaylar tekrar oynatılır.
// Akış açıkken şubenin panel varlığı dakikada bir yazılır (06 §7.7 panel çevrimdışı dedektörü).

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { openBranchStream, parseLastEventId } from '../../lib/sse';
import { computeBranchOrderingState } from '../../services/orders/store-context';
import { assertBranchAccess, defaultBranchId, requireTenantRole, tenantAuth } from '../../plugins/auth';
import { recordImpersonationStreamOpen } from '../../plugins/impersonation-audit';
import { PANEL_PRESENCE_TOUCH_MS, PRESENCE_ROLES, touchBranchPresence } from '../../services/push/presence';

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
      // Panel varlığı: yalnız yeni sipariş alarmını duyan roller (mutfak sayılmaz) ve işletmenin kendi oturumu
      // (destek oturumu işletmenin cihazı değildir). Açılışta ve akış sürdükçe dakikada bir; kapanınca durur.
      if (!reply.raw.writableEnded && auth.session.kind !== 'impersonation' && PRESENCE_ROLES.includes(auth.role)) {
        let closed = false;
        let timer: ReturnType<typeof setInterval> | null = null;
        const stop = () => {
          closed = true;
          if (timer) clearInterval(timer);
        };
        request.raw.once('close', stop);
        reply.raw.once('close', stop);
        // Bağlantı, dinleyiciler eklenmeden (akış açılışındaki beklemeler sırasında) kapanmış olabilir: 'close' bir daha
        // gelmez. Soket kontrol edilmezse zamanlayıcı kapalı ekran için varlık yazmaya devam eder, dedektör hiç uyarmaz.
        const gone = () => closed || reply.raw.writableEnded || reply.raw.destroyed || !reply.raw.socket || reply.raw.socket.destroyed;
        const touch = async () => {
          if (gone()) return stop();
          await touchBranchPresence(app.db, { tenantId: auth.tenantId, branchId }).catch((err) => request.log.warn({ err }, 'panel varlığı yazılamadı'));
        };
        await touch();
        if (!gone()) {
          timer = setInterval(() => void touch(), PANEL_PRESENCE_TOUCH_MS);
          timer.unref();
        }
      }
      // Destek oturumu (impersonation): hijack edilen akışta onResponse kancası çalışmaz → açılış burada kaydedilir
      await recordImpersonationStreamOpen(app, request);
    },
  );
};

export default streamRoutes;
