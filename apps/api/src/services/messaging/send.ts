// `wa.send` işi: kuyruktaki giden mesajı sağlayıcıya gönderir ve messages.status'u günceller (02 §7.5, §10.1).
// Hata eşlemesi: 131047 → şablona düş; 131026 → teslim edilemez; 190 / 131042 → hesap 'error' + platform uyarısı
// (+ kritik durum için SMS yedeği); geçici hatalar → yeniden dene; tükenince 'failed'. Ortak numara satırı
// ('shared') platform sağlayıcısıyla gönderir (wa/registry.ts providerForAccount).

import { customers, conversations, messages, waAccounts, type Database } from '@siparis/db';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../../config';
import { enqueueJob } from '../../lib/jobs';
import { interactiveBody, templateBody, textBody } from '../../wa/cloud-body';
import { WaSendError, isWaSendError, waErrorSummary } from '../../wa/errors';
import { numberSlotKey, providerForAccount, toAccountRef } from '../../wa/registry';
import { acquireNumberSlot } from '../../wa/throttle';
import type { WaAccountRef, WaRecipient, WhatsAppProvider } from '../../wa/types';
import type { OutboundPayload, OutboundSpec } from './outbound';
import { rememberSharedTenant } from './shared-router';
import { renderTemplateBody } from './template-bodies';

export interface SendContext {
  db: Database;
  config: Config;
  log: FastifyBaseLogger;
  /** Bu deneme son deneme mi (geçici hatada 'failed' yazılır) */
  lastAttempt?: boolean;
}

export type SendOutcome = 'sent' | 'failed' | 'skipped';

export function recipientOf(c: { waBsuid: string | null; phoneE164: string | null }): WaRecipient | null {
  if (!c.phoneE164 && !c.waBsuid) return null;
  return { ...(c.phoneE164 ? { phone: c.phoneE164 } : {}), ...(c.waBsuid ? { bsuid: c.waBsuid } : {}) };
}

export function specRequestBody(to: WaRecipient, spec: OutboundSpec) {
  switch (spec.type) {
    case 'text':
      return textBody(to, spec.text);
    case 'interactive':
      return interactiveBody(to, spec.interactive);
    case 'template':
      return templateBody(to, spec.name, 'tr', spec.params, spec.buttons);
  }
}

export async function sendSpec(provider: WhatsAppProvider, acc: WaAccountRef, to: WaRecipient, spec: OutboundSpec): Promise<{ wamid: string }> {
  switch (spec.type) {
    case 'text':
      return provider.sendText(acc, to, spec.text);
    case 'interactive':
      return provider.sendInteractive(acc, to, spec.interactive);
    case 'template':
      return provider.sendTemplate(acc, to, spec.name, 'tr', spec.params, spec.buttons);
  }
}

async function markFailed(db: Database, messageId: string, payload: OutboundPayload, code: string, message: string): Promise<void> {
  await db
    .update(messages)
    .set({
      status: 'failed',
      errorCode: code.slice(0, 40),
      payload: { ...payload, error: { code, message: message.slice(0, 300) } } as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(messages.id, messageId));
}

async function enqueueSmsFallback(db: Database, tenantId: string, orderId: string | null, fb: OutboundPayload['smsFallback']): Promise<void> {
  if (!fb) return;
  await enqueueJob(db, {
    queue: 'notify',
    type: 'sms.send',
    payload: { tenantId, to: fb.to, body: fb.body, purpose: 'status', countsTowardQuota: true, ...(orderId ? { orderId } : {}) },
    dedupeKey: orderId ? `sms_fallback:${orderId}:${fb.body.length}:${fb.body.slice(0, 24)}` : null,
    tenantId,
  });
}

/** 190 / 131042: hesabı 'error' yap, işletme sahibine platform uyarısı. */
async function pauseAccount(db: Database, account: typeof waAccounts.$inferSelect, err: WaSendError): Promise<void> {
  const summary = waErrorSummary(err);
  await db.transaction(async (tx) => {
    await tx.update(waAccounts).set({ status: 'error', lastError: summary, updatedAt: new Date() }).where(eq(waAccounts.id, account.id));
    await enqueueJob(tx, {
      queue: 'notify',
      type: 'platform.alert',
      payload: {
        tenantId: account.tenantId,
        branchId: account.branchId,
        kind: err.action === 'account_payment' ? 'wa_payment_missing' : 'wa_disconnected',
        text: summary,
      },
      // Aynı gün aynı sebeple tek uyarı
      dedupeKey: `wa_pause_alert:${account.id}:${err.code}:${new Date().toISOString().slice(0, 10)}`,
      tenantId: account.tenantId,
    });
  });
}

/** Kuyruktaki giden mesajı gönderir. Geçici hatada (son deneme değilse) hata fırlatır → iş yeniden denenir. */
export async function performWaSend(ctx: SendContext, messageId: string): Promise<SendOutcome> {
  const { db, config, log } = ctx;
  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!msg || msg.direction !== 'out') return 'skipped';
  if (msg.status !== 'queued') return 'skipped'; // idempotent
  const payload = (msg.payload ?? {}) as unknown as OutboundPayload;
  if (!payload.spec) {
    await markFailed(db, msg.id, payload, 'invalid_payload', 'Gönderim bilgisi eksik');
    return 'failed';
  }
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, msg.conversationId));
  if (!conv) return 'skipped';
  const [account] = await db.select().from(waAccounts).where(eq(waAccounts.id, conv.waAccountId));
  const [customer] = await db.select().from(customers).where(eq(customers.id, conv.customerId));

  if (!account || account.status !== 'connected') {
    await markFailed(db, msg.id, payload, 'account_unavailable', 'WhatsApp hesabı bağlı değil ya da hatalı');
    await enqueueSmsFallback(db, msg.tenantId, msg.orderId, payload.smsFallback);
    return 'failed';
  }
  const to = customer ? recipientOf(customer) : null;
  if (!to) {
    await markFailed(db, msg.id, payload, 'no_recipient', 'Alıcı telefonu ya da BSUID yok');
    return 'failed';
  }

  const provider = providerForAccount(account, config);
  const ref = toAccountRef(account, config);
  const slotOk = await acquireNumberSlot(numberSlotKey(account));
  if (!slotOk) throw new Error('Numara hız sınırı: gönderim ertelendi');

  const attempt = async (spec: OutboundSpec) => {
    const { wamid } = await sendSpec(provider, ref, to, spec);
    await db
      .update(messages)
      .set({
        wamid,
        status: 'sent',
        kind: spec.type === 'template' ? 'template' : msg.kind,
        templateName: spec.type === 'template' ? spec.name : msg.templateName,
        body: spec.type === 'template' ? renderTemplateBody(spec.name, spec.params) : msg.body,
        errorCode: null,
        payload: { ...payload, spec, request: specRequestBody(to, spec), error: null } as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(messages.id, msg.id));
  };

  /** Ortak numara: dükkanın mesajı gitti → kişinin güncel dükkanı yoksa bu dükkan (yanıtı doğru dükkana gider). */
  const noteShared = async () => {
    if (account.provider !== 'shared') return;
    await rememberSharedTenant(db, to, account.tenantId).catch((e: unknown) => log.warn({ err: e, messageId: msg.id }, 'ortak numara yönlendirme kaydı güncellenemedi'));
  };

  try {
    await attempt(payload.spec);
    await noteShared();
    return 'sent';
  } catch (err) {
    if (!isWaSendError(err)) throw err;
    log.warn({ code: err.code, action: err.action, messageId: msg.id }, 'WhatsApp gönderim hatası');
    switch (err.action) {
      case 'window_closed': {
        if (payload.templateFallback && payload.spec.type !== 'template') {
          const tpl: OutboundSpec = { type: 'template', ...payload.templateFallback };
          try {
            await attempt(tpl);
            await noteShared();
            return 'sent';
          } catch (err2) {
            const e2 = isWaSendError(err2) ? err2 : new WaSendError('unknown', String(err2));
            await markFailed(db, msg.id, payload, e2.code, e2.message);
            return 'failed';
          }
        }
        await markFailed(db, msg.id, payload, err.code, waErrorSummary(err));
        return 'failed';
      }
      case 'account_token':
      case 'account_payment':
        // Ortak numara platformundur: işletmenin satırı duraklatılmaz, işletmeye "bağlantı sorunu" uyarısı gitmez
        if (account.provider === 'shared') log.error({ code: err.code, messageId: msg.id }, 'ortak numara hesabı hatası (platform)');
        else await pauseAccount(db, account, err);
        await markFailed(db, msg.id, payload, err.code, waErrorSummary(err));
        await enqueueSmsFallback(db, msg.tenantId, msg.orderId, payload.smsFallback);
        return 'failed';
      case 'retry':
        if (ctx.lastAttempt) {
          await markFailed(db, msg.id, payload, err.code, waErrorSummary(err));
          return 'failed';
        }
        throw err;
      default:
        await markFailed(db, msg.id, payload, err.code, waErrorSummary(err));
        return 'failed';
    }
  }
}
