// Twilio WhatsApp sağlayıcısı (16 §2): POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json,
// Basic (Account SID : Auth Token), form-encoded gövde. Cloud API uyumlu DEĞİLDİR; providers/graph.ts çekirdeği
// kullanılmaz.
//   - düz metin      → Body
//   - buton / liste  → ContentSid (twilio/quick-reply, twilio/list-picker) + ContentVariables (wa/twilio-content.ts)
//   - cta_url, konum isteği → düz metne indirgenir (Twilio'da karşılığı yok)
//   - şablon         → ContentSid (admin "Şablonları gönder" adımında üretilir) + ContentVariables
// Alıcı yalnız telefondur: Twilio'da BSUID yoktur (16 §2.2).

import { WaSendError } from '../errors';
import { TWILIO_API_BASE, twilioCall, type TwilioTarget } from '../twilio-api';
import { CONTENT_LANGUAGE, contentSidForSend, forgetContentSid, interactiveFallbackText, lookupContentSid, planInteractive } from '../twilio-content';
import { parseTwilioWebhook } from '../twilio-parse';
import type { WaAccountRef, WaRecipient, WhatsAppProvider } from '../types';
import { isGraphApiError } from '../graph-admin';

/** Twilio mesaj gövdesinde metin sınırı. */
export const TWILIO_BODY_MAX = 1600;

interface TwilioProviderSettings {
  /** Her mesaja eklenen durum geri bildirimi adresi (ortak webhook). Boşsa Console'daki ayar kullanılır. */
  statusCallbackUrl: string | null;
}

let settings: TwilioProviderSettings = { statusCallbackUrl: null };

/** Uygulama açılışında çağrılır (app.ts, worker.ts). */
export function configureTwilio(s: Partial<TwilioProviderSettings>): void {
  settings = { ...settings, ...s };
}

export function twilioSettings(): TwilioProviderSettings {
  return settings;
}

/** Hesap referansından Twilio hedefi; eksik yapılandırmada kalıcı hata. */
export function twilioTargetOf(acc: WaAccountRef): TwilioTarget {
  if (!acc.phoneNumberId) {
    throw new WaSendError('config_missing', 'Twilio Account SID tanımlı değil (PLATFORM_WA_PHONE_NUMBER_ID).', { retryable: false });
  }
  if (!acc.apiKey) throw new WaSendError('config_missing', 'Twilio Auth Token tanımlı değil (PLATFORM_WA_API_KEY).', { retryable: false });
  return { accountSid: acc.phoneNumberId, authToken: acc.apiKey };
}

/** Gönderen adresi: whatsapp:<ortak numara>. */
export function twilioFrom(acc: WaAccountRef): string {
  if (!acc.displayPhone) {
    throw new WaSendError('config_missing', 'Ortak numara tanımlı değil (PLATFORM_WA_DISPLAY_PHONE).', { retryable: false });
  }
  return `whatsapp:${acc.displayPhone}`;
}

export function twilioTo(to: WaRecipient): string {
  if (!to.phone) {
    // Twilio BSUID desteklemez (16 §2.2): kimliksiz alıcıya bu yoldan gönderilemez
    throw new WaSendError('no_recipient', 'Twilio yalnız telefon numarasına gönderir; alıcının telefonu yok.', { retryable: false });
  }
  return `whatsapp:${to.phone}`;
}

export type TwilioMessageForm = Record<string, string | undefined>;

/**
 * Twilio'ya giden form gövdesi (gizli değer içermez: kimlik yalnız Authorization başlığındadır).
 * NOT: `messages.payload.request` alanı sağlayıcıdan bağımsızdır ve Cloud API biçiminde saklanır
 * (services/messaging/send.ts specRequestBody) — orada görünen gövde bu form değil, mesajın kanonik tanımıdır.
 */
export function twilioMessageForm(
  acc: WaAccountRef,
  to: WaRecipient,
  part: { body?: string; contentSid?: string; contentVariables?: Record<string, string> },
): TwilioMessageForm {
  const form: TwilioMessageForm = { From: twilioFrom(acc), To: twilioTo(to) };
  if (part.contentSid) {
    form.ContentSid = part.contentSid;
    if (part.contentVariables) form.ContentVariables = JSON.stringify(part.contentVariables);
  } else {
    form.Body = (part.body ?? '').slice(0, TWILIO_BODY_MAX);
  }
  if (settings.statusCallbackUrl) form.StatusCallback = settings.statusCallbackUrl;
  return form;
}

async function postMessage(acc: WaAccountRef, form: TwilioMessageForm): Promise<{ wamid: string }> {
  const t = twilioTargetOf(acc);
  let res: { sid?: string };
  try {
    res = await twilioCall<{ sid?: string }>(t, 'POST', `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(t.accountSid)}/Messages.json`, { form });
  } catch (err) {
    if (isGraphApiError(err)) throw new WaSendError(err.code, err.message, { httpStatus: err.httpStatus });
    throw err;
  }
  if (!res.sid) throw new WaSendError('no_wamid', 'Twilio yanıtında mesaj kimliği (sid) yok', { retryable: false });
  return { wamid: res.sid };
}

/**
 * Twilio içerik kaynağını bulamadı / geçersiz saydı: 21655 (ContentSid geçersiz), 20404 (kaynak yok) ve şablon
 * hataları (63005, 63021, 63036 → 132000). Kaynak Console'dan silinip aynı adla yeniden üretilmiş olabilir.
 */
const STALE_CONTENT_CODES = new Set(['21655', '20404', '132000']);

/** İçerikli gönderim: kaynak bulunamazsa bayat kimlik unutulur, sonraki gönderim adı Twilio'da yeniden arar. */
async function postContentMessage(acc: WaAccountRef, form: TwilioMessageForm, friendlyName: string): Promise<{ wamid: string }> {
  try {
    return await postMessage(acc, form);
  } catch (err) {
    if (err instanceof WaSendError && STALE_CONTENT_CODES.has(err.code)) await forgetContentSid(friendlyName).catch(() => undefined);
    throw err;
  }
}

export function createTwilioProvider(): WhatsAppProvider {
  return {
    name: 'twilio',

    sendText: async (acc, to, text) => postMessage(acc, twilioMessageForm(acc, to, { body: text })),

    sendInteractive: async (acc, to, msg) => {
      const plan = planInteractive(msg);
      if (!plan) return postMessage(acc, twilioMessageForm(acc, to, { body: interactiveFallbackText(msg) }));
      const contentSid = await contentSidForSend(twilioTargetOf(acc), plan.definition);
      return postContentMessage(acc, twilioMessageForm(acc, to, { contentSid, contentVariables: plan.variables }), plan.definition.friendlyName);
    },

    sendTemplate: async (acc, to, name, lang, params, buttons) => {
      if (lang !== CONTENT_LANGUAGE) {
        throw new WaSendError('132000', `Twilio şablon dili ${CONTENT_LANGUAGE} olmalı (gelen: ${lang}).`, { retryable: false });
      }
      let contentSid: string;
      try {
        contentSid = await ensureContentSidForTemplate(acc, name);
      } catch (err) {
        if (err instanceof WaSendError) throw err;
        if (isGraphApiError(err)) throw new WaSendError(err.code, err.message, { httpStatus: err.httpStatus });
        throw err;
      }
      const variables: Record<string, string> = {};
      params.forEach((p, i) => {
        variables[String(i + 1)] = String(p).replace(/\s*\n+\s*/g, ' ');
      });
      // Twilio'da içeriğin TEK değişken alanı vardır: dinamik URL butonunun parametresi gövde değişkenlerinden SONRA
      // numaralanır (wa-setup-twilio.ts twilioContentPayload aynı sırayı üretir). Hızlı yanıt butonunun kimliği
      // içerikte sabittir, parametre almaz.
      let next = params.length + 1;
      for (const b of buttons ?? []) {
        if (b.type === 'url') variables[String(next++)] = String(b.param);
      }
      return postContentMessage(acc, twilioMessageForm(acc, to, { contentSid, contentVariables: variables }), name);
    },

    parseWebhook: (body) => parseTwilioWebhook(body),
  };
}

/** Şablonun ContentSid'i: tablo/Twilio listesi üzerinden bulunur (üretilmez); yoksa kalıcı şablon hatası. */
async function ensureContentSidForTemplate(acc: WaAccountRef, name: string): Promise<string> {
  const sid = await lookupContentSid(twilioTargetOf(acc), name);
  if (sid) return sid;
  throw new WaSendError('132000', `"${name}" şablonu Twilio'da yok. Admin › WhatsApp › WhatsApp kurulumu › "Şablonları gönder" adımını çalıştırın.`, {
    retryable: false,
  });
}
