// `sms.send` işi: SMS sağlayıcısı (mock | netgsm), sms_messages kaydı, kota sayacı (00 §4).
// Kota aşımında SMS yine gönderilir, işletmeye notifications'ta uyarı düşer (ayda bir; %80'de ön uyarı).
// sms_fallback kill-switch'i kapalıysa OTP ve durum SMS'leri gönderilmez (alarm SMS'i etkilenmez).
//
// TAKLİT SAĞLAYICI "GÖNDERİLDİ" DEMEZ (denetim 2026-10-04 madde 4.4). Önceden canlı ortamda `SMS_PROVIDER=mock`
// iken mock sağlayıcı sahte bir mesaj kimliği döndürüyor, kayıt `sent` olarak işaretleniyor ve günlüğe
// "SMS gönderildi" yazılıyordu — hiçbir SMS gitmediği halde. Müşteri ekranda "kod gönderildi" görüyor,
// gelmeyen kodu bekliyordu. Artık kanal teslim etmiyorsa (`channelDelivers`) gönderim DENENMEZ: kayıt
// `failed` + nedeni yazılır, günlüğe tek anlamlı bir hata satırı düşer ve uyarı kanalına `sms_provider_mock`
// gider. Müşteriye SMS yedeğinin teklif edilmemesi bir üst katmandadır
// (`services/orders/verification.ts` → `loadVerificationChannels`), yani müşteri bu noktaya hiç gelmemelidir;
// burası ikinci savunma hattıdır (doğrudan çağıran bir akış kapıyı atlarsa yine yalan söylenmez).

import { maskPhone, normalizePhone, type SmsPurpose } from '@siparis/core';
import { notifications, smsMessages, type Database } from '@siparis/db';
import { and, eq, gte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { channelDelivers, type Config } from '../../config';
import { alert } from '../../lib/alert';
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

/**
 * `reason` değerleri: `invalid_phone`, `empty_body`, `kill_switch` (sms_fallback kapalı),
 * `provider_not_deliverable` (taklit sağlayıcı canlı ortamda — hiçbir SMS gitmedi) ve sağlayıcı hata kodları.
 */
export type SmsOutcome = { status: 'sent' | 'failed' | 'skipped'; smsId?: string; reason?: string };

const QUOTA_WARNING_RATIO = 0.8;

/** Taklit sağlayıcıyla canlı ortamda açılan kayda yazılan neden (ekrana çıkmaz, teşhis içindir). */
const SMS_NOT_DELIVERABLE_ERROR = 'taklit sağlayıcı (SMS_PROVIDER=mock): hiçbir yere gönderilmedi';

/** Aynı yapılandırma hatası için uyarı kanalını boğmayacak soğuma: saatte bir yeter. */
const PROVIDER_MOCK_ALERT_COOLDOWN_MS = 60 * 60_000;

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

  // Kanal gerçekten bir alıcıya ulaşıyor mu: canlı ortamda (NODE_ENV=production + DEPLOY_ENV=production) taklit
  // sağlayıcı hiçbir yere teslim etmez. Gönderim denenmez, kayıt "gönderildi" DİYE işaretlenmez.
  if (!channelDelivers(deps.config, 'sms')) {
    const [row] = await deps.db
      .insert(smsMessages)
      .values({
        tenantId: p.tenantId,
        orderId: p.orderId ?? null,
        toPhone: to,
        body,
        purpose: p.purpose,
        provider: deps.config.SMS_PROVIDER,
        status: 'failed',
        countsTowardQuota: false,
        error: SMS_NOT_DELIVERABLE_ERROR,
        createdAt: now,
      })
      .returning({ id: smsMessages.id });
    deps.log.error(
      { to: maskPhone(to), purpose: p.purpose, provider: deps.config.SMS_PROVIDER, smsId: row!.id },
      'SMS GÖNDERİLMEDİ: SMS_PROVIDER=mock canlı ortamda hiçbir yere teslim etmez (gerçek sağlayıcı yapılandırılmalı, docs/18 §2)',
    );
    alert(
      { log: deps.log, config: deps.config },
      {
        kind: 'sms_provider_mock',
        severity: 'critical',
        message: 'SMS kanalı taklit sağlayıcıda: hiçbir SMS gönderilmiyor. Doğrulama kodu, durum SMS\'i ve işletme alarmı ulaşmıyor (docs/18 §2).',
        data: { purpose: p.purpose, provider: deps.config.SMS_PROVIDER },
        cooldownMs: PROVIDER_MOCK_ALERT_COOLDOWN_MS,
      },
    );
    return { status: 'skipped', reason: 'provider_not_deliverable', smsId: row!.id };
  }

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

