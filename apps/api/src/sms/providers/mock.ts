// mock SMS sağlayıcısı: ağ yok. Kayıt `sms_messages` tablosuna sms.send işinde yazılır (GET /dev/sms okur).

import { randomUUID } from 'node:crypto';
import type { SmsProvider } from '../types';

export function createMockSmsProvider(): SmsProvider {
  return {
    name: 'mock',
    async send() {
      return { id: `mock-sms.${randomUUID()}` };
    },
  };
}
