// E-posta kanalı — TEK gönderim sözleşmesi (`sendEmail`). Denetim 2026-10-04 madde 4.5: üründe e-posta kanalı
// HİÇ yoktu; lead bildirimi, KVKK başvurusu, fatura ve parola sıfırlama e-postasız kalıyordu.
//
// Bu dosya yalnız KANALI kurar. Akışların kendisi (hangi olayda kime ne yazılacağı) bilerek BAĞLANMADI; hangi
// akışların buraya bağlanacağı ve her birinin kimden/kime gideceği `docs/18-dis-saglayicilar.md` §3'tedir.
//
// Üç değişmez kural:
//   1. **Sessizce yutmaz.** Kanal yapılandırılmamışsa (EMAIL_PROVIDER=mock, canlı ortam) çağrı `skipped` döner,
//      `log.error` yazar ve uyarı kanalına `email_not_configured` gider. SMS tarafında bu kuralın yokluğu
//      müşteriye "kod gönderildi" yalanını söyletiyordu (madde 4.4); e-posta o dersle kuruldu.
//   2. **"Gönderildi" yalnız sağlayıcı kimlik döndürdüğünde söylenir.** Kimliksiz 200 bile başarı sayılmaz
//      (`providers/resend.ts` → `no_id`).
//   3. **Adres loglanmaz.** Günlüğe ve uyarı kanalına yalnız maskeli adres (`maskEmail`) yazılır
//      (CLAUDE.md değişmez kural 7).
//
// `notifications` kaydı YALNIZ `tenantId` verildiğinde yazılır: tablo `tenant_id` NOT NULL'dur ve ziyaretçiden
// gelen KVKK başvurusu ile bize gelen lead bildirimi hiçbir işletmeye ait değildir. Onlar için kayıt yeri
// günlüktür; uydurma bir tenant'a yazmak denetim izini kirletir.

import { notifications, type Database } from '@siparis/db';
import type { FastifyBaseLogger } from 'fastify';
import { channelDelivers, type Config } from '../../config';
import { getEmailProvider } from '../../email/index';
import { EmailSendError, isEmailAddress, maskEmail, type EmailMessage, type EmailPurpose } from '../../email/types';
import { alert } from '../../lib/alert';

export interface EmailSendPayload extends EmailMessage {
  /** Hangi akış (docs/18 §3). Teşhis ve `notifications.payload.purpose` içindir. */
  purpose: EmailPurpose;
  /** Varsa işletme: `notifications` kaydı bununla yazılır. Platform/ziyaretçi e-postalarında null. */
  tenantId?: string | null;
  orderId?: string | null;
}

export interface EmailDeps {
  db: Database;
  config: Pick<Config, 'NODE_ENV' | 'DEPLOY_ENV' | 'EMAIL_PROVIDER' | 'RESEND_API_KEY' | 'EMAIL_FROM' | 'EMAIL_REPLY_TO'> &
    Partial<Pick<Config, 'ALERT_WEBHOOK_URL' | 'ALERT_MIN_SEVERITY'>>;
  log: FastifyBaseLogger;
  /** Kuyruktan çağrılıyorsa son deneme mi: geçici hatada true değilken hata yukarı atılır (sms-send ile aynı). */
  lastAttempt?: boolean;
}

/**
 * `reason` değerleri: `invalid_recipient`, `empty_subject`, `empty_body`,
 * `provider_not_deliverable` (kanal yapılandırılmamış — hiçbir e-posta gitmedi) ve sağlayıcı hata kodları.
 */
export type EmailOutcome = { status: 'sent' | 'failed' | 'skipped'; providerMessageId?: string; reason?: string };

/** Aynı yapılandırma hatası için uyarı kanalını boğmayacak soğuma: saatte bir yeter. */
const NOT_CONFIGURED_ALERT_COOLDOWN_MS = 60 * 60_000;

/** Konu ve gövde üst sınırları: sağlayıcı reddini beklemeden sınırda keser. */
const MAX_SUBJECT = 200;
const MAX_BODY = 100_000;

/** `notifications` satırı; yalnız tenant'a ait e-postalarda çağrılır. */
async function recordNotification(
  deps: EmailDeps,
  p: EmailSendPayload,
  status: 'sent' | 'failed',
  extra: { providerRef?: string | null; error?: string | null },
  now: Date,
): Promise<void> {
  if (!p.tenantId) return;
  await deps.db.insert(notifications).values({
    tenantId: p.tenantId,
    orderId: p.orderId ?? null,
    kind: `email_${p.purpose}`,
    channel: 'email',
    status,
    sentAt: status === 'sent' ? now : null,
    providerRef: extra.providerRef ?? null,
    error: extra.error ?? null,
    // Alıcı adresi MASKELİ yazılır: bu satır admin panelinde ve dışa aktarımlarda görünür
    payload: { purpose: p.purpose, to: maskEmail(p.to), subject: p.subject.slice(0, MAX_SUBJECT) },
  });
}

/**
 * E-posta gönderir. Tek giriş noktasıdır: yeni bir akış bağlanırken başka hiçbir yerde sağlayıcı çağrılmaz.
 *
 * Çağrılabilir olduğunun kanıtı: `apps/api/test/email.test.ts` bu işlevi doğrudan çağırır (mock sağlayıcıyla
 * gönderim, teslim etmeyen kanalda `skipped`, geçersiz alıcı, maskeli kayıt).
 */
export async function sendEmail(deps: EmailDeps, p: EmailSendPayload, now: Date = new Date()): Promise<EmailOutcome> {
  // --- Sınırda doğrulama (CLAUDE.md: validate input at system boundaries) -------------------------------
  const to = String(p.to ?? '').trim();
  if (!isEmailAddress(to)) {
    deps.log.warn({ purpose: p.purpose }, 'e-posta atlandı: geçersiz alıcı adresi');
    return { status: 'skipped', reason: 'invalid_recipient' };
  }
  const subject = String(p.subject ?? '').trim().slice(0, MAX_SUBJECT);
  if (!subject) return { status: 'skipped', reason: 'empty_subject' };
  const text = String(p.text ?? '').trim().slice(0, MAX_BODY);
  if (!text) return { status: 'skipped', reason: 'empty_body' };

  const message: EmailMessage = {
    to,
    subject,
    text,
    ...(p.html ? { html: p.html.slice(0, MAX_BODY) } : {}),
    ...(p.replyTo ? { replyTo: p.replyTo } : {}),
  };

  // --- Kanal gerçekten teslim ediyor mu ----------------------------------------------------------------
  // Taklit sağlayıcı canlı ortamda hiçbir yere göndermez. Sessizce başarı DÖNDÜRÜLMEZ: çağıran akış
  // "e-posta gitti" varsayımıyla ekrana yazı basmasın.
  if (!channelDelivers(deps.config, 'email')) {
    const reason = 'provider_not_deliverable';
    deps.log.error(
      { to: maskEmail(to), purpose: p.purpose, provider: deps.config.EMAIL_PROVIDER },
      'E-POSTA GÖNDERİLMEDİ: e-posta kanalı yapılandırılmamış (EMAIL_PROVIDER=mock). Gerçek sağlayıcı gerekir (docs/18 §3)',
    );
    alert(
      { log: deps.log, config: deps.config },
      {
        kind: 'email_not_configured',
        severity: 'critical',
        message: 'E-posta kanalı yapılandırılmamış: hiçbir e-posta gönderilmiyor (lead bildirimi, KVKK başvurusu, parola sıfırlama, fatura — docs/18 §3).',
        data: { purpose: p.purpose, provider: deps.config.EMAIL_PROVIDER },
        cooldownMs: NOT_CONFIGURED_ALERT_COOLDOWN_MS,
      },
    );
    await recordNotification(deps, p, 'failed', { error: 'e-posta kanalı yapılandırılmamış (EMAIL_PROVIDER=mock)' }, now);
    return { status: 'skipped', reason };
  }

  // --- Gönderim ----------------------------------------------------------------------------------------
  try {
    const provider = getEmailProvider(deps.config);
    const res = await provider.send(message);
    await recordNotification(deps, p, 'sent', { providerRef: res.id }, now);
    deps.log.info({ to: maskEmail(to), purpose: p.purpose, providerMessageId: res.id }, 'e-posta gönderildi');
    return { status: 'sent', providerMessageId: res.id };
  } catch (err) {
    const e = err instanceof EmailSendError ? err : new EmailSendError('unknown', err instanceof Error ? err.message : String(err), true);
    // Geçici hata ve son deneme değil: kayıt yazmadan hatayı yukarı at (kuyruk yeniden dener, çift kayıt olmaz)
    if (e.retryable && !deps.lastAttempt) throw e;
    await recordNotification(deps, p, 'failed', { error: `${e.code}: ${e.message}`.slice(0, 300) }, now);
    deps.log.error({ to: maskEmail(to), purpose: p.purpose, code: e.code }, 'e-posta gönderilemedi');
    alert(
      { log: deps.log, config: deps.config },
      {
        kind: 'email_send_failed',
        severity: 'warning',
        message: `E-posta gönderilemedi (${e.code}): ${p.purpose}.`,
        data: { purpose: p.purpose, code: e.code },
        dedupeKey: `email_send_failed:${e.code}`,
      },
    );
    return { status: 'failed', reason: e.code };
  }
}
