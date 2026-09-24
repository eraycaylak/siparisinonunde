// Panel ayarlar: tenant, şubeler, saatler, özel günler, duraklatma, bölgeler (14 §6.3 Ayarlar) — dilim 4.
// İskelet: ilgili dilim doldurur. Kimlik: requireTenantRole / requirePlatform (plugins/auth.ts).

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

const routes: FastifyPluginAsyncZod = async (_app) => {
  // Dilim bu eklentiye rotalarını ekler.
};

export default routes;
