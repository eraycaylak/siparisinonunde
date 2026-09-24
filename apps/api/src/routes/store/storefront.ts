// Storefront vitrin (14 §6.2: GET /store/:slug, POST /store/:slug/session, POST /store/:slug/quote) — dilim 1.
// İskelet: ilgili dilim doldurur. Kimlik: requireTenantRole / requirePlatform (plugins/auth.ts).

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

const routes: FastifyPluginAsyncZod = async (_app) => {
  // Dilim bu eklentiye rotalarını ekler.
};

export default routes;
