// mock e-posta sağlayıcısı: ağ yok, hiçbir e-posta gönderilmez.
//
// Bu sağlayıcı "gönderdim" DEMEZ. Canlı ortamda (NODE_ENV=production + DEPLOY_ENV=production) e-posta katmanı
// (`services/messaging/email-send.ts`) buraya hiç gelmez: `channelDelivers(config, 'email')` false olduğu için
// çağrı `skipped` döner, günlüğe hata yazılır ve uyarı kanalına `email_not_configured` gider. SMS tarafında aynı
// şeklin eksikliği müşteriye "kod gönderildi" yalanını söyletiyordu (denetim 2026-10-04 madde 4.4); e-posta kanalı
// o dersle kuruldu.
//
// Geliştirme ve testte gönderim buraya düşer ve yalnız günlükte görünür.

import { randomUUID } from 'node:crypto';
import type { EmailProvider } from '../types';

export function createMockEmailProvider(): EmailProvider {
  return {
    name: 'mock',
    async send() {
      return { id: `mock-email.${randomUUID()}` };
    },
  };
}
