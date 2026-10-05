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
// Twilio (16 §2.5): gövde JSON değil application/x-www-form-urlencoded'dır ve Meta imzası gelmez. Form alanları düz
// nesneye çevrilip payload olarak saklanır; doğrulama X-Twilio-Signature iledir (Auth Token + ÇAĞRILAN ADRES + sıralı
// alanlar). Adres istek başlıklarından değil APP_BASE_URL'den kurulur: sahte Host başlığı doğrulamayı yanıltamaz.
// İmza 401'leri SESSİZ DEĞİLDİR (denetim H7 / iş 3.4): `rejectSignature` log.error + `alert()` üretir (ortak numarada
// kritik). Uyarı yalnız doğru webhook belirteciyle gelen istekte çıkar, yoksa internetten tetiklenen uyarı seli olurdu.

import { waAccounts } from '@siparis/db';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { alert } from '../../lib/alert';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors';
import { clientIp, createRateLimiter, enforceRateLimit } from '../../lib/rate-limit';
import { safeEqual } from '../../lib/tokens';
import { ingestWebhookPayload } from '../../services/messaging/ingest';
import { ingestSharedWebhookPayload } from '../../services/messaging/shared-router';
import { verifyMetaSignature } from '../../wa/signature';
import { toAccountRef } from '../../wa/registry';
import { verifyTwilioSignature } from '../../wa/twilio-signature';

/** Bu eklentinin kök yolu (app.ts'te prefix olarak verilir); Twilio imzasındaki adresin kurulmasında kullanılır. */
export const API_WA_WEBHOOK_PATH = '/api/v1/webhooks/wa';

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

const rawBodyOf = (body: unknown): Buffer =>
  Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : '');

/** İstek form-encoded mı (Twilio). */
function isFormEncoded(request: FastifyRequest): boolean {
  const ct = request.headers['content-type'];
  return typeof ct === 'string' && ct.toLowerCase().includes('application/x-www-form-urlencoded');
}

/** Form gövdesi → düz nesne (aynı ad birden çok kez gelirse Twilio'nun kuralı gereği son değer geçerlidir). */
export function formToObject(raw: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw.toString('utf8'))) out[k] = v;
  return out;
}

/**
 * Twilio'nun çağırdığı tam adres. İmza bu dizge üzerinden hesaplandığı için birebir aynı olmalıdır; bu yüzden
 * istek başlıklarından değil yapılandırmadan kurulur (16 §2.5).
 */
export function twilioWebhookUrl(appBaseUrl: string, path: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}${path}`;
}

/** İmza/kimlik doğrulaması başarısız olduğunda çağrılan ret işlevi (loglar, uyarı gönderir ve 401 atar). */
type SignatureReject = (reason: SignatureFailReason) => never;

/** Ret nedeni (uyarı yükünde ve logda görünür; gizli değer taşımaz). */
export type SignatureFailReason = 'meta_signature' | 'twilio_signature' | 'twilio_auth_token_missing';

/** Twilio gövdesi: imza doğrulanır, form alanları payload olur. İmza geçersizse `reject` (401 + uyarı). */
function twilioPayload(
  request: FastifyRequest,
  authToken: string | undefined,
  appBaseUrl: string,
  path: string,
  reject: SignatureReject,
): Record<string, string> {
  const params = formToObject(rawBodyOf(request.body));
  // Auth Token yoksa imza HİÇ doğrulanamaz: isteği kabul etmek yerine 401 + uyarı (yapılandırma arızası)
  if (!authToken) return reject('twilio_auth_token_missing');
  const header = request.headers['x-twilio-signature'];
  const url = twilioWebhookUrl(appBaseUrl, path);
  if (!verifyTwilioSignature(url, params, typeof header === 'string' ? header : undefined, authToken)) {
    return reject('twilio_signature');
  }
  return params;
}

const routes: FastifyPluginAsyncZod = async (app) => {
  // Ham gövde: yalnız bu eklentinin rotaları için (kapsüllü). Twilio form-encoded gönderir (16 §2.5).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

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

  /**
   * İmza doğrulanamadı → logla + uyarı gönder + 401 (denetim H7 / iş 3.4: "401'ler loglanmıyor, sağır kalıyoruz").
   * Uyarı yalnız DOĞRU webhook belirtecini sunan isteklerde üretilir (ortak numarada `sharedTokenOk`, işletmede
   * belirteçle bulunan hesap satırı): dışarıdan rastgele bir tarama bu uyarıyı tetikleyip nöbetçiyi yoramaz.
   * Ortak numara kritiktir: imza bozuksa TÜM ortak numara dükkanlarının müşteri mesajları 401'e düşer.
   * Soğuma `alert()` içindedir (anahtar başına 10 dk), yani Meta'nın yeniden denemeleri uyarı seli yapmaz.
   */
  const rejectSignature = (
    request: FastifyRequest,
    info: { scope: 'shared' | 'account'; reason: SignatureFailReason; accountId?: string; provider?: string },
  ): never => {
    const shared = info.scope === 'shared';
    request.log.error(
      { scope: info.scope, reason: info.reason, accountId: info.accountId ?? null, provider: info.provider ?? null },
      'webhook imzası doğrulanamadı: olay kaydedilmedi',
    );
    alert(
      { log: app.log, config: app.config },
      {
        kind: 'wa_webhook_signature_invalid',
        severity: shared ? 'critical' : 'warning',
        message: shared
          ? 'Ortak numara webhook imzası doğrulanamadı: gelen müşteri mesajları 401 ile reddediliyor, hiçbir dükkana sipariş düşmüyor.'
          : 'İşletme WhatsApp webhook imzası doğrulanamadı: o işletmenin gelen mesajları 401 ile reddediliyor.',
        // Gizli değer (belirteç, Auth Token, App Secret, phone_number_id) uyarıya YAZILMAZ
        data: { scope: info.scope, reason: info.reason, provider: info.provider ?? null, ...(info.accountId ? { accountId: info.accountId } : {}) },
        dedupeKey: `wa_webhook_signature_invalid:${info.scope}:${info.accountId ?? 'platform'}`,
      },
    );
    throw new AppError(401, 'invalid_signature', 'İmza doğrulanamadı.');
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
    const raw = rawBodyOf(request.body);
    let payload: object;
    const reject: SignatureReject = (reason) => rejectSignature(request, { scope: 'shared', reason, provider: app.config.PLATFORM_WA_PROVIDER });
    if (app.config.PLATFORM_WA_PROVIDER === 'twilio' || isFormEncoded(request)) {
      payload = twilioPayload(
        request,
        app.config.PLATFORM_WA_API_KEY,
        app.config.APP_BASE_URL,
        `${API_WA_WEBHOOK_PATH}/shared/${request.params.token}`,
        reject,
      );
    } else {
      if (app.config.WA_APP_SECRET && app.config.PLATFORM_WA_PROVIDER !== 'd360') {
        const header = request.headers['x-hub-signature-256'];
        if (!verifyMetaSignature(raw, typeof header === 'string' ? header : undefined, app.config.WA_APP_SECRET)) reject('meta_signature');
      }
      payload = parseRawPayload(raw).payload;
    }
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

    const raw = rawBodyOf(request.body);
    let payload: object;
    const reject: SignatureReject = (reason) => rejectSignature(request, { scope: 'account', reason, accountId: account.id, provider: account.provider });
    if (account.provider === 'twilio' || isFormEncoded(request)) {
      // Twilio: imza hesabın kendi Auth Token'ıyla (şifreli alandan çözülür), adres APP_BASE_URL'den
      const ref = toAccountRef(account, app.config);
      payload = twilioPayload(request, ref.apiKey ?? undefined, app.config.APP_BASE_URL, `${API_WA_WEBHOOK_PATH}/${token}`, reject);
    } else {
      // 360dialog Meta imzası göndermez; URL'deki gizli belirteç doğrulama yerine geçer (teyit edilmeli)
      if (app.config.WA_APP_SECRET && account.provider !== 'd360') {
        const header = request.headers['x-hub-signature-256'];
        if (!verifyMetaSignature(raw, typeof header === 'string' ? header : undefined, app.config.WA_APP_SECRET)) reject('meta_signature');
      }
      payload = parseRawPayload(raw).payload;
    }

    await ingestWebhookPayload(app.db, account, payload);
    return reply.code(200).send({ ok: true });
  });
};

export default routes;
