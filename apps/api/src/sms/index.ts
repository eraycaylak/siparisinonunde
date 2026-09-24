// SMS katmanı: sağlayıcı seçimi (SMS_PROVIDER: mock | netgsm).
export type * from './types';
import type { Config } from '../config';
import { createMockSmsProvider } from './providers/mock';
import { createNetgsmProvider, NETGSM_SEND_URL, SmsSendError } from './providers/netgsm';
import type { SmsProvider } from './types';

export { createMockSmsProvider, createNetgsmProvider, NETGSM_SEND_URL, SmsSendError };
export { SMS_PLAN_QUOTAS, smsQuotaForTenant, smsUsageThisMonth } from './quota';

/** Yapılandırmaya göre SMS sağlayıcısı. netgsm bilgileri eksikse hata fırlatır. */
export function getSmsProvider(config: Config): SmsProvider {
  if (config.SMS_PROVIDER === 'netgsm') {
    if (!config.NETGSM_USERCODE || !config.NETGSM_PASSWORD || !config.NETGSM_HEADER) {
      throw new SmsSendError('config_missing', 'NetGSM bilgileri eksik (NETGSM_USERCODE / NETGSM_PASSWORD / NETGSM_HEADER).', false);
    }
    return createNetgsmProvider({ usercode: config.NETGSM_USERCODE, password: config.NETGSM_PASSWORD, header: config.NETGSM_HEADER });
  }
  return createMockSmsProvider();
}
