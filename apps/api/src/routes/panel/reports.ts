// Panel raporlar (14 §6.3 Rapor) — dilim 4. Gün sonu: owner/manager (cashier yalnız bugün, 04 §2.3 P-32);
// dönem özeti ve tasarruf: owner/manager. Test siparişleri hariç.

import { dailyReportSchema, savingsReportSchema, summaryReportSchema } from '@siparis/core/settings/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { forbidden } from '../../lib/errors';
import { assertBranchAccess, requireTenantRole, tenantAuth } from '../../plugins/auth';
import { addDays, dailyReport, savingsReport, summaryReport, todayIstanbul } from '../../services/reports/index';

const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  const scopeOf = async (request: Parameters<typeof tenantAuth>[0], branchId?: string) => {
    const auth = tenantAuth(request);
    const id = branchId ?? auth.branchId ?? null;
    if (id) await assertBranchAccess(app.db, auth, id);
    return { auth, scope: { tenantId: auth.tenantId, branchId: id } };
  };

  app.get(
    '/reports/daily',
    {
      preValidation: requireTenantRole(['owner', 'manager', 'cashier']),
      schema: { querystring: z.object({ date: z.string().max(10).optional(), branchId: z.uuid().optional() }), response: { 200: dailyReportSchema } },
    },
    async (request) => {
      const { auth, scope } = await scopeOf(request, request.query.branchId);
      const today = todayIstanbul();
      const date = request.query.date ?? today;
      if (auth.role === 'cashier' && date !== today) throw forbidden('Kasiyer yalnız bugünün özetini görebilir.');
      return dailyReport(app.db, scope, date);
    },
  );

  app.get(
    '/reports/summary',
    {
      preValidation: requireTenantRole(['owner', 'manager']),
      schema: {
        querystring: z.object({ from: z.string().max(10).optional(), to: z.string().max(10).optional(), branchId: z.uuid().optional() }),
        response: { 200: summaryReportSchema },
      },
    },
    async (request) => {
      const { scope } = await scopeOf(request, request.query.branchId);
      const to = request.query.to ?? todayIstanbul();
      const from = request.query.from ?? addDays(to, -29);
      return summaryReport(app.db, scope, from, to);
    },
  );

  app.get(
    '/reports/savings',
    {
      preValidation: requireTenantRole(['owner', 'manager']),
      schema: {
        querystring: z.object({
          month: z.string().max(7).optional(),
          includePhone: z.enum(['1', '0', 'true', 'false']).optional(),
          branchId: z.uuid().optional(),
        }),
        response: { 200: savingsReportSchema },
      },
    },
    async (request) => {
      const { scope } = await scopeOf(request, request.query.branchId);
      const month = request.query.month ?? todayIstanbul().slice(0, 7);
      const includePhone = request.query.includePhone === '1' || request.query.includePhone === 'true';
      return savingsReport(app.db, scope, month, { includePhone });
    },
  );
};

export default reportRoutes;
