// Ortak numara "WhatsApp kurulumu" (15 §6.2a): yalnız platform_owner (izin whatsapp:setup). Durum dışındaki her çağrı
// (bilgileri göster, Meta Graph adımları) başarılı da olsa başarısız da olsa denetim kaydına yazılır. Kayıtta gizli değer,
// PIN ya da webhook belirteci yoktur; yalnız sonuç ve hata kodu.
//   GET  /admin/whatsapp/setup               durum (gizliler yalnız son 4 karakter)
//   POST /admin/whatsapp/setup/reveal        Meta'ya girilecek tam webhook adresi + doğrulama belirteci
//   POST /admin/whatsapp/setup/test          GET /{phone_number_id}?fields=… (bağlantı testi)
//   POST /admin/whatsapp/setup/register      {pin} → POST /{phone_number_id}/register
//   GET  /admin/whatsapp/setup/subscription  GET /{waba_id}/subscribed_apps
//   POST /admin/whatsapp/setup/subscription  POST /{waba_id}/subscribed_apps (+ güncel liste)
//   GET  /admin/whatsapp/setup/templates     kod kataloğundaki şablonların Meta durumu
//   POST /admin/whatsapp/setup/templates     eksik şablonları oluştur (idempotent) + durumlar

import {
  adminWaSetupRegisterBodySchema,
  adminWaSetupRegisterSchema,
  adminWaSetupRevealSchema,
  adminWaSetupStatusSchema,
  adminWaSetupSubscriptionSchema,
  adminWaSetupTestSchema,
  adminWaTemplatesSchema,
} from '@siparis/core/admin/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AppError } from '../../lib/errors';
import { createRateLimiter, enforceRateLimit } from '../../lib/rate-limit';
import { adminActor, adminAudit, requireAdmin } from '../../services/admin/util';
import {
  listTemplateStatus,
  readSubscription,
  registerNumber,
  revealSetup,
  setupStatus,
  subscribeApp,
  syncTemplates,
  testConnection,
} from '../../services/admin/wa-setup';

const routes: FastifyPluginAsyncZod = async (app) => {
  const guard = requireAdmin('whatsapp:setup');
  // PIN denemesi: Meta çok sayıda hatalı PIN'de numarayı bir süre kilitler (133008/133009); buradan önce sınırla
  const registerLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60_000 });

  /** Aksiyonu çalıştırır ve sonucu (ok / hata kodu) denetim kaydına yazar; hata aynen fırlatılır. */
  async function audited<T>(request: FastifyRequest, action: string, fn: () => Promise<T> | T, dataOf?: (r: T) => Record<string, unknown>): Promise<T> {
    const actor = adminActor(request);
    const base = { provider: app.config.PLATFORM_WA_PROVIDER };
    let result: T;
    try {
      result = await fn();
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'internal_error';
      const details = err instanceof AppError && err.details && typeof err.details === 'object' ? (err.details as Record<string, unknown>) : {};
      await adminAudit(app.db, actor, {
        action,
        entityType: 'platform_wa',
        data: { ...base, ok: false, error: code, ...(details.graphCode ? { graphCode: details.graphCode, graphSubcode: details.graphSubcode ?? null } : {}) },
      });
      throw err;
    }
    await adminAudit(app.db, actor, { action, entityType: 'platform_wa', data: { ...base, ok: true, ...(dataOf?.(result) ?? {}) } });
    return result;
  }

  app.get('/whatsapp/setup', { preHandler: guard, schema: { response: { 200: adminWaSetupStatusSchema } } }, async () => setupStatus(app.config));

  app.post('/whatsapp/setup/reveal', { preHandler: guard, schema: { response: { 200: adminWaSetupRevealSchema } } }, async (request) =>
    audited(request, 'admin.wa_setup_reveal', () => revealSetup(app.config), (r) => ({ webhookConfigured: r.webhookUrl != null })),
  );

  app.post('/whatsapp/setup/test', { preHandler: guard, schema: { response: { 200: adminWaSetupTestSchema } } }, async (request) =>
    audited(request, 'admin.wa_setup_test', () => testConnection(app.config), (r) => ({
      ready: r.ready,
      platformType: r.phone.platformType,
      nameStatus: r.phone.nameStatus,
      qualityRating: r.phone.qualityRating,
    })),
  );

  app.post(
    '/whatsapp/setup/register',
    { preHandler: guard, schema: { body: adminWaSetupRegisterBodySchema, response: { 200: adminWaSetupRegisterSchema } } },
    async (request) => {
      const actor = adminActor(request);
      return audited(request, 'admin.wa_setup_register', () => {
        enforceRateLimit(registerLimiter, actor.userId);
        return registerNumber(app.config, request.body.pin);
      });
    },
  );

  app.get('/whatsapp/setup/subscription', { preHandler: guard, schema: { response: { 200: adminWaSetupSubscriptionSchema } } }, async (request) =>
    audited(request, 'admin.wa_setup_subscription_view', () => readSubscription(app.config), (r) => ({ subscribed: r.subscribed, apps: r.apps.length })),
  );

  app.post('/whatsapp/setup/subscription', { preHandler: guard, schema: { response: { 200: adminWaSetupSubscriptionSchema } } }, async (request) =>
    audited(request, 'admin.wa_setup_subscribe', () => subscribeApp(app.config), (r) => ({ subscribed: r.subscribed, apps: r.apps.length })),
  );

  app.get('/whatsapp/setup/templates', { preHandler: guard, schema: { response: { 200: adminWaTemplatesSchema } } }, async (request) =>
    audited(request, 'admin.wa_setup_templates_view', () => listTemplateStatus(app.config), (r) => ({ summary: r.summary })),
  );

  app.post('/whatsapp/setup/templates', { preHandler: guard, schema: { response: { 200: adminWaTemplatesSchema } } }, async (request) =>
    audited(request, 'admin.wa_setup_templates_sync', () => syncTemplates(app.config), (r) => ({
      summary: r.summary,
      created: r.sync?.created ?? [],
      skipped: r.sync?.skipped.length ?? 0,
      failed: r.sync?.failed.map((f) => f.name) ?? [],
    })),
  );
};

export default routes;
