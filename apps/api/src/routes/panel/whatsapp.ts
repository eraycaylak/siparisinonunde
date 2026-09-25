// Panel WhatsApp bağlantısı (14 §6.3 WhatsApp; 04 P-25) — dilim 3. Yalnız owner (00 §4: manager WhatsApp bağlantısı hariç).
// GET /panel/whatsapp: bağlantı + sağlık; PUT: sağlayıcı ve kimlik bilgileri (API anahtarı AES-256-GCM ile şifreli);
// POST /panel/whatsapp/test: kendi numarasına (ya da verilen numaraya) test mesajı.
// POST /panel/whatsapp/disconnect: bağlantıyı keser (status 'disconnected', anahtar silinir, webhook belirteci yenilenir;
// satır geçmiş için kalır). POST /panel/whatsapp/rotate-webhook-token: yeni gizli webhook adresi (eskisi hemen geçersiz).

import { WA_ACCOUNT_STATUS_LABELS, WA_PROVIDER_LABELS, formatPhone, normalizePhone, normalizeTrMobile, waProviderSchema } from '@siparis/core';
import { conversations, messages, tenants, waAccounts, type Database } from '@siparis/db';
import { and, count, eq, gte, max, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit, auditActor } from '../../lib/audit';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { isFlagEnabled } from '../../lib/flags';
import { randomToken } from '../../lib/tokens';
import { defaultBranchId, requireTenantRole, tenantAuth, type TenantAuth } from '../../plugins/auth';
import { upsertConversation, upsertWaCustomer } from '../../services/messaging/customers';
import { previewText } from '../../services/messaging/outbound';
import { specRequestBody } from '../../services/messaging/send';
import { isWaSendError, waErrorSummary } from '../../wa/errors';
import { encryptorFor, getWaProvider, maskApiKey, toAccountRef, type WaAccountRow } from '../../wa/registry';

const accountDto = z.object({
  id: z.string(),
  branchId: z.string(),
  provider: waProviderSchema,
  providerLabel: z.string(),
  displayPhone: z.string().nullable(),
  displayPhoneFormatted: z.string().nullable(),
  phoneNumberId: z.string().nullable(),
  wabaId: z.string().nullable(),
  hasApiKey: z.boolean(),
  apiKeyMasked: z.string().nullable(),
  status: z.enum(['connected', 'disconnected', 'error']),
  statusLabel: z.string(),
  lastWebhookAt: z.string().nullable(),
  lastError: z.string().nullable(),
  webhookUrl: z.string(),
  updatedAt: z.string(),
});

const responseSchema = z.object({
  account: accountDto.nullable(),
  health: z.object({
    level: z.enum(['ok', 'warning', 'error', 'none']),
    message: z.string(),
    sentLast24h: z.number().int(),
    failedLast24h: z.number().int(),
    lastOutboundAt: z.string().nullable(),
    lastInboundAt: z.string().nullable(),
  }),
  smsFallback: z.object({ tenantEnabled: z.boolean(), platformEnabled: z.boolean(), active: z.boolean() }),
  providers: z.array(z.object({ value: waProviderSchema, label: z.string() })),
});

const putSchema = z.object({
  provider: waProviderSchema,
  displayPhone: z.string().min(1).max(32),
  phoneNumberId: z.string().trim().max(64).optional().nullable(),
  wabaId: z.string().trim().max(64).optional().nullable(),
  /** Boş/verilmezse mevcut anahtar korunur */
  apiKey: z.string().trim().max(1024).optional().nullable(),
});

function webhookUrl(app: FastifyInstance, token: string): string {
  return `${app.config.APP_BASE_URL.replace(/\/$/, '')}/api/v1/webhooks/wa/${token}`;
}

async function branchFor(app: FastifyInstance, auth: TenantAuth): Promise<string> {
  const id = auth.branchId ?? (await defaultBranchId(app.db, auth.tenantId));
  if (!id) throw notFound('Şube bulunamadı.');
  return id;
}

async function findAccount(db: Database, tenantId: string, branchId: string): Promise<WaAccountRow | undefined> {
  const [acc] = await db.select().from(waAccounts).where(and(eq(waAccounts.tenantId, tenantId), eq(waAccounts.branchId, branchId)));
  return acc;
}

async function buildResponse(app: FastifyInstance, tenantId: string, acc: WaAccountRow | undefined) {
  const [t] = await app.db.select({ smsFallbackEnabled: tenants.smsFallbackEnabled }).from(tenants).where(eq(tenants.id, tenantId));
  const platformEnabled = await isFlagEnabled(app.db, 'sms_fallback');
  let sent = 0;
  let failed = 0;
  let lastOutboundAt: Date | null = null;
  let lastInboundAt: Date | null = null;
  if (acc) {
    const since = new Date(Date.now() - 86_400_000);
    const rows = await app.db
      .select({
        direction: messages.direction,
        status: messages.status,
        n: count(),
        last: max(messages.createdAt),
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(messages.tenantId, tenantId), eq(conversations.waAccountId, acc.id), gte(messages.createdAt, since)))
      .groupBy(messages.direction, messages.status);
    for (const r of rows) {
      const last = r.last ? new Date(r.last) : null;
      if (r.direction === 'out') {
        if (r.status === 'failed') failed += Number(r.n);
        else if (r.status !== 'queued') sent += Number(r.n);
        if (last && (!lastOutboundAt || last > lastOutboundAt)) lastOutboundAt = last;
      } else if (last && (!lastInboundAt || last > lastInboundAt)) lastInboundAt = last;
    }
  }
  const apiKeyPlain = acc ? toAccountRef(acc, app.config).apiKey : null;
  let level: 'ok' | 'warning' | 'error' | 'none' = 'none';
  let message = 'WhatsApp numarası bağlı değil. Siparişler SMS doğrulamasıyla alınır (WhatsApp’sız mod).';
  if (acc) {
    if (acc.status === 'error') {
      level = 'error';
      message = acc.lastError ? `Bağlantıda sorun var: ${acc.lastError}` : 'Bağlantıda sorun var.';
    } else if (acc.status === 'disconnected') {
      level = 'warning';
      message = `WhatsApp bağlantısı kesik: müşterilere WhatsApp mesajı gitmez, gelen mesajlar alınmaz. ${
        acc.provider === 'mock' ? 'Yeniden bağlamak için bilgileri kaydedin.' : 'Yeniden bağlamak için API anahtarını girip kaydedin.'
      }`;
    } else if (failed > 0 && failed >= sent) {
      level = 'warning';
      message = 'Son 24 saatte gönderilemeyen mesajlar var.';
    } else {
      level = 'ok';
      message = acc.provider === 'mock' ? 'Simülatör bağlı (geliştirme).' : 'WhatsApp bağlı, mesajlar gidiyor.';
    }
  }
  const smsActive = (!acc || acc.status !== 'connected') && !!t?.smsFallbackEnabled && platformEnabled;
  return {
    account: acc
      ? {
          id: acc.id,
          branchId: acc.branchId,
          provider: acc.provider,
          providerLabel: WA_PROVIDER_LABELS[acc.provider],
          displayPhone: acc.displayPhone,
          displayPhoneFormatted: acc.displayPhone ? formatPhone(acc.displayPhone) : null,
          phoneNumberId: acc.phoneNumberId,
          wabaId: acc.wabaId,
          hasApiKey: !!acc.apiKeyEnc,
          apiKeyMasked: maskApiKey(apiKeyPlain) ?? (acc.apiKeyEnc ? '••••' : null),
          status: acc.status,
          statusLabel: WA_ACCOUNT_STATUS_LABELS[acc.status],
          lastWebhookAt: acc.lastWebhookAt?.toISOString() ?? null,
          lastError: acc.lastError,
          webhookUrl: webhookUrl(app, acc.webhookToken),
          updatedAt: acc.updatedAt.toISOString(),
        }
      : null,
    health: {
      level,
      message,
      sentLast24h: sent,
      failedLast24h: failed,
      lastOutboundAt: lastOutboundAt?.toISOString() ?? null,
      lastInboundAt: lastInboundAt?.toISOString() ?? null,
    },
    smsFallback: { tenantEnabled: !!t?.smsFallbackEnabled, platformEnabled, active: smsActive },
    providers: (['mock', 'd360', 'cloud'] as const).map((value) => ({ value, label: WA_PROVIDER_LABELS[value] })),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

const routes: FastifyPluginAsyncZod = async (app) => {
  const ownerOnly = requireTenantRole(['owner']);

  app.get('/whatsapp', { preHandler: ownerOnly, schema: { response: { 200: responseSchema } } }, async (request) => {
    const auth = tenantAuth(request);
    const branchId = await branchFor(app, auth);
    return buildResponse(app, auth.tenantId, await findAccount(app.db, auth.tenantId, branchId));
  });

  app.put('/whatsapp', { preHandler: ownerOnly, schema: { body: putSchema, response: { 200: responseSchema } } }, async (request) => {
    const auth = tenantAuth(request);
    const branchId = await branchFor(app, auth);
    const b = request.body;
    const displayPhone = normalizePhone(b.displayPhone) ?? (/^\+?\d{10,15}$/.test(b.displayPhone.replace(/[\s()-]/g, '')) ? `+${b.displayPhone.replace(/\D/g, '')}` : null);
    if (!displayPhone) throw badRequest('WhatsApp numarası geçersiz.', { issues: [{ path: '/displayPhone', message: 'WhatsApp numarası geçersiz.' }] });
    const existing = await findAccount(app.db, auth.tenantId, branchId);
    const apiKey = b.apiKey?.trim() || null;
    const hasKey = !!apiKey || !!existing?.apiKeyEnc;
    const phoneNumberId = b.phoneNumberId?.trim() || null;
    if (b.provider === 'cloud') {
      if (!phoneNumberId) throw badRequest('Meta Cloud API için telefon numarası kimliği (Phone number ID) gerekli.', { issues: [{ path: '/phoneNumberId', message: 'Telefon numarası kimliği gerekli.' }] });
      if (!hasKey) throw badRequest('Meta Cloud API için erişim anahtarı gerekli.', { issues: [{ path: '/apiKey', message: 'Erişim anahtarı gerekli.' }] });
    }
    if (b.provider === 'd360' && !hasKey) {
      throw badRequest('360dialog için API anahtarı gerekli.', { issues: [{ path: '/apiKey', message: 'API anahtarı gerekli.' }] });
    }
    const values = {
      provider: b.provider,
      displayPhone,
      phoneNumberId: b.provider === 'mock' ? (phoneNumberId ?? existing?.phoneNumberId ?? `mock-${randomToken(6)}`) : phoneNumberId,
      wabaId: b.wabaId?.trim() || null,
      ...(apiKey ? { apiKeyEnc: encryptorFor(app.config).encrypt(apiKey) } : {}),
      // Kimlik bilgisi değişti → hata temizlenir; gerçek durum ilk gönderimde/testte doğrulanır
      status: 'connected' as const,
      lastError: null,
      updatedAt: new Date(),
    };
    try {
      await app.db.transaction(async (tx) => {
        if (existing) {
          await tx.update(waAccounts).set(values).where(eq(waAccounts.id, existing.id));
        } else {
          await tx.insert(waAccounts).values({ tenantId: auth.tenantId, branchId, webhookToken: randomToken(24), ...values });
        }
        await audit(tx, {
          ...auditActor(request),
          action: existing ? 'whatsapp.account_update' : 'whatsapp.account_create',
          entityType: 'wa_account',
          entityId: existing?.id ?? null,
          data: { provider: b.provider, displayPhone, phoneNumberId: values.phoneNumberId, wabaId: values.wabaId, apiKeyChanged: !!apiKey },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('phone_number_taken', 'Bu telefon numarası kimliği başka bir hesapta kayıtlı.');
      throw err;
    }
    return buildResponse(app, auth.tenantId, await findAccount(app.db, auth.tenantId, branchId));
  });

  app.post(
    '/whatsapp/test',
    {
      preHandler: ownerOnly,
      schema: {
        body: z.object({ to: z.string().max(32).optional().nullable() }).optional(),
        response: { 200: z.object({ ok: z.literal(true), wamid: z.string(), to: z.string(), conversationId: z.string() }) },
      },
    },
    async (request) => {
      const auth = tenantAuth(request);
      const branchId = await branchFor(app, auth);
      const acc = await findAccount(app.db, auth.tenantId, branchId);
      if (!acc) throw conflict('wa_not_connected', 'Önce WhatsApp numaranızı kaydedin.');
      if (acc.status === 'disconnected') throw conflict('wa_not_connected', 'WhatsApp bağlantısı kesik. Önce bağlantı bilgilerinizi kaydedin.');
      const rawTo = request.body?.to?.trim() || auth.user.phone;
      const to = rawTo ? normalizeTrMobile(rawTo) : null;
      if (!to) throw badRequest('Test mesajı için geçerli bir cep telefonu girin.', { issues: [{ path: '/to', message: 'Cep telefonu geçersiz.' }] }, 'phone_required');
      const [tenant] = await app.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, auth.tenantId));
      const text = `Siparişin Önünde test mesajı: ${tenant?.name ?? 'İşletmeniz'} WhatsApp bağlantısı çalışıyor.`;
      const ref = toAccountRef(acc, app.config);
      try {
        const { wamid } = await getWaProvider(acc.provider).sendText(ref, { phone: to }, text);
        const conversationId = await app.db.transaction(async (tx) => {
          const customer = await upsertWaCustomer(tx, auth.tenantId, { phone: to });
          const conv = await upsertConversation(tx, acc, customer.id);
          await tx.insert(messages).values({
            tenantId: auth.tenantId,
            conversationId: conv.id,
            direction: 'out',
            wamid,
            kind: 'text',
            body: text,
            payload: { code: 'TEST', spec: { type: 'text', text }, request: specRequestBody({ phone: to }, { type: 'text', text }) },
            status: 'sent',
            sentBy: 'user',
            sentByUserId: auth.userId,
          });
          await tx
            .update(waAccounts)
            .set(acc.status === 'error' ? { status: 'connected', lastError: null, updatedAt: new Date() } : { updatedAt: new Date() })
            .where(eq(waAccounts.id, acc.id));
          await tx.update(conversations).set({ lastMessageAt: new Date(), lastMessagePreview: previewText(text) }).where(eq(conversations.id, conv.id));
          await audit(tx, { ...auditActor(request), action: 'whatsapp.test_message', entityType: 'wa_account', entityId: acc.id });
          return conv.id;
        });
        return { ok: true as const, wamid, to, conversationId };
      } catch (err) {
        if (!isWaSendError(err)) throw err;
        const summary = waErrorSummary(err);
        if (err.action === 'account_token' || err.action === 'account_payment') {
          await app.db.update(waAccounts).set({ status: 'error', lastError: summary, updatedAt: new Date() }).where(eq(waAccounts.id, acc.id));
        }
        const hint =
          err.action === 'window_closed'
            ? ' Önce bu numaradan işletme numaranıza bir mesaj yazın (24 saat kuralı), sonra tekrar deneyin.'
            : err.action === 'account_token'
              ? ' API anahtarını kontrol edip yeniden kaydedin.'
              : '';
        throw new AppError(502, 'wa_send_failed', `Test mesajı gönderilemedi: ${summary}.${hint}`, { code: err.code });
      }
    },
  );

  // POST /whatsapp/disconnect — bağlantıyı keser. Satır silinmez (sohbet/mesaj geçmişi ona bağlı); API anahtarı silinir,
  // numara kimliği serbest kalır (audit'te tutulur), webhook belirteci yenilenir (eski adres hemen 404). Sonuç:
  // vitrin whatsappPhone null, Akış B SMS OTP'ye düşer (açıksa), kuyruktaki gönderimler 'account_unavailable' ile
  // başarısız olur (services/messaging/send.ts), webhook bu hesap için olay kabul etmez (routes/webhooks/wa.ts).
  app.post('/whatsapp/disconnect', { preHandler: ownerOnly, schema: { response: { 200: responseSchema } } }, async (request) => {
    const auth = tenantAuth(request);
    const branchId = await branchFor(app, auth);
    const acc = await findAccount(app.db, auth.tenantId, branchId);
    if (!acc) throw conflict('wa_not_connected', 'Bağlı bir WhatsApp hesabı yok.');
    // Zaten kesik ve anahtarsız: tekrar istek bir şey değiştirmez
    if (acc.status !== 'disconnected' || acc.apiKeyEnc || acc.phoneNumberId) {
      await app.db.transaction(async (tx) => {
        await tx
          .update(waAccounts)
          .set({
            status: 'disconnected',
            apiKeyEnc: null,
            phoneNumberId: null,
            webhookToken: randomToken(24),
            lastError: null,
            version: sql`${waAccounts.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(waAccounts.id, acc.id), eq(waAccounts.tenantId, auth.tenantId)));
        await audit(tx, {
          ...auditActor(request),
          action: 'whatsapp.account_disconnect',
          entityType: 'wa_account',
          entityId: acc.id,
          data: { provider: acc.provider, displayPhone: acc.displayPhone, phoneNumberId: acc.phoneNumberId, wabaId: acc.wabaId, previousStatus: acc.status },
        });
      });
    }
    return buildResponse(app, auth.tenantId, await findAccount(app.db, auth.tenantId, branchId));
  });

  // POST /whatsapp/rotate-webhook-token — yeni gizli belirteç; eski adres hemen çalışmaz. Yeni adres yanıtta döner
  // (sağlayıcı paneline girilmesi gerekir); belirteç audit'e yazılmaz.
  app.post(
    '/whatsapp/rotate-webhook-token',
    { preHandler: ownerOnly, schema: { response: { 200: responseSchema.extend({ webhookUrl: z.string() }) } } },
    async (request) => {
      const auth = tenantAuth(request);
      const branchId = await branchFor(app, auth);
      const acc = await findAccount(app.db, auth.tenantId, branchId);
      if (!acc) throw conflict('wa_not_connected', 'Önce WhatsApp numaranızı kaydedin.');
      const token = randomToken(24);
      await app.db.transaction(async (tx) => {
        await tx
          .update(waAccounts)
          .set({ webhookToken: token, version: sql`${waAccounts.version} + 1`, updatedAt: new Date() })
          .where(and(eq(waAccounts.id, acc.id), eq(waAccounts.tenantId, auth.tenantId)));
        await audit(tx, { ...auditActor(request), action: 'whatsapp.webhook_token_rotate', entityType: 'wa_account', entityId: acc.id, data: { provider: acc.provider } });
      });
      const res = await buildResponse(app, auth.tenantId, await findAccount(app.db, auth.tenantId, branchId));
      return { ...res, webhookUrl: webhookUrl(app, token) };
    },
  );
};

export default routes;
