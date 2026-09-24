// 360dialog (BSP): POST https://waba-v2.360dialog.io/messages, başlık D360-API-KEY; gövde Cloud API ile aynı (teyit edilmeli).
// Numara, API anahtarına bağlıdır (phone_number_id URL'de yer almaz).

import { WaSendError } from '../errors';
import type { WhatsAppProvider } from '../types';
import { createGraphProvider } from './graph';

export const D360_BASE_URL = 'https://waba-v2.360dialog.io';

export function createD360Provider(): WhatsAppProvider {
  return createGraphProvider('d360', (acc) => {
    if (!acc.apiKey) throw new WaSendError('config_missing', '360dialog API anahtarı tanımlı değil.', { retryable: false });
    return { url: `${D360_BASE_URL}/messages`, headers: { 'D360-API-KEY': acc.apiKey } };
  });
}
