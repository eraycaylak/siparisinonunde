// Admin uç noktaları (14 §6.4) — dilim 5. Tamamı platform oturumu (requirePlatform + 05 §A.3 rol matrisi);
// yalnız POST /impersonation/end destek oturumuyla da çağrılabilir (oturumu geri yükler).

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAdminTotpEnrollment } from '../../plugins/auth';
import auditRoutes from './audit';
import flagRoutes from './flags';
import impersonationRoutes from './impersonation';
import jobRoutes from './jobs';
import leadRoutes from './leads';
import noteRoutes from './notes';
import overviewRoutes from './overview';
import tenantRoutes from './tenants';
import whatsappRoutes from './whatsapp';

const routes: FastifyPluginAsyncZod = async (app) => {
  // Zorunlu TOTP kurulmadan hiçbir admin ucu çalışmaz (impersonation başlatma dahil; 00 §12a madde 7)
  app.addHook('onRequest', requireAdminTotpEnrollment());
  // Admin yanıtları önbelleğe alınmaz
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });
  await app.register(overviewRoutes);
  await app.register(tenantRoutes);
  await app.register(impersonationRoutes);
  await app.register(noteRoutes);
  await app.register(whatsappRoutes);
  await app.register(jobRoutes);
  await app.register(flagRoutes);
  await app.register(leadRoutes);
  await app.register(auditRoutes);
};

export default routes;
