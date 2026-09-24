// GET /admin/overview (05 A-02).

import { adminOverviewSchema } from '@siparis/core/admin/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { loadOverview } from '../../services/admin/overview';
import { requireAdmin } from '../../services/admin/util';

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/overview',
    { preHandler: requireAdmin('overview:read'), schema: { response: { 200: adminOverviewSchema } } },
    async () => loadOverview(app.db),
  );
};

export default routes;
