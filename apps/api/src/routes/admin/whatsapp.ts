// GET /admin/whatsapp (05 A-06): tüm hesapların sağlığı; kırmızılar üstte. Ortak numara (00 §12a madde 8): platformun
// tek numarasının yapılandırma ve son 24 saat özeti (sharedNumber; webhook belirteci maskeli).

import { SHARED_WA_DISPLAY_NAME, WA_PROVIDER_LABELS, formatPhone } from '@siparis/core';
import { adminWaListQuerySchema, adminWaListResponseSchema, type AdminWaSharedNumber } from '@siparis/core/admin/contracts';
import { sharedWaMessages, tenants, waWebhookEvents } from '@siparis/db';
import { count, eq, gte, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { platformDisplayPhone } from '../../config';
import { requireAdmin } from '../../services/admin/util';
import { loadWaHealth } from '../../services/admin/wa-health';
import { selectableSharedShops } from '../../services/messaging/shared';

/** Ortak numara özeti: yapılandırma (env), son ortak webhook olayı, dükkan sayıları, platform mesajları (24 sa). */
async function sharedNumberSummary(app: FastifyInstance, now = new Date()): Promise<AdminWaSharedNumber> {
  const cfg = app.config;
  const display = platformDisplayPhone(cfg);
  const token = cfg.PLATFORM_WA_WEBHOOK_TOKEN ?? null;
  const since = new Date(now.getTime() - 86_400_000);
  const [[ev], [shopTotal], selectable, rows] = await Promise.all([
    app.db.select({ last: max(waWebhookEvents.receivedAt) }).from(waWebhookEvents).where(eq(waWebhookEvents.provider, 'shared')),
    app.db.select({ n: count() }).from(tenants).where(eq(tenants.waMode, 'shared')),
    selectableSharedShops(app.db),
    app.db
      .select({ direction: sharedWaMessages.direction, status: sharedWaMessages.status, n: count() })
      .from(sharedWaMessages)
      .where(gte(sharedWaMessages.createdAt, since))
      .groupBy(sharedWaMessages.direction, sharedWaMessages.status),
  ]);
  const platform24h = { inbound: 0, outbound: 0, failed: 0 };
  for (const r of rows) {
    if (r.direction === 'in') platform24h.inbound += Number(r.n);
    else if (r.status === 'failed') platform24h.failed += Number(r.n);
    else platform24h.outbound += Number(r.n);
  }
  const problems: string[] = [];
  let health: AdminWaSharedNumber['health'] = 'green';
  if (!display) {
    problems.push('Ortak numara tanımlı değil (PLATFORM_WA_DISPLAY_PHONE). Dükkanların QR ve bağlantıları oluşmaz.');
    health = 'red';
  }
  if (!token) {
    problems.push('Ortak webhook belirteci tanımlı değil (PLATFORM_WA_WEBHOOK_TOKEN): ortak numaraya gelen mesajlar alınamaz.');
    if (cfg.PLATFORM_WA_PROVIDER !== 'mock') health = 'red';
  }
  if (platform24h.failed > 0) {
    problems.push(`Son 24 saatte ${platform24h.failed} platform mesajı (dükkan seçici) gönderilemedi.`);
    if (health === 'green') health = 'yellow';
  }
  if (cfg.PLATFORM_WA_PROVIDER === 'mock') {
    problems.push('Sağlayıcı simülatör (mock): gerçek WhatsApp mesajı gitmez.');
    if (health === 'green') health = 'yellow';
  }
  const base = cfg.APP_BASE_URL.replace(/\/$/, '');
  return {
    displayName: SHARED_WA_DISPLAY_NAME,
    displayPhone: display,
    displayPhoneFormatted: display ? formatPhone(display) : null,
    provider: cfg.PLATFORM_WA_PROVIDER,
    providerLabel: WA_PROVIDER_LABELS[cfg.PLATFORM_WA_PROVIDER],
    webhookConfigured: !!token,
    webhookUrlMasked: token ? `${base}/api/v1/webhooks/wa/shared/••••${token.slice(-4)}` : null,
    lastWebhookAt: ev?.last ? new Date(ev.last).toISOString() : null,
    shops: { total: Number(shopTotal?.n ?? 0), selectable: selectable.length },
    platform24h,
    health,
    problems,
  };
}

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/whatsapp',
    {
      preHandler: requireAdmin('whatsapp:read'),
      schema: { querystring: adminWaListQuerySchema, response: { 200: adminWaListResponseSchema } },
    },
    async (request) => {
      const [all, sharedNumber] = await Promise.all([loadWaHealth(app.db), sharedNumberSummary(app)]);
      const summary = {
        total: all.length,
        red: all.filter((a) => a.health === 'red').length,
        yellow: all.filter((a) => a.health === 'yellow').length,
        green: all.filter((a) => a.health === 'green').length,
        silent: all.filter((a) => a.silent).length,
      };
      const items = request.query.problems ? all.filter((a) => a.health !== 'green') : all;
      return { items, summary, sharedNumber };
    },
  );
};

export default routes;
