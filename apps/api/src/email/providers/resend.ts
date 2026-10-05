// Resend e-posta sağlayıcısı (teyit edilmeli — netgsm.ts ile aynı not): HTTP POST
//   https://api.resend.com/emails
//   Authorization: Bearer <RESEND_API_KEY>
//   { from, to: [adres], subject, text, html?, reply_to? }
// Başarılı yanıt: 200/201 + { "id": "<uuid>" }. Hata: 4xx/5xx + { "name": "...", "message": "..." }.
//
// Neden HTTP API, neden SMTP değil: canlı ortam Cloudflare Worker + tek container'dır (00 §12a madde 10). Giden
// SMTP bağlantısı (25/465/587) bu ortamda güvenilir değildir ve yeni bir npm bağımlılığı (nodemailer) gerektirir;
// HTTP API `fetch` ile çalışır, bağımlılık eklemez. SMTP'ye geçilmek istenirse ikinci bir adaptör yazılır,
// `EMAIL_PROVIDER` enum'una 'smtp' eklenir ve bu dosyaya dokunulmaz.
//
// Sağlayıcı değiştirilebilir: Postmark, Brevo, AWS SES gibi alternatifler de tek bir `POST /emails` çağrısıdır;
// `EmailProvider` sözleşmesi aynı kaldığı için yalnız bu dosyanın eşleniği yazılır (docs/18 §3).

import { fetchWithTimeout } from '../../wa/http';
import { EmailSendError, type EmailMessage, type EmailProvider } from '../types';

export const RESEND_SEND_URL = 'https://api.resend.com/emails';

/** Gönderime verilen süre: kuyruk şeridini bekletmemek için kısa tutulur (uyarı kanalıyla aynı mantık). */
export const RESEND_TIMEOUT_MS = 10_000;

export interface ResendOptions {
  apiKey: string;
  /** `Ad <adres@alan.tld>` ya da yalın adres; alan adı sağlayıcıda doğrulanmış olmalı (docs/18 §3). */
  from: string;
  /** Varsayılan yanıt adresi; mesajın kendi `replyTo`'su bunu ezer. */
  defaultReplyTo?: string | undefined;
}

/** Sağlayıcı gövdesinden okunabilir tek satır çıkarır; kişisel veri taşımaması için kırpılır. */
function errorText(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const o = body as { message?: unknown; name?: unknown };
    const msg = typeof o.message === 'string' ? o.message : typeof o.name === 'string' ? o.name : null;
    if (msg) return msg.slice(0, 200);
  }
  return fallback;
}

export function createResendProvider(opts: ResendOptions): EmailProvider {
  return {
    name: 'resend',
    async send(message: EmailMessage) {
      const replyTo = message.replyTo ?? opts.defaultReplyTo;
      let res: Response;
      try {
        res = await fetchWithTimeout(
          RESEND_SEND_URL,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              from: opts.from,
              to: [message.to],
              subject: message.subject,
              text: message.text,
              ...(message.html ? { html: message.html } : {}),
              ...(replyTo ? { reply_to: replyTo } : {}),
            }),
          },
          RESEND_TIMEOUT_MS,
        );
      } catch {
        throw new EmailSendError('network', 'E-posta sağlayıcısına ulaşılamadı', true);
      }
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        // 429 ve 5xx geçici: kuyruk yeniden dener. 401/403/422 yapılandırma/içerik hatasıdır, tekrar denemek düzeltmez.
        const retryable = res.status === 429 || res.status >= 500;
        throw new EmailSendError(`http_${res.status}`, errorText(body, `E-posta sağlayıcısı hata döndü (${res.status})`), retryable);
      }
      const id = body && typeof body === 'object' ? (body as { id?: unknown }).id : undefined;
      if (typeof id !== 'string' || !id) {
        // 200 ama kimlik yok: gönderildiğini VARSAYMAK, mock'un sessiz yalanının başka bir biçimi olur
        throw new EmailSendError('no_id', 'E-posta sağlayıcısı mesaj kimliği döndürmedi', true);
      }
      return { id };
    },
  };
}
