// Herkese açık uç noktalar (14 §6.5) — dilim 5.
// POST /public/leads: demo formu + hesaplayıcı lead'i (05 C.5.1, C.4.5). Bal küpü doluysa 204 (sessiz);
// IP başına saatte 5 istek; telefon E.164'e normalize edilir. Aynı telefonla açık lead varsa yenisi açılmaz,
// mevcut kayda eklenir (05 A-20 tekrar kontrolü).

import { publicLeadRequestSchema, publicLeadResponseSchema } from '@siparis/core/admin/contracts';
import { normalizeTrMobile } from '@siparis/core';
import { leads } from '@siparis/db';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { clientIp, createRateLimiter, enforceRateLimit } from '../../lib/rate-limit';

/** 5 istek / saat / IP (görev tanımı). */
export const PUBLIC_LEAD_RATE_LIMIT = { limit: 5, windowMs: 60 * 60_000 } as const;
const MAX_CALCULATOR_JSON = 4000;

function validationError(path: string, message: string): AppError {
  return new AppError(400, 'validation_error', message, { issues: [{ path: `/${path}`, message }] });
}

const routes: FastifyPluginAsyncZod = async (app) => {
  const limiter = createRateLimiter(PUBLIC_LEAD_RATE_LIMIT);

  app.post(
    '/leads',
    {
      // Gövde işleyicide doğrulanır: bal küpü kontrolü doğrulamadan önce yapılmalı (bot hata ayrıntısı görmez).
      schema: { body: z.record(z.string(), z.unknown()), response: { 201: publicLeadResponseSchema, 204: z.null() } },
    },
    async (request, reply) => {
      const raw = request.body ?? {};
      if (typeof raw.website === 'string' && raw.website.trim() !== '') {
        request.log.info({ honeypot: true }, 'lead bal küpü doldu; sessizce atlandı');
        return reply.status(204).send(null);
      }
      enforceRateLimit(limiter, `lead:${clientIp(request)}`);

      const parsed = publicLeadRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({ path: `/${i.path.join('/')}`, message: i.message }));
        throw new AppError(400, 'validation_error', issues[0]?.message ?? 'Gönderilen bilgiler geçersiz.', { issues });
      }
      const body = parsed.data;
      const phone = normalizeTrMobile(body.phone);
      if (!phone) throw validationError('phone', 'Geçerli bir cep telefonu yaz (0 5xx xxx xx xx).');
      if (body.calculatorInput && JSON.stringify(body.calculatorInput).length > MAX_CALCULATOR_JSON) {
        throw validationError('calculatorInput', 'Hesaplayıcı bilgisi çok büyük.');
      }

      const extras = [
        body.district && !body.notes?.includes(body.district) ? `İlçe: ${body.district}` : null,
        body.waOptIn !== undefined && !body.notes?.includes('WhatsApp') ? `WhatsApp'tan yazılabilir: ${body.waOptIn ? 'evet' : 'hayır'}` : null,
      ].filter(Boolean);
      const notes = [body.notes, ...extras].filter(Boolean).join(' · ') || null;

      await app.db.transaction(async (tx) => {
        const [open] = await tx
          .select()
          .from(leads)
          .where(and(eq(leads.phone, phone), notInArray(leads.status, ['won', 'lost'])))
          .orderBy(desc(leads.createdAt))
          .limit(1)
          .for('update');
        if (open) {
          const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
          const appended = [open.notes, `[${stamp} UTC tekrar talep · ${body.source}] ${body.businessName}${notes ? ` · ${notes}` : ''}`]
            .filter(Boolean)
            .join('\n')
            .slice(-8000);
          await tx
            .update(leads)
            .set({
              notes: appended,
              ...(body.calculatorInput ? { calculatorInput: body.calculatorInput } : {}),
              ...(body.email && !open.email ? { email: body.email.toLowerCase() } : {}),
            })
            .where(eq(leads.id, open.id));
          return;
        }
        await tx.insert(leads).values({
          name: body.name,
          businessName: body.businessName,
          phone,
          email: body.email?.toLowerCase() ?? null,
          city: body.city,
          source: body.source,
          calculatorInput: body.calculatorInput ?? null,
          status: 'new',
          notes,
        });
      });

      reply.status(201);
      return { ok: true as const };
    },
  );
};

export default routes;
