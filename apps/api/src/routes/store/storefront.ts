// Storefront vitrin (14 §6.2) — dilim 1:
//   GET    /store/:slug          vitrin (işletme, şube durumu, bölgeler, menü, künye)
//   POST   /store/:slug/session  Akış A link token'ı → sf_link_<slug> çerezi; müşteri + "Son siparişin"
//   DELETE /store/:slug/session  "Ben değilim" / "Bu cihazı unut": storefront çerezlerini siler
// Herkese açık; kişisel veri yalnız maskeli telefon ve ad olarak döner.

import { okResponseSchema, storeSessionRequestSchema } from '@siparis/core';
import { storefrontResponseSchema } from '@siparis/core';
import { storeSessionViewSchema, type StoreSessionView } from '@siparis/core/menu/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { clientIp, createRateLimiter, enforceRateLimit } from '../../lib/rate-limit';
import {
  clearStorefrontCookies,
  customerCookieName,
  linkCookieName,
  setLinkCookie,
  verifyCustomerCookie,
} from '../../services/storefront/cookies';
import { findTenantBySlug, loadStorefront } from '../../services/storefront/load';
import {
  customerDto,
  findTenantCustomer,
  findValidLinkToken,
  loadLastOrder,
  loadPrefill,
  markLinkTokenExchanged,
} from '../../services/storefront/session';

const slugParams = z.object({ slug: z.string().trim().min(1).max(64) });

const storeNotFound = () => new AppError(404, 'store_not_found', 'İşletme bulunamadı. Adresi kontrol edin.');

/** Vitrin yanıtı kısa süre önbelleklenebilir (kişisel veri yok); "tükendi" ≤ 15 sn'de yansır. */
const STOREFRONT_CACHE_CONTROL = 'public, max-age=15';

const storefrontRoutes: FastifyPluginAsyncZod = async (app) => {
  // Token tahmini pratikte imkânsız (32 bayt); yine de kaba kuvvete karşı IP başına sınır.
  const sessionLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

  app.get(
    '/:slug',
    { schema: { params: slugParams, response: { 200: storefrontResponseSchema } } },
    async (request, reply) => {
      const view = await loadStorefront(app.db, request.params.slug, new Date());
      if (!view) throw storeNotFound();
      reply.header('cache-control', STOREFRONT_CACHE_CONTROL);
      return view;
    },
  );

  app.post(
    '/:slug/session',
    {
      schema: {
        params: slugParams,
        body: storeSessionRequestSchema.nullish(),
        response: { 200: storeSessionViewSchema },
      },
    },
    async (request, reply) => {
      enforceRateLimit(sessionLimiter, `sf_session:${clientIp(request)}`);
      const tenant = await findTenantBySlug(app.db, request.params.slug);
      if (!tenant) throw storeNotFound();
      const now = new Date();
      const slug = tenant.slug;
      reply.header('cache-control', 'no-store');

      const bodyToken = request.body?.linkToken;
      const cookieToken = request.cookies?.[linkCookieName(slug)];
      let linkStatus: StoreSessionView['linkStatus'] = 'none';
      let linkCustomerId: string | null = null;

      if (bodyToken) {
        const row = await findValidLinkToken(app.db, tenant.id, bodyToken, now);
        if (row) {
          await markLinkTokenExchanged(app.db, row, now);
          setLinkCookie(reply, app.config, slug, bodyToken, row.expiresAt, now);
          linkStatus = 'active';
          linkCustomerId = row.customerId;
        } else {
          // Süresi dolmuş/geçersiz bağlantı: bağlamsız devam (Akış B); eski bağlantı çerezi de geçersiz sayılır.
          linkStatus = 'expired';
          if (cookieToken) reply.clearCookie(linkCookieName(slug), { httpOnly: true, sameSite: 'lax', secure: app.config.cookieSecure, path: '/' });
        }
      } else if (cookieToken) {
        const row = await findValidLinkToken(app.db, tenant.id, cookieToken, now);
        if (row) {
          linkStatus = 'active';
          linkCustomerId = row.customerId;
        } else {
          linkStatus = 'expired';
          reply.clearCookie(linkCookieName(slug), { httpOnly: true, sameSite: 'lax', secure: app.config.cookieSecure, path: '/' });
        }
      }

      const linkCustomer = await findTenantCustomer(app.db, tenant.id, linkCustomerId);
      let known = linkCustomer;
      let lastOrderSource: StoreSessionView['lastOrderSource'] = linkCustomer ? 'link' : null;
      if (!known) {
        const deviceCustomerId = verifyCustomerCookie(app.config.SESSION_SECRET, request.cookies?.[customerCookieName(slug)], {
          tenantId: tenant.id,
          slug,
        });
        const deviceCustomer = await findTenantCustomer(app.db, tenant.id, deviceCustomerId);
        if (deviceCustomer && !deviceCustomer.isBlocked) {
          known = deviceCustomer;
          lastOrderSource = 'device';
        }
      }
      const lastOrder = known ? await loadLastOrder(app.db, tenant.id, known.id) : null;
      const prefill = known && lastOrderSource ? await loadPrefill(app.db, known, lastOrderSource) : null;

      return {
        customer: linkCustomer ? customerDto(linkCustomer) : null,
        lastOrder,
        linkStatus,
        lastOrderSource: lastOrder ? lastOrderSource : null,
        prefill,
      };
    },
  );

  app.delete(
    '/:slug/session',
    { schema: { params: slugParams, response: { 200: okResponseSchema } } },
    async (request, reply) => {
      const tenant = await findTenantBySlug(app.db, request.params.slug);
      if (!tenant) throw storeNotFound();
      clearStorefrontCookies(reply, app.config, tenant.slug);
      reply.header('cache-control', 'no-store');
      return { ok: true as const };
    },
  );
};

export default storefrontRoutes;
