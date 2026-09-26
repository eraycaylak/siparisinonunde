// WhatsApp webhook (14 §6.5, 02 §7.2): GET/POST /api/v1/webhooks/wa/:webhookToken.
// GET: Meta doğrulaması (hub.mode=subscribe + WA_VERIFY_TOKEN → hub.challenge düz metin).
// POST: WA_APP_SECRET varsa X-Hub-Signature-256 ham gövde üzerinden doğrulanır (bu eklentiye özel içerik ayrıştırıcı:
// JSON parse edilmeden Buffer); ham olay wa_webhook_events + `wa.process_inbound` işi → hemen 200.
// Tekrar teslim: wamid UNIQUE (işleme tarafında); durumlar monoton.
// Bağlantısı kesilmiş (status 'disconnected') hesabın adresi bilinmeyen belirteç gibi 404 döner: olay kaydedilmez,
// bot yanıt kuyruğa atmaz. Bağlantı kesilince ve adres yenilenince belirteç de değişir (routes/panel/whatsapp.ts).
// Ortak numara (00 §12a madde 8): GET/POST /api/v1/webhooks/wa/shared/:token (PLATFORM_WA_WEBHOOK_TOKEN) — aynı
// doğrulama/imza/ham olay/hemen 200 kuralları; dükkan seçimi işlemede (services/messaging/shared-router.ts). İşletmenin
// 'shared' satırının kendi webhook'u yoktur (404).

import { waAccounts } from '@siparis/db';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors';
import { clientIp, createRateLimiter, enforceRateLimit } from '../../lib/rate-limit';
import { safeEqual } from '../../lib/tokens';
import { ingestWebhookPayload } from '../../services/messaging/ingest';
import { ingestSharedWebhookPayload } from '../../services/messaging/shared-router';
import { verifyMetaSignature } from '../../wa/signature';

const paramsSchema = z.object({ webhookToken: z.string().min(8).max(200) });
const sharedParamsSchema = z.object({ token: z.string().min(1).max(200) });
const hubQuerySchema = z.object({
  'hub.mode': z.string().optional(),
  'hub.verify_token': z.string().optional(),
  'hub.challenge': z.string().max(200).optional(),
});

/** Ham gövdeyi JSON nesnesine çevirir (400: bozuk JSON / nesne değil). */
function parseRawPayload(body: unknown): { raw: Buffer; payload: object } {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : '');
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    throw badRequest('Geçersiz JSON gövdesi.', undefined, 'invalid_json');
  }
  if (!payload || typeof payload !== 'object') throw badRequest('Geçersiz webhook gövdesi.', undefined, 'invalid_payload');
  return { raw, payload };
}

const routes: FastifyPluginAsyncZod = async (app) => {
  // Ham gövde: yalnız bu eklentinin rotaları için (kapsüllü)
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  // Belirteç başına kaba sınır (taşkın koruması; Meta yeniden dener)
  const limiter = createRateLimiter({ limit: 1200, windowMs: 60_000 });
  // Ortak numara tüm ortak numara işletmelerinin trafiğini taşır: daha yüksek sınır. Kova YALNIZ doğru belirteçli
  // isteklerle harcanır: belirteç denetimi sınırdan önce yapılır, yoksa kimliği doğrulanmamış bir taşkın kovayı boşaltıp
  // Meta'nın gerçek teslimlerini 429'a düşürür (tüm ortak numara dükkanları yanıtsız kalır).
  const sharedLimiter = createRateLimiter({ limit: 12_000, windowMs: 60_000 });
  // Yanlış belirteçli ortak webhook istekleri: IP başına ayrı, küçük kova (tarama/taşkın; doğru belirtecin kovasına dokunmaz)
  const sharedBadTokenLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

  /** Ortak webhook belirteci yapılandırılmış ve eşleşiyor mu. */
  const sharedTokenOk = (token: string) => {
    const expected = app.config.PLATFORM_WA_WEBHOOK_TOKEN;
    return Boolean(expected) && safeEqual(token, expected!);
  };
  /** Yanlış belirteç: IP başına sınır (429), sonra bilinmeyen webhook gibi 404. */
  const rejectSharedToken = (ip: string): never => {
    enforceRateLimit(sharedBadTokenLimiter, ip);
    throw notFound('Webhook bulunamadı.');
  };

  // GET /shared/:token — Meta doğrulaması (ortak numara)
  app.get('/shared/:token', { schema: { params: sharedParamsSchema, querystring: hubQuerySchema } }, async (request, reply) => {
    if (!sharedTokenOk(request.params.token)) rejectSharedToken(clientIp(request));
    const q = request.query;
    const ok = q['hub.mode'] === 'subscribe' && safeEqual(q['hub.verify_token'] ?? '', app.config.WA_VERIFY_TOKEN);
    if (!ok) throw forbidden('Doğrulama belirteci geçersiz.', 'invalid_verify_token');
    return reply.type('text/plain').send(q['hub.challenge'] ?? '');
  });

  // POST /shared/:token — ortak numara olayları: imza → ham olay + iş → hemen 200 (yönlendirme işlemede)
  app.post('/shared/:token', { schema: { params: sharedParamsSchema } }, async (request, reply) => {
    if (!sharedTokenOk(request.params.token)) rejectSharedToken(clientIp(request));
    enforceRateLimit(sharedLimiter, 'shared');
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.from(typeof request.body === 'string' ? request.body : '');
    if (app.config.WA_APP_SECRET && app.config.PLATFORM_WA_PROVIDER !== 'd360') {
      const header = request.headers['x-hub-signature-256'];
      if (!verifyMetaSignature(raw, typeof header === 'string' ? header : undefined, app.config.WA_APP_SECRET)) {
        throw new AppError(401, 'invalid_signature', 'İmza doğrulanamadı.');
      }
    }
    const { payload } = parseRawPayload(raw);
    await ingestSharedWebhookPayload(app.db, payload);
    return reply.code(200).send({ ok: true });
  });

  app.get(
    '/:webhookToken',
    {
      schema: { params: paramsSchema, querystring: hubQuerySchema },
    },
    async (request, reply) => {
      const q = request.query;
      const [account] = await app.db
        .select({ id: waAccounts.id, status: waAccounts.status, provider: waAccounts.provider })
        .from(waAccounts)
        .where(eq(waAccounts.webhookToken, request.params.webhookToken));
      if (!account || account.status === 'disconnected' || account.provider === 'shared') throw notFound('Webhook bulunamadı.');
      const ok = q['hub.mode'] === 'subscribe' && safeEqual(q['hub.verify_token'] ?? '', app.config.WA_VERIFY_TOKEN);
      if (!ok) throw forbidden('Doğrulama belirteci geçersiz.', 'invalid_verify_token');
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    },
  );

  app.post('/:webhookToken', { schema: { params: paramsSchema } }, async (request, reply) => {
    const token = request.params.webhookToken;
    enforceRateLimit(limiter, token);
    const [account] = await app.db.select().from(waAccounts).where(eq(waAccounts.webhookToken, token));
    // Ortak numara satırının işletmeye özel webhook'u yoktur (olaylar /shared/:token'dan gelir)
    if (!account || account.status === 'disconnected' || account.provider === 'shared') throw notFound('Webhook bulunamadı.');

    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.from(typeof request.body === 'string' ? request.body : '');
    // 360dialog Meta imzası göndermez; URL'deki gizli belirteç doğrulama yerine geçer (teyit edilmeli)
    if (app.config.WA_APP_SECRET && account.provider !== 'd360') {
      const header = request.headers['x-hub-signature-256'];
      if (!verifyMetaSignature(raw, typeof header === 'string' ? header : undefined, app.config.WA_APP_SECRET)) {
        throw new AppError(401, 'invalid_signature', 'İmza doğrulanamadı.');
      }
    }
    const { payload } = parseRawPayload(raw);

    await ingestWebhookPayload(app.db, account, payload);
    return reply.code(200).send({ ok: true });
  });
};

export default routes;
