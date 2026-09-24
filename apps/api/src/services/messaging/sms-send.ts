// `sms.send` işi: SMS sağlayıcısı (mock | netgsm), sms_messages kaydı, kota sayacı (00 §4).
// Kota aşımında SMS yine gönderilir, işletmeye notifications'ta uyarı düşer (ayda bir; %80'de ön uyarı).
// sms_fallback kill-switch'i kapalıysa OTP ve durum SMS'leri gönderilmez (alarm SMS'i etkilenmez).

import { maskPhone, normalizePhone, type SmsPurpose } from '@siparis/core';
import { notifications, smsMessages, type Database } from '@siparis/db';
import { and, eq, gte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../../config';
import { isFlagEnabled } from '../../lib/flags';
import { getSmsProvider } from '../../sms/index';
import { SmsSendError } from '../../sms/providers/netgsm';
import { monthStart, smsQuotaForTenant, smsUsageThisMonth } from '../../sms/quota';

export interface SmsSendPayload {
  tenantId: string | null;
  to: string;
  body: string;
  purpose: SmsPurpose;
  countsTowardQuota?: boolean;
  orderId?: string | null;
}

export interface SmsDeps {
  db: Database;
  config: Config;
  log: FastifyBaseLogger;
  lastAttempt?: boolean;
}

export type SmsOutcome = { status: 'sent' | 'failed' | 'skipped'; smsId?: string; reason?: string };

const QUOTA_WARNING_RATIO = 0.8;

async function quotaCheck(deps: SmsDeps, tenantId: string, now: Date): Promise<void> {
  const [usage, quota] = await Promise.all([smsUsageThisMonth(deps.db, tenantId, now), smsQuotaForTenant(deps.db, tenantId)]);
  const kind = usage > quota ? 'sms_quota_exceeded' : usage >= Math.ceil(quota * QUOTA_WARNING_RATIO) ? 'sms_quota_warning' : null;
  if (!kind) return;
  const { start, key } = monthStart(now);
  const [dup] = await deps.db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.kind, kind), gte(notifications.createdAt, start)))
    .limit(1);
  if (dup) return;
  await deps.db.insert(notifications).values({
    tenantId,
    kind,
    channel: 'log',
    status: 'sent',
    sentAt: now,
    payload: {
      month: key,
      usage,
      quota,
      text:
        kind === 'sms_quota_exceeded'
          ? `Bu ay SMS kotanız (${quota}) aşıldı: ${usage} SMS. Müşterilerinize SMS gitmeye devam ediyor; ek paket Faz 2'de.`
          : `Bu ay SMS kotanızın %${Math.round((usage / quota) * 100)}'ini kullandınız (${usage}/${quota}).`,
    },
  });
  deps.log.warn({ tenantId, usage, quota, kind }, 'SMS kota uyarısı');
}

export async function handleSmsSend(deps: SmsDeps, p: SmsSendPayload, now: Date = new Date()): Promise<SmsOutcome> {
  const to = normalizePhone(p.to) ?? (/^\+\d{8,15}$/.test(p.to) ? p.to : null);
  if (!to) return { status: 'skipped', reason: 'invalid_phone' };
  const body = String(p.body ?? '').trim();
  if (!body) return { status: 'skipped', reason: 'empty_body' };
  const counts = p.countsTowardQuota ?? false;

  if ((p.purpose === 'otp' || p.purpose === 'status') && !(await isFlagEnabled(deps.db, 'sms_fallback'))) {
    const [row] = await deps.db
      .insert(smsMessages)
      .values({ tenantId: p.tenantId, orderId: p.orderId ?? null, toPhone: to, body, purpose: p.purpose, provider: deps.config.SMS_PROVIDER, status: 'failed', countsTowardQuota: false, error: 'sms_fallback kapalı' })
      .returning({ id: smsMessages.id });
    return { status: 'skipped', reason: 'kill_switch', smsId: row!.id };
  }

  const [row] = await deps.db
    .insert(smsMessages)
    .values({ tenantId: p.tenantId, orderId: p.orderId ?? null, toPhone: to, body, purpose: p.purpose, provider: deps.config.SMS_PROVIDER, status: 'queued', countsTowardQuota: counts, createdAt: now })
    .returning({ id: smsMessages.id });
  const smsId = row!.id;
  try {
    const provider = getSmsProvider(deps.config);
    const res = await provider.send(to, body);
    await deps.db.update(smsMessages).set({ status: 'sent', providerMessageId: res.id, sentAt: now }).where(eq(smsMessages.id, smsId));
    deps.log.info({ to: maskPhone(to), purpose: p.purpose, smsId }, 'SMS gönderildi');
  } catch (err) {
    const e = err instanceof SmsSendError ? err : new SmsSendError('unknown', err instanceof Error ? err.message : String(err), true);
    if (e.retryable && !deps.lastAttempt) {
      // Yeniden denenecek: bu deneme kaydını sil (çift kayıt olmasın)
      await deps.db.delete(smsMessages).where(eq(smsMessages.id, smsId));
      throw e;
    }
    await deps.db.update(smsMessages).set({ status: 'failed', error: `${e.code}: ${e.message}`.slice(0, 300) }).where(eq(smsMessages.id, smsId));
    deps.log.error({ to: maskPhone(to), code: e.code }, 'SMS gönderilemedi');
    return { status: 'failed', smsId, reason: e.code };
  }
  if (counts && p.tenantId) await quotaCheck(deps, p.tenantId, now);
  return { status: 'sent', smsId };
}

