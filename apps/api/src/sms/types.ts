// SMS sağlayıcı arayüzü: mock | netgsm (14 §3).

import type { SmsProviderName } from '@siparis/core';

export interface SmsProvider {
  readonly name: SmsProviderName;
  /** to: E.164; dönen id sağlayıcı mesaj kimliğidir. */
  send(to: string, body: string): Promise<{ id: string }>;
}
