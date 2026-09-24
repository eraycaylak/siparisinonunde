// WhatsApp webhook (14 §6.5: GET/POST /webhooks/wa/:webhookToken) — dilim 3. İmza için ham gövde gerekiyorsa bu eklentide addContentTypeParser kullanın.
// İskelet: ilgili dilim doldurur. Kimlik: requireTenantRole / requirePlatform (plugins/auth.ts).

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

const routes: FastifyPluginAsyncZod = async (_app) => {
  // Dilim bu eklentiye rotalarını ekler.
};

export default routes;
