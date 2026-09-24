// GET /admin/whatsapp (05 A-06): tüm hesapların sağlığı; kırmızılar üstte.

import { adminWaListQuerySchema, adminWaListResponseSchema } from '@siparis/core/admin/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAdmin } from '../../services/admin/util';
import { loadWaHealth } from '../../services/admin/wa-health';

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/whatsapp',
    {
      preHandler: requireAdmin('whatsapp:read'),
      schema: { querystring: adminWaListQuerySchema, response: { 200: adminWaListResponseSchema } },
    },
    async (request) => {
      const all = await loadWaHealth(app.db);
      const summary = {
        total: all.length,
        red: all.filter((a) => a.health === 'red').length,
        yellow: all.filter((a) => a.health === 'yellow').length,
        green: all.filter((a) => a.health === 'green').length,
        silent: all.filter((a) => a.silent).length,
      };
      const items = request.query.problems ? all.filter((a) => a.health !== 'green') : all;
      return { items, summary };
    },
  );
};

export default routes;
