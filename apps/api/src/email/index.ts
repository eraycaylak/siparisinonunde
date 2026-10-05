// E-posta katmanı: sağlayıcı seçimi (EMAIL_PROVIDER: mock | resend). `apps/api/src/sms/index.ts` ile aynı şekil.
import type { Config } from '../config';
import { createMockEmailProvider } from './providers/mock';
import { createResendProvider, RESEND_SEND_URL, RESEND_TIMEOUT_MS } from './providers/resend';
import { EMAIL_PURPOSES, EmailSendError, isEmailAddress, maskEmail, type EmailProvider } from './types';

export type * from './types';
export { createMockEmailProvider, createResendProvider, EMAIL_PURPOSES, EmailSendError, isEmailAddress, maskEmail, RESEND_SEND_URL, RESEND_TIMEOUT_MS };

/** Yapılandırmaya göre e-posta sağlayıcısı. resend bilgileri eksikse hata fırlatır (sessizce mock'a DÜŞMEZ). */
export function getEmailProvider(
  config: Pick<Config, 'EMAIL_PROVIDER' | 'RESEND_API_KEY' | 'EMAIL_FROM' | 'EMAIL_REPLY_TO'>,
): EmailProvider {
  if (config.EMAIL_PROVIDER === 'resend') {
    if (!config.RESEND_API_KEY || !config.EMAIL_FROM) {
      // Sessizce mock'a düşmek, "gönderildi" denip hiçbir şeyin gitmemesi demek olurdu (denetim 4.4 dersi).
      // Üretimde buraya hiç gelinmez: productionConfigErrors süreci başlatmaz (config.ts).
      throw new EmailSendError('config_missing', 'Resend bilgileri eksik (RESEND_API_KEY / EMAIL_FROM).', false);
    }
    return createResendProvider({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM, defaultReplyTo: config.EMAIL_REPLY_TO });
  }
  return createMockEmailProvider();
}
