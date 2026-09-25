// WhatsApp webhook (14 §6.5, 02 §7.2): GET/POST /api/v1/webhooks/wa/:webhookToken.
// GET: Meta doğrulaması (hub.mode=subscribe + WA_VERIFY_TOKEN → hub.challenge düz metin).
// POST: WA_APP_SECRET varsa X-Hub-Signature-256 ham gövde üzerinden doğrulanır (bu eklentiye özel içerik ayrıştırıcı:
// JSON parse edilmeden Buffer); ham olay wa_webhook_events + `wa.process_inbound` işi → hemen 200.
// Tekrar teslim: wamid UNIQUE (işleme tarafında); durumlar monoton.
// Bağlantısı kesilmiş (status 'disconnected') hesabın adresi bilinmeyen belirteç gibi 404 döner: olay kaydedilmez,
// bot yanıt kuyruğa atmaz. Bağlantı kesilince ve adres yenilenince belirteç de değişir (routes/panel/whatsapp.ts).

import { waAccounts } from '@siparis/db';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors';
import { createRateLimiter, enforceRateLimit } from '../../lib/rate-limit';
import { safeEqual } from '../../lib/tokens';
import { ingestWebhookPayload } from '../../services/messaging/ingest';
import { verifyMetaSignature } from '../../wa/signature';

const paramsSchema = z.object({ webhookToken: z.string().min(8).max(200) });

const routes: FastifyPluginAsyncZod = async (app) => {
  // Ham gövde: yalnız bu eklentinin rotaları için (kapsüllü)
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  // Belirteç başına kaba sınır (taşkın koruması; Meta yeniden dener)
  const limiter = createRateLimiter({ limit: 1200, windowMs: 60_000 });

  app.get(
    '/:webhookToken',
    {
      schema: {
        params: paramsSchema,
        querystring: z.object({
          'hub.mode': z.string().optional(),
          'hub.verify_token': z.string().optional(),
          'hub.challenge': z.string().max(200).optional(),
        }),
      },
    },
    async (request, reply) => {
      const q = request.query;
      const [account] = await app.db
        .select({ id: waAccounts.id, status: waAccounts.status })
        .from(waAccounts)
        .where(eq(waAccounts.webhookToken, request.params.webhookToken));
      if (!account || account.status === 'disconnected') throw notFound('Webhook bulunamadı.');
      const ok = q['hub.mode'] === 'subscribe' && safeEqual(q['hub.verify_token'] ?? '', app.config.WA_VERIFY_TOKEN);
      if (!ok) throw forbidden('Doğrulama belirteci geçersiz.', 'invalid_verify_token');
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    },
  );

  app.post('/:webhookToken', { schema: { params: paramsSchema } }, async (request, reply) => {
    const token = request.params.webhookToken;
    enforceRateLimit(limiter, token);
    const [account] = await app.db.select().from(waAccounts).where(eq(waAccounts.webhookToken, token));
    if (!account || account.status === 'disconnected') throw notFound('Webhook bulunamadı.');

    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.from(typeof request.body === 'string' ? request.body : '');
    // 360dialog Meta imzası göndermez; URL'deki gizli belirteç doğrulama yerine geçer (teyit edilmeli)
    if (app.config.WA_APP_SECRET && account.provider !== 'd360') {
      const header = request.headers['x-hub-signature-256'];
      if (!verifyMetaSignature(raw, typeof header === 'string' ? header : undefined, app.config.WA_APP_SECRET)) {
        throw new AppError(401, 'invalid_signature', 'İmza doğrulanamadı.');
      }
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      throw badRequest('Geçersiz JSON gövdesi.', undefined, 'invalid_json');
    }
    if (!payload || typeof payload !== 'object') throw badRequest('Geçersiz webhook gövdesi.', undefined, 'invalid_payload');

    await ingestWebhookPayload(app.db, account, payload);
    return reply.code(200).send({ ok: true });
  });
};

export default routes;
