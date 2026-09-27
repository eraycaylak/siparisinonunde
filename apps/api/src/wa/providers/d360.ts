// 360dialog (BSP): POST https://waba-v2.360dialog.io/messages, başlık D360-API-KEY; gövde Cloud API ile aynı (teyit edilmeli).
// Numara, API anahtarına bağlıdır (phone_number_id URL'de yer almaz).

import { WaSendError } from '../errors';
import type { WhatsAppProvider } from '../types';
import { createGraphProvider } from './graph';

export const D360_BASE_URL = 'https://waba-v2.360dialog.io';

// Yönetim uçları (admin "WhatsApp kurulumu", 15 §6.2a; wa/graph-admin.ts d360Target). 360dialog'un yayımladığı Messaging API
// OpenAPI tanımına (1.48) göre; canlıda ilk kullanımda teyit edilmeli. Değişirse yalnız buradaki yollar güncellenir.
/** Numaranın webhook adresi: GET okur ({url}), POST {url} yazar. Yeni API anahtarı üretilince 360dialog bu adresi siler. */
export const D360_WEBHOOK_PATH = 'v1/configs/webhook';
/** Numara ve Meta durumu (Graph telefon düğümü alanları + health_status); zararsız bağlantı testi. */
export const D360_HEALTH_PATH = 'health_status';
/**
 * Mesaj şablonları: Graph ile aynı gövde ve yanıt ({data, paging}); WABA anahtara bağlı. Eski uç v1/configs/templates
 * 360dialog'da "deprecated" (yerine bu uç).
 */
export const D360_TEMPLATES_PATH = 'message_templates';

export function createD360Provider(): WhatsAppProvider {
  return createGraphProvider('d360', (acc) => {
    if (!acc.apiKey) throw new WaSendError('config_missing', '360dialog API anahtarı tanımlı değil.', { retryable: false });
    return { url: `${D360_BASE_URL}/messages`, headers: { 'D360-API-KEY': acc.apiKey } };
  });
}
