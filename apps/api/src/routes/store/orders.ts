// Storefront sipariş, doğrulama ve takip (14 §6.2) — dilim 2.
// POST /store/:slug/quote · POST /store/:slug/orders · POST /store/orders/:orderId/sms-otp|sms-verify ·
// GET /store/track/:token · POST /store/track/:token/cancel · POST /store/track/:token/review

import {
  LEGAL_DOCUMENT_VERSION,
  acceptsOrders,
  createOrderRequestSchema,
  createOrderResponseSchema,
  maskPhone,
  normalizePhone,
  normalizeTrMobile,
  okResponseSchema,
  quoteRequestSchema,
  quoteResponseSchema,
  reviewRequestSchema,
  sms01Otp,
  smsOtpRequestSchema,
  smsVerifyRequestSchema,
  trackCancelRequestSchema,
  type CreateOrderResponse,
} from '@siparis/core';
import {
  cancellationRequests,
  customers,
  legalAcceptances,
  orderEvents,
  orders,
  otpVerifications,
  reviews,
  tenants,
  type Database,
} from '@siparis/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { smsOtpResponseSchema, smsVerifyResponseSchema, trackCancelResponseSchema } from '@siparis/core/orders/contracts';
import type { Config } from '../../config';
import { AppError, conflict, notFound } from '../../lib/errors';
import { enqueueJob } from '../../lib/jobs';
import { RATE_LIMITS, clientIp, createRateLimiter, enforceRateLimit } from '../../lib/rate-limit';
import { generateNumericCode, hmacSha256Hex, safeEqual } from '../../lib/tokens';
import { parseTrackingToken, trackingUrl } from '../../lib/tracking';
import {
  attachCustomerFromLink,
  insertOrderWithItems,
  rememberAddress,
  upsertCustomerByPhone,
  type CustomerRow,
} from '../../services/orders/create-order';
import { fieldError, validatePayment } from '../../services/orders/payment';
import { quoteForBranch, toQuoteResponse } from '../../services/orders/pricing-context';
import {
  computeBranchOrderingState,
  loadStoreBySlug,
  tenantOrderingBlocked,
  type TenantRow,
} from '../../services/orders/store-context';
import { readLinkToken, setCustomerCookie, type LinkTokenRow } from '../../services/orders/storefront-cookies';
import { emitOrderUpdated, type OrderRow } from '../../services/orders/summary';
import { buildTrackView, isTrackingExpired, trackResponseExtSchema } from '../../services/orders/tracking-view';
import { transitionOrder } from '../../services/orders/transition';
import {
  buildWaLink,
  createVerificationCode,
  findVerificationCode,
  loadVerificationChannels,
} from '../../services/orders/verification';

const slugParams = z.object({ slug: z.string().min(2).max(60) });
const orderIdParams = z.object({ orderId: z.uuid() });
const tokenParams = z.object({ token: z.string().min(10).max(64) });

/** SMS OTP: 5 dk geçerli, 5 deneme, 60 sn'de bir yeniden gönderim (03 §3.2.1). */
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_MS = 60_000;
/** Akış A: token başına saatte en çok 3 sipariş (03 §3.1). */
const LINK_TOKEN_ORDERS_PER_HOUR = 3;


function orderingClosed(details?: Record<string, unknown>): AppError {
  return conflict('ordering_closed', 'İşletme şu an sipariş almıyor. Sepetiniz saklandı.', details);
}

/** Sipariş yanıtını (ilk istek ve idempotent tekrar) mevcut durumdan kurar. */
async function buildCreateResponse(db: Database, config: Config, tenant: TenantRow, order: OrderRow): Promise<CreateOrderResponse> {
  const url = trackingUrl(config.APP_BASE_URL, order.id, config.TRACKING_SECRET);
  if (order.status !== 'awaiting_customer') {
    return { orderId: order.id, number: order.number, status: order.status, trackingUrl: url, verification: { required: false, smsAvailable: false } };
  }
  const channels = await loadVerificationChannels(db, tenant, order.branchId);
  const code = channels.waConnected ? await findVerificationCode(db, tenant.id, order.id) : undefined;
  if (code && channels.waDisplayPhone) {
    return {
      orderId: order.id,
      number: order.number,
      status: order.status,
      trackingUrl: url,
      verification: {
        required: true,
        method: 'wa_code',
        waLink: buildWaLink(channels.waDisplayPhone, code.code),
        code: code.code,
        smsAvailable: channels.smsAvailable,
      },
    };
  }
  return {
    orderId: order.id,
    number: order.number,
    status: order.status,
    trackingUrl: url,
    verification: channels.smsAvailable
      ? { required: true, method: 'sms_otp', smsAvailable: true }
      : { required: true, smsAvailable: false },
  };
}

async function findByIdempotencyKey(db: Database, tenantId: string, key: string): Promise<OrderRow | undefined> {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.idempotencyKey, key)));
  return row;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

async function linkTokenUsable(db: Database, token: LinkTokenRow | null): Promise<LinkTokenRow | null> {
  if (!token) return null;
  const rows = (await db.execute(sql`
    select count(*)::int as n from orders
     where link_token_id = ${token.id} and placed_at > now() - interval '1 hour'`)) as unknown as { n: number }[];
  return Number(rows[0]?.n ?? 0) >= LINK_TOKEN_ORDERS_PER_HOUR ? null : token;
}

/** Takip token'ı → sipariş + işletme; geçersiz 404, süresi dolmuş 410 (kişisel veri yok). */
async function loadTracked(db: Database, config: Config, token: string, opts: { allowExpired?: boolean } = {}) {
  const orderId = parseTrackingToken(token, config.TRACKING_SECRET);
  if (!orderId) throw notFound('Takip bağlantısı geçersiz.');
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw notFound('Takip bağlantısı geçersiz.');
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, order.tenantId));
  if (!tenant) throw notFound('Takip bağlantısı geçersiz.');
  if (!opts.allowExpired && isTrackingExpired(order)) {
    throw new AppError(410, 'tracking_link_expired', 'Bu takip bağlantısının süresi doldu.', {
      business: { name: tenant.name, phone: tenant.phone, slug: tenant.slug },
    });
  }
  return { order, tenant };
}

function noStore(reply: { header: (k: string, v: string) => unknown }) {
  reply.header('cache-control', 'no-store');
  reply.header('x-robots-tag', 'noindex, nofollow');
  reply.header('referrer-policy', 'no-referrer');
}

const routes: FastifyPluginAsyncZod = async (app) => {
  const ipLimiter = createRateLimiter(RATE_LIMITS.storeOrderPerIp);
  const phoneLimiter = createRateLimiter(RATE_LIMITS.storeOrderPerPhone);
  const otpPhoneLimiter = createRateLimiter(RATE_LIMITS.otpPerPhone);
  const otpPhoneDayLimiter = createRateLimiter({ limit: 5, windowMs: 24 * 60 * 60_000 });
  const otpIpLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60_000 });
  const quoteLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });
  const verifyIpLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60_000 });

  // -------------------------------------------------------------------------
  // POST /store/:slug/quote — sepet doğrulama ve fiyat (sunucuda)
  app.post(
    '/:slug/quote',
    { schema: { params: slugParams, body: quoteRequestSchema, response: { 200: quoteResponseSchema } } },
    async (request) => {
      enforceRateLimit(quoteLimiter, clientIp(request));
      const store = await loadStoreBySlug(app.db, request.params.slug);
      if (!store) throw notFound('İşletme bulunamadı.');
      const { quote } = await quoteForBranch(app.db, { tenantId: store.tenant.id, branch: store.branch, request: request.body });
      return toQuoteResponse(quote);
    },
  );

  // -------------------------------------------------------------------------
  // POST /store/:slug/orders — sipariş oluşturma (Akış A çerezli / Akış B doğrulamalı)
  app.post(
    '/:slug/orders',
    { schema: { params: slugParams, body: createOrderRequestSchema, response: { 200: createOrderResponseSchema } } },
    async (request, reply) => {
      const body = request.body;
      const store = await loadStoreBySlug(app.db, request.params.slug);
      if (!store) throw notFound('İşletme bulunamadı.');
      const { tenant, branch } = store;

      // Aynı anahtar → aynı yanıt (çift dokunuş / ağ tekrarı, 03 K13)
      const existing = await findByIdempotencyKey(app.db, tenant.id, body.idempotencyKey);
      if (existing) {
        if (existing.customerId && body.rememberDevice === true) setCustomerCookie(reply, app.config, tenant.slug, existing.customerId);
        return buildCreateResponse(app.db, app.config, tenant, existing);
      }

      const now = new Date();
      const token = await linkTokenUsable(app.db, await readLinkToken(app.db, request, tenant.slug, tenant.id, now));
      // Akış A gel-al: telefon boşsa WhatsApp bağlantısındaki müşterinin numarası (03 §4.4); paket ve Akış B'de zorunlu
      let rawPhone = body.customerPhone;
      if (!rawPhone && token?.customerId && body.fulfillmentType === 'pickup') {
        const [known] = await app.db
          .select({ phone: customers.phoneE164 })
          .from(customers)
          .where(and(eq(customers.id, token.customerId), eq(customers.tenantId, tenant.id)));
        rawPhone = known?.phone ?? undefined;
      }
      const phone = normalizePhone(rawPhone);
      if (!phone) throw fieldError('customerPhone', 'Telefon numarası 10 haneli olmalı (5xx xxx xx xx).');
      enforceRateLimit(ipLimiter, clientIp(request));
      enforceRateLimit(phoneLimiter, phone);

      if (tenantOrderingBlocked(tenant)) throw orderingClosed({ orderingState: 'paused' });
      const state = await computeBranchOrderingState(app.db, branch, now);
      if (!acceptsOrders(state.state)) {
        throw orderingClosed({ orderingState: state.state, nextOpenAt: state.nextOpenAt?.toISOString() ?? null });
      }

      if (body.fulfillmentType === 'delivery' && (!body.addressLine || body.addressLine.trim().length < 5)) {
        throw fieldError('addressLine', 'Teslimat adresini yazın (sokak, bina no, daire).');
      }

      const { quote, zoneMatch } = await quoteForBranch(app.db, { tenantId: tenant.id, branch, request: body, now });
      if (!quote.ok) {
        throw new AppError(422, 'cart_invalid', quote.problems[0]?.message ?? 'Sepetinizi kontrol edin.', { problems: quote.problems });
      }
      validatePayment(branch, body, quote.totalKurus);

      const channels = token ? null : await loadVerificationChannels(app.db, tenant, branch.id);
      const flowA = Boolean(token);
      const waCode = !flowA && Boolean(channels?.waConnected);
      const statusNotifyChannel = flowA || waCode ? 'whatsapp' : channels?.smsAvailable ? 'sms' : 'none';

      let order: OrderRow;
      try {
        order = await app.db.transaction(async (tx) => {
          let customer: CustomerRow | undefined;
          if (token?.customerId) customer = await attachCustomerFromLink(tx, tenant.id, token.customerId, phone, body.customerName);
          customer ??= await upsertCustomerByPhone(tx, tenant.id, phone, body.customerName);
          if (customer.isBlocked) {
            throw new AppError(403, 'ordering_unavailable', 'Şu an çevrimiçi sipariş alamıyoruz, lütfen işletmeyi arayın.');
          }
          const neighborhood = zoneMatch?.neighborhood ?? body.neighborhood?.trim() ?? null;
          if (body.fulfillmentType === 'delivery') {
            await rememberAddress(tx, {
              tenantId: tenant.id,
              customerId: customer.id,
              neighborhood,
              addressLine: body.addressLine?.trim() ?? null,
              directions: body.directions?.trim() || null,
              lat: body.lat ?? null,
              lng: body.lng ?? null,
            });
          }
          const cash = body.paymentMethod === 'cash_on_delivery';
          const created = await insertOrderWithItems(
            tx,
            {
              tenantId: tenant.id,
              branchId: branch.id,
              status: flowA ? 'new' : 'awaiting_customer',
              channel: flowA ? 'wa_link' : 'web',
              fulfillmentType: body.fulfillmentType,
              quote,
              zone: zoneMatch ? { id: zoneMatch.zone.id, name: zoneMatch.zone.name } : null,
              neighborhood: body.fulfillmentType === 'delivery' ? neighborhood : null,
              addressLine: body.fulfillmentType === 'delivery' ? (body.addressLine?.trim() ?? null) : null,
              directions: body.fulfillmentType === 'delivery' ? body.directions?.trim() || null : null,
              lat: body.fulfillmentType === 'delivery' ? (body.lat ?? null) : null,
              lng: body.fulfillmentType === 'delivery' ? (body.lng ?? null) : null,
              customerId: customer.id,
              customerName: body.customerName.trim(),
              customerPhone: phone,
              paymentMethod: body.paymentMethod,
              mealCardBrand: body.paymentMethod === 'meal_card_on_delivery' ? (body.mealCardBrand ?? null) : null,
              changeForKurus: cash && body.changeForKurus ? body.changeForKurus : null,
              wantsCutlery: body.wantsCutlery,
              note: body.note?.trim() || null,
              verificationMethod: flowA ? 'wa_link' : null,
              verifiedAt: flowA ? now : null,
              conversationId: token?.conversationId ?? null,
              linkTokenId: token?.id ?? null,
              idempotencyKey: body.idempotencyKey,
              confirmationIp: clientIp(request),
              confirmationUserAgent: request.headers['user-agent'] ?? null,
              statusNotifyChannel,
              // Konumsuz seçilen poligon/yarıçap bölgesi: ücret/minimum müşteri beyanına dayanır (kartta işaretli)
              ...(body.fulfillmentType === 'delivery' && zoneMatch?.declared ? { sourceMeta: { zoneDeclared: true } } : {}),
            },
            { type: 'customer' },
          );
          await tx.insert(legalAcceptances).values(
            (['on_bilgilendirme', 'mesafeli_satis'] as const).map((document) => ({
              tenantId: tenant.id,
              orderId: created.id,
              document,
              version: LEGAL_DOCUMENT_VERSION,
              ip: clientIp(request),
              userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
            })),
          );
          if (waCode) await createVerificationCode(tx, tenant.id, created.id, now);
          return created;
        });
      } catch (err) {
        // Eşzamanlı aynı anahtar: ilk kaydın yanıtını döndür
        if (isUniqueViolation(err)) {
          const dup = await findByIdempotencyKey(app.db, tenant.id, body.idempotencyKey);
          if (dup) return buildCreateResponse(app.db, app.config, tenant, dup);
        }
        throw err;
      }

      // "Bu cihazda hatırla" yalnız açık seçimle (03 §4.4 opt-in): işaretsizse çerez yazılmaz
      if (order.customerId && body.rememberDevice === true) setCustomerCookie(reply, app.config, tenant.slug, order.customerId);
      request.log.info({ orderId: order.id, number: order.number, flow: flowA ? 'A' : 'B', status: order.status }, 'storefront siparişi');
      return buildCreateResponse(app.db, app.config, tenant, order);
    },
  );

  // -------------------------------------------------------------------------
  // POST /store/orders/:orderId/sms-otp — WhatsApp'sız mod doğrulama kodu (03 §3.2.1)
  app.post(
    '/orders/:orderId/sms-otp',
    { schema: { params: orderIdParams, body: smsOtpRequestSchema, response: { 200: smsOtpResponseSchema } } },
    async (request) => {
      const [order] = await app.db.select().from(orders).where(eq(orders.id, request.params.orderId));
      if (!order) throw notFound('Sipariş bulunamadı.');
      if (order.status !== 'awaiting_customer') throw conflict('not_awaiting_verification', 'Bu sipariş doğrulama beklemiyor.');
      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, order.tenantId));
      const channels = await loadVerificationChannels(app.db, tenant!, order.branchId);
      if (!channels.smsAvailable) throw conflict('sms_unavailable', 'SMS ile doğrulama şu an kullanılamıyor. Lütfen işletmeyi arayın.');

      const raw = request.body.phone.trim();
      const phone = normalizeTrMobile(raw);
      if (!phone) {
        const foreign = raw.startsWith('+') && !raw.replace(/\s/g, '').startsWith('+90');
        throw fieldError(
          'phone',
          foreign
            ? 'Yabancı numaralara SMS gönderemiyoruz. WhatsApp ile doğrulayabilir ya da işletmeyi arayabilirsiniz.'
            : 'Cep telefonu numarası 10 haneli olmalı (5xx xxx xx xx).',
          foreign ? 'foreign_phone' : 'validation_error',
        );
      }

      const [last] = await app.db
        .select()
        .from(otpVerifications)
        .where(eq(otpVerifications.orderId, order.id))
        .orderBy(desc(otpVerifications.createdAt))
        .limit(1);
      if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_MS) {
        const wait = Math.ceil((OTP_RESEND_MS - (Date.now() - last.createdAt.getTime())) / 1000);
        throw new AppError(429, 'rate_limited', `Yeni kod için ${wait} sn bekleyin.`, { retryAfterSec: wait });
      }
      enforceRateLimit(otpIpLimiter, clientIp(request));
      enforceRateLimit(otpPhoneLimiter, phone);
      enforceRateLimit(otpPhoneDayLimiter, phone);

      const code = generateNumericCode(6);
      const expiresAt = new Date(Date.now() + OTP_TTL_MS);
      await app.db.transaction(async (tx) => {
        await tx.insert(otpVerifications).values({
          tenantId: order.tenantId,
          orderId: order.id,
          phoneE164: phone,
          codeHash: hmacSha256Hex(app.config.SESSION_SECRET, `otp:${order.id}:${code}`),
          expiresAt,
        });
        await enqueueJob(tx, {
          queue: 'notify',
          type: 'sms.send',
          tenantId: order.tenantId,
          payload: {
            tenantId: order.tenantId,
            orderId: order.id,
            to: phone,
            body: sms01Otp({ isletme: tenant!.name, kod: code }),
            purpose: 'otp',
            countsTowardQuota: true,
          },
        });
      });
      return { ok: true as const, phoneMasked: maskPhone(phone), expiresAt: expiresAt.toISOString(), resendAfterSec: 60 };
    },
  );

  // POST /store/orders/:orderId/sms-verify — kod doğruysa awaiting_customer → new (verification_method sms_otp)
  app.post(
    '/orders/:orderId/sms-verify',
    { schema: { params: orderIdParams, body: smsVerifyRequestSchema, response: { 200: smsVerifyResponseSchema } } },
    async (request) => {
      enforceRateLimit(verifyIpLimiter, clientIp(request));
      const [order] = await app.db.select().from(orders).where(eq(orders.id, request.params.orderId));
      if (!order) throw notFound('Sipariş bulunamadı.');
      const url = trackingUrl(app.config.APP_BASE_URL, order.id, app.config.TRACKING_SECRET);
      if (order.status !== 'awaiting_customer') {
        if (order.verificationMethod === 'sms_otp') return { ok: true as const, status: order.status, trackingUrl: url };
        throw conflict('not_awaiting_verification', 'Bu sipariş doğrulama beklemiyor.');
      }
      const [otp] = await app.db
        .select()
        .from(otpVerifications)
        .where(and(eq(otpVerifications.orderId, order.id), sql`${otpVerifications.verifiedAt} is null`))
        .orderBy(desc(otpVerifications.createdAt))
        .limit(1);
      if (!otp || otp.expiresAt.getTime() <= Date.now()) {
        throw new AppError(410, 'code_expired', 'Kodun süresi doldu. Yeni kod isteyin.');
      }
      if (otp.attempts >= OTP_MAX_ATTEMPTS) {
        throw new AppError(422, 'code_locked', 'Çok fazla hatalı deneme yapıldı. Yeni kod isteyin.');
      }
      const expected = hmacSha256Hex(app.config.SESSION_SECRET, `otp:${order.id}:${request.body.code}`);
      if (!safeEqual(expected, otp.codeHash)) {
        const [u] = await app.db
          .update(otpVerifications)
          .set({ attempts: sql`${otpVerifications.attempts} + 1` })
          .where(eq(otpVerifications.id, otp.id))
          .returning({ attempts: otpVerifications.attempts });
        const left = Math.max(0, OTP_MAX_ATTEMPTS - (u?.attempts ?? OTP_MAX_ATTEMPTS));
        if (left === 0) throw new AppError(422, 'code_locked', 'Çok fazla hatalı deneme yapıldı. Yeni kod isteyin.');
        throw new AppError(422, 'invalid_code', `Kod hatalı. ${left} deneme hakkınız kaldı.`, { remainingAttempts: left });
      }
      const result = await app.db.transaction(async (tx) => {
        await tx.update(otpVerifications).set({ verifiedAt: new Date() }).where(eq(otpVerifications.id, otp.id));
        return transitionOrder(tx, {
          orderId: order.id,
          tenantId: order.tenantId,
          to: 'new',
          actor: { type: 'customer' },
          extra: { verificationMethod: 'sms_otp', verifiedAt: new Date(), customerPhone: otp.phoneE164, statusNotifyChannel: 'sms' },
        });
      });
      return { ok: true as const, status: result.order.status, trackingUrl: url };
    },
  );

  // -------------------------------------------------------------------------
  // GET /store/track/:token — takip sayfası (03 §7)
  app.get('/track/:token', { schema: { params: tokenParams, response: { 200: trackResponseExtSchema } } }, async (request, reply) => {
    noStore(reply);
    const { order, tenant } = await loadTracked(app.db, app.config, request.params.token);
    return buildTrackView(app.db, { order, tenant });
  });

  // POST /store/track/:token/cancel — new/awaiting → doğrudan iptal; accepted+ → iptal talebi (03 §7.4)
  app.post(
    '/track/:token/cancel',
    { schema: { params: tokenParams, body: trackCancelRequestSchema.optional(), response: { 200: trackCancelResponseSchema } } },
    async (request, reply) => {
      noStore(reply);
      const { order } = await loadTracked(app.db, app.config, request.params.token);
      const note = request.body?.reason?.trim() || null;
      // Karar satır kilidi altında verilir: işletme aynı anda onayladıysa doğrudan iptal değil iptal talebi olur
      // (00 §7: accepted ve sonrasında müşteri yalnız iptal talebi gönderir).
      return app.db.transaction(async (tx) => {
        const [locked] = await tx.select().from(orders).where(eq(orders.id, order.id)).for('update');
        if (!locked) throw notFound('Sipariş bulunamadı.');
        if (locked.status === 'awaiting_customer' || locked.status === 'new') {
          const r = await transitionOrder(tx, {
            orderId: locked.id,
            tenantId: locked.tenantId,
            to: 'cancelled',
            actor: { type: 'customer' },
            cancelledBy: 'customer',
            reason: 'customer_request',
            note,
            expectedVersion: locked.version,
          });
          return { result: 'cancelled' as const, status: r.order.status };
        }
        if (locked.status === 'accepted' || locked.status === 'preparing' || locked.status === 'ready' || locked.status === 'on_the_way') {
          const inserted = await tx
            .insert(cancellationRequests)
            .values({ tenantId: locked.tenantId, orderId: locked.id, reason: note })
            .onConflictDoNothing()
            .returning({ id: cancellationRequests.id });
          if (!inserted.length) throw conflict('cancel_request_exists', 'İptal talebiniz zaten iletildi.');
          const [updated] = await tx
            .update(orders)
            .set({ cancelRequestedAt: new Date(), version: locked.version + 1 })
            .where(eq(orders.id, locked.id))
            .returning();
          await tx.insert(orderEvents).values({
            tenantId: locked.tenantId,
            orderId: locked.id,
            type: 'cancel_requested',
            actorType: 'customer',
            note,
            data: { requestId: inserted[0]!.id },
          });
          await emitOrderUpdated(tx, { order: updated!, change: 'cancel_request' });
          return { result: 'requested' as const, status: locked.status };
        }
        throw conflict('invalid_transition', 'Bu sipariş artık iptal edilemez.');
      });
    },
  );

  // POST /store/track/:token/review — yalnız delivered, tek sefer (03 §7.5)
  app.post(
    '/track/:token/review',
    { schema: { params: tokenParams, body: reviewRequestSchema, response: { 200: okResponseSchema } } },
    async (request, reply) => {
      noStore(reply);
      const { order } = await loadTracked(app.db, app.config, request.params.token);
      if (order.status !== 'delivered') throw conflict('review_not_allowed', 'Teslim edilmemiş sipariş değerlendirilemez.');
      await app.db.transaction(async (tx) => {
        const rows = await tx
          .insert(reviews)
          .values({
            tenantId: order.tenantId,
            orderId: order.id,
            customerId: order.customerId,
            rating: request.body.rating,
            comment: request.body.comment?.trim() || null,
          })
          .onConflictDoNothing()
          .returning({ id: reviews.id });
        if (!rows.length) throw conflict('review_exists', 'Bu sipariş zaten değerlendirildi. Teşekkür ederiz.');
        await tx.insert(orderEvents).values({
          tenantId: order.tenantId,
          orderId: order.id,
          type: 'reviewed',
          actorType: 'customer',
          reason: request.body.rating,
        });
        if (request.body.rating === 'bad') await emitOrderUpdated(tx, { order, change: 'review_bad' });
      });
      return { ok: true as const };
    },
  );
};

export default routes;

