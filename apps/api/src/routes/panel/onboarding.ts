// Panel onboarding (14 §6.3 Onboarding, 04 §3) — dilim 4. Durum ve adımlar owner/manager; canlıya geçiş owner.

import { normalizeTrMobile, orderSummarySchema } from '@siparis/core';
import { goLiveResponseSchema, onboardingStatusSchema, whatsapplessRequestSchema } from '@siparis/core/settings/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit, auditActor } from '../../lib/audit';
import { requireTenantRole, tenantAuth } from '../../plugins/auth';
import { createTestOrder, goLive, onboardingStatus, setWhatsappless } from '../../services/onboarding/index';

const onboardingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/onboarding',
    { preValidation: requireTenantRole(['owner', 'manager']), schema: { response: { 200: onboardingStatusSchema } } },
    async (request) => onboardingStatus(app.db, tenantAuth(request).tenantId),
  );

  app.post(
    '/onboarding/whatsappless',
    { preValidation: requireTenantRole(['owner', 'manager']), schema: { body: whatsapplessRequestSchema, response: { 200: onboardingStatusSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      await app.db.transaction(async (tx) => {
        await setWhatsappless(tx, auth.tenantId, request.body.enabled);
        await audit(tx, { ...auditActor(request), action: 'onboarding.whatsappless', entityType: 'tenant', entityId: auth.tenantId, data: { enabled: request.body.enabled } });
      });
      return onboardingStatus(app.db, auth.tenantId);
    },
  );

  app.post(
    '/onboarding/test-order',
    {
      preValidation: requireTenantRole(['owner', 'manager']),
      schema: { response: { 200: z.object({ order: orderSummarySchema, created: z.boolean() }), 201: z.object({ order: orderSummarySchema, created: z.boolean() }) } },
    },
    async (request, reply) => {
      const auth = tenantAuth(request);
      const result = await app.db.transaction(async (tx) => {
        const r = await createTestOrder(tx, auth.tenantId, {
          userId: auth.userId,
          name: auth.user.name,
          phone: normalizeTrMobile(auth.user.phone),
        });
        if (r.created) {
          await audit(tx, { ...auditActor(request), action: 'onboarding.test_order', entityType: 'order', entityId: r.summary.id, data: { number: r.summary.number } });
        }
        return r;
      });
      reply.status(result.created ? 201 : 200);
      return { order: result.summary, created: result.created };
    },
  );

  app.post(
    '/onboarding/go-live',
    { preValidation: requireTenantRole(['owner']), schema: { response: { 200: goLiveResponseSchema } } },
    async (request) => {
      const auth = tenantAuth(request);
      const status = await onboardingStatus(app.db, auth.tenantId);
      const result = await app.db.transaction(async (tx) => {
        const r = await goLive(tx, auth.tenantId, status);
        await audit(tx, {
          ...auditActor(request),
          action: 'onboarding.go_live',
          entityType: 'tenant',
          entityId: auth.tenantId,
          data: { webLive: r.webLive, live: r.live, changed: r.changed, missingForFull: r.missingForFull },
        });
        return r;
      });
      const { changed: _changed, ...body } = result;
      return body;
    },
  );
};

export default onboardingRoutes;
