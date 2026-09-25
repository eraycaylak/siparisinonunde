// Web Push (00 §10 alarm t=0 "ses + push", 04 §4.5; 14 §6.3) — panel cihaz aboneliği.
// GET  /panel/push/public-key  → { enabled, publicKey } (VAPID yoksa push kapalı)
// POST /panel/push/subscribe   → endpoint'e göre ekle/güncelle; kullanıcı + işletme + (üyelik kısıtlıysa) şube + oturuma bağlar
// POST /panel/push/unsubscribe → yalnız çağıranın bu işletmedeki aboneliği
// POST /panel/push/test        → çağıranın bu cihazdaki aboneliğine test bildirimi
// Roller: kurye hariç panel rolleri. Destek oturumu (impersonation) yazma uçlarını kullanamaz: bildirimler işletmenin
// cihazlarına gider, destek personelinin tarayıcısına değil.

import {
  pushEndpointRequestSchema,
  pushPublicKeyResponseSchema,
  pushSubscribeRequestSchema,
  pushSubscribeResponseSchema,
  pushTestResponseSchema,
  pushUnsubscribeResponseSchema,
} from '@siparis/core/notifications/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { forbidden } from '../../lib/errors';
import { createRateLimiter, enforceRateLimit } from '../../lib/rate-limit';
import { requireTenantRole, tenantAuth } from '../../plugins/auth';
import { webPushConfigWarnings } from '../../config';
import { sendPushTest } from '../../services/push/send';
import { removePushSubscription, upsertPushSubscription } from '../../services/push/subscriptions';

const PUSH_ROLES = ['owner', 'manager', 'cashier', 'kitchen'] as const;

function assertOwnDevice(request: FastifyRequest): void {
  if (request.auth?.session.kind !== 'user') {
    throw forbidden('Destek görünümündeyken bu cihaz için bildirim ayarı yapılamaz.', 'impersonation_not_allowed');
  }
}

const pushRoutes: FastifyPluginAsyncZod = async (app) => {
  // Üretimde VAPID yoksa API açılışında uyarı (worker.ts de yazar); push isteğe bağlıdır, açılışı engellemez
  for (const w of webPushConfigWarnings(app.config)) app.log.warn(w);
  // Test bildirimi: kullanıcı başına dakikada en çok 5
  const testLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

  app.get(
    '/push/public-key',
    { preHandler: requireTenantRole(PUSH_ROLES), schema: { response: { 200: pushPublicKeyResponseSchema } } },
    async () => ({
      enabled: app.config.pushEnabled,
      publicKey: app.config.pushEnabled ? (app.config.VAPID_PUBLIC_KEY ?? null) : null,
    }),
  );

  app.post(
    '/push/subscribe',
    {
      preHandler: requireTenantRole(PUSH_ROLES),
      schema: { body: pushSubscribeRequestSchema, response: { 200: pushSubscribeResponseSchema } },
    },
    async (request) => {
      assertOwnDevice(request);
      const auth = tenantAuth(request);
      const ua = request.headers['user-agent'];
      const row = await upsertPushSubscription(app.db, {
        tenantId: auth.tenantId,
        branchId: auth.branchId,
        userId: auth.userId,
        sessionId: auth.session.id,
        endpoint: request.body.endpoint,
        p256dh: request.body.keys.p256dh,
        auth: request.body.keys.auth,
        userAgent: typeof ua === 'string' ? ua : null,
      });
      return { ok: true as const, subscriptionId: row.id, branchId: row.branchId };
    },
  );

  app.post(
    '/push/unsubscribe',
    {
      preHandler: requireTenantRole(PUSH_ROLES),
      schema: { body: pushEndpointRequestSchema, response: { 200: pushUnsubscribeResponseSchema } },
    },
    async (request) => {
      assertOwnDevice(request);
      const auth = tenantAuth(request);
      const removed = await removePushSubscription(app.db, { tenantId: auth.tenantId, userId: auth.userId, endpoint: request.body.endpoint });
      return { ok: true as const, removed };
    },
  );

  app.post(
    '/push/test',
    {
      preHandler: requireTenantRole(PUSH_ROLES),
      schema: { body: pushEndpointRequestSchema, response: { 200: pushTestResponseSchema } },
    },
    async (request) => {
      assertOwnDevice(request);
      const auth = tenantAuth(request);
      enforceRateLimit(testLimiter, auth.userId);
      return sendPushTest({ db: app.db, config: app.config, log: request.log }, { tenantId: auth.tenantId, userId: auth.userId, endpoint: request.body.endpoint });
    },
  );
};

export default pushRoutes;
