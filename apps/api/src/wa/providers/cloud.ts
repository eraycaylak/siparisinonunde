// Meta WhatsApp Cloud API: POST https://graph.facebook.com/v23.0/{phone_number_id}/messages, Authorization: Bearer <token>.

import { WaSendError } from '../errors';
import type { WhatsAppProvider } from '../types';
import { createGraphProvider } from './graph';

export const GRAPH_API_VERSION = 'v23.0';
export const GRAPH_BASE_URL = 'https://graph.facebook.com';

export function createCloudProvider(): WhatsAppProvider {
  return createGraphProvider('cloud', (acc) => {
    if (!acc.phoneNumberId) throw new WaSendError('config_missing', 'Telefon numarası kimliği (phone_number_id) tanımlı değil.', { retryable: false });
    if (!acc.apiKey) throw new WaSendError('config_missing', 'Erişim anahtarı tanımlı değil.', { retryable: false });
    return {
      url: `${GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${encodeURIComponent(acc.phoneNumberId)}/messages`,
      headers: { Authorization: `Bearer ${acc.apiKey}` },
    };
  });
}
