// Twilio yolunun süreç düzeyi bağlantıları (app.ts ve worker.ts açılışında bir kez).
//   - içerik kaynağı deposu: wa_content_templates (16 §2.3)
//   - durum geri bildirimi adresi: her gönderime StatusCallback olarak eklenir; ortak webhook'un kendisidir, yani
//     gelen mesajlarla aynı yol ve aynı imza doğrulaması (16 §2.5). Belirteç yoksa adres verilmez; Twilio o zaman
//     Console'daki numara ayarını kullanır.
// Sağlayıcı Twilio değilse de takılır: zararsızdır (Twilio sağlayıcısı kullanılmadıkça çağrılmaz) ve işletmenin
// kendi numarası twilio ise (WA_DEFAULT_PROVIDER) aynı depo gerekir.

import type { Database } from '@siparis/db';
import type { Config } from '../config';
import { configureTwilio } from './providers/twilio';
import { setTwilioContentStore } from './twilio-content';
import { createDbTwilioContentStore } from './twilio-content-store';

/** Ortak webhook adresi (…/api/v1/webhooks/wa/shared/<belirteç>); belirteç yoksa null. */
export function sharedWebhookUrl(config: Pick<Config, 'APP_BASE_URL' | 'PLATFORM_WA_WEBHOOK_TOKEN'>): string | null {
  const token = config.PLATFORM_WA_WEBHOOK_TOKEN;
  if (!token) return null;
  return `${config.APP_BASE_URL.replace(/\/+$/, '')}/api/v1/webhooks/wa/shared/${token}`;
}

export function configureTwilioRuntime(
  config: Pick<Config, 'APP_BASE_URL' | 'PLATFORM_WA_WEBHOOK_TOKEN'>,
  db: Database,
): void {
  setTwilioContentStore(createDbTwilioContentStore(db));
  configureTwilio({ statusCallbackUrl: sharedWebhookUrl(config) });
}
