// Herkese açık uç noktalar (14 §6.5) — dilim 5.
// GET /public/signup-status: yeni işletme kaydı açık mı (signup_open; 00 §12a madde 10). Kayıt sayfası sunucu tarafında
// sorar; kapalıysa form yerine "Kayıtlar çok yakında açılıyor" bilgisini gösterir. Kişisel veri içermez.
// GET /public/menu-link/:token: WhatsApp'taki kısa menü bağlantısının (/m/<token>) dükkan adresi; token tüketilmez.
// GET /public/q/:code: QR kısa bağlantısının (yemekgelsin.net/q/<kod>; 00 §12a madde 11, O4) dükkan adresi. Kod
// büyük/küçük harf duyarsız; bilinmeyen kod 404; yanıt yalnız slug; IP (IPv6 /64) başına dakikada 60 (web sunucusu müşterinin
// X-Forwarded-For'unu iletir). Sipariş almayan işletmede de slug döner (vitrin bandı gösterir).
// POST /public/leads: demo formu + hesaplayıcı lead'i (05 C.5.1, C.4.5). PUBLIC_LEADS_ENABLED=0 iken (operatörün formu
// geçici olarak kapattığı ortam; canlı ortamda açık, 00 §12a madde 10) hiçbir şey saklanmaz: 403 leads_closed. Bal küpü
// doluysa 204 (sessiz);
// IP başına saatte 5 istek; telefon E.164'e normalize edilir. Aynı telefonla açık lead varsa yenisi açılmaz,
// mevcut kayda eklenir (05 A-20 tekrar kontrolü).

import { publicLeadRequestSchema, publicLeadResponseSchema, publicSignupStatusResponseSchema } from '@siparis/core/admin/contracts';
import { normalizeTrMobile } from '@siparis/core';
import { leads } from '@siparis/db';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { isFlagEnabled } from '../../lib/flags';
import { clientIp, createRateLimiter, enforceRateLimit, rateLimitIp } from '../../lib/rate-limit';
import { findSlugByQrCode } from '../../services/storefront/qr';
import { findMenuLinkSlug } from '../../services/storefront/session';

/** 5 istek / saat / IP (görev tanımı). */
export const PUBLIC_LEAD_RATE_LIMIT = { limit: 5, windowMs: 60 * 60_000 } as const;
/**
 * QR kısa bağlantısı çözümlemesi: IP başına dakikada 60 (IPv6'da /64 öneki başına; rateLimitIp). Sınır yalnız kötüye
 * kullanımı (otomatik tarama, yük) YAVAŞLATIR; bir gizlilik güvencesi değildir: yanıt herkese açık vitrin slug'ıdır ve
 * kodlar slug'dan türediği için tahmin edilebilir (vitrin adresleri zaten herkese açıktır, 00 §12a madde 11).
 */
export const PUBLIC_QR_RATE_LIMIT = { limit: 60, windowMs: 60_000 } as const;
const MAX_CALCULATOR_JSON = 4000;

function validationError(path: string, message: string): AppError {
  return new AppError(400, 'validation_error', message, { issues: [{ path: `/${path}`, message }] });
}

const routes: FastifyPluginAsyncZod = async (app) => {
  const limiter = createRateLimiter(PUBLIC_LEAD_RATE_LIMIT);

  app.get('/signup-status', { schema: { response: { 200: publicSignupStatusResponseSchema } } }, async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { open: await isFlagEnabled(app.db, 'signup_open') };
  });

  // Kısa menü bağlantısı: IP başına dakikada 60 çözümleme (token tahmini zaten olanaksız: 72 bit)
  const menuLinkLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
  app.get(
    '/menu-link/:token',
    { schema: { params: z.object({ token: z.string().min(8).max(400) }), response: { 200: z.object({ slug: z.string() }) } } },
    async (request, reply) => {
      enforceRateLimit(menuLinkLimiter, `menu_link:${clientIp(request)}`);
      reply.header('cache-control', 'no-store');
      const slug = await findMenuLinkSlug(app.db, request.params.token, new Date());
      if (!slug) throw new AppError(404, 'not_found', 'Bağlantının süresi dolmuş ya da bağlantı geçersiz.');
      return { slug };
    },
  );

  // QR kısa bağlantısı (/q/<kod>): yalnız slug; bilinmeyen ya da biçimsiz kod 404 (hangi kodların var olduğu dışında bilgi yok)
  const qrLimiter = createRateLimiter(PUBLIC_QR_RATE_LIMIT);
  app.get(
    '/q/:code',
    { schema: { params: z.object({ code: z.string().min(1).max(64) }), response: { 200: z.object({ slug: z.string() }).strict() } } },
    async (request, reply) => {
      enforceRateLimit(qrLimiter, `qr_code:${rateLimitIp(request)}`);
      reply.header('cache-control', 'no-store');
      const slug = await findSlugByQrCode(app.db, request.params.code);
      if (!slug) throw new AppError(404, 'not_found', 'Bu QR kodu bir işletmeye ait değil.');
      return { slug };
    },
  );

  app.post(
    '/leads',
    {
      // Gövde işleyicide doğrulanır: bal küpü kontrolü doğrulamadan önce yapılmalı (bot hata ayrıntısı görmez).
      schema: { body: z.record(z.string(), z.unknown()), response: { 201: publicLeadResponseSchema, 204: z.null() } },
    },
    async (request, reply) => {
      if (!app.config.PUBLIC_LEADS_ENABLED) {
        throw new AppError(403, 'leads_closed', 'Başvuru formu şu an kapalı; bilgilerin kaydedilmedi. Bize WhatsApp ya da e-postayla ulaşabilirsin.');
      }
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
