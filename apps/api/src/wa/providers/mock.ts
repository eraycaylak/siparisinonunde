// mock sağlayıcı (geliştirme simülatörü): ağ çağrısı yok. Gönderim kaydı `messages` tablosuna iş hattında
// (services/messaging/send.ts) yazılır; burada yalnız wamid (`mock.<uuid>`) üretilir ve bellek içi günlük tutulur.
// Hata enjeksiyonu (testler): mockFailNext('131047') → sıradaki gönderim o kodla başarısız olur.

import { randomUUID } from 'node:crypto';
import { interactiveBody, templateBody, textBody, type CloudMessageBody } from '../cloud-body';
import { WaSendError } from '../errors';
import { parseCloudWebhook } from '../parse';
import type { WaAccountRef, WhatsAppProvider } from '../types';

export interface MockSentEntry {
  accountId: string;
  wamid: string;
  body: CloudMessageBody;
  at: Date;
}

const sentLog: MockSentEntry[] = [];
const failQueue: { code: string; message?: string }[] = [];

/** Test: sıradaki mock gönderim(ler) bu hata koduyla başarısız olsun. */
export function mockFailNext(code: string, message = 'Mock hata'): void {
  failQueue.push({ code, message });
}

export function mockSentMessages(): readonly MockSentEntry[] {
  return sentLog;
}

export function clearMockSent(): void {
  sentLog.length = 0;
  failQueue.length = 0;
}

function record(acc: WaAccountRef, body: CloudMessageBody): { wamid: string } {
  const fail = failQueue.shift();
  if (fail) throw new WaSendError(fail.code, fail.message ?? 'Mock hata', { httpStatus: 400 });
  const wamid = `mock.${randomUUID()}`;
  sentLog.push({ accountId: acc.id, wamid, body, at: new Date() });
  if (sentLog.length > 500) sentLog.splice(0, sentLog.length - 500);
  return { wamid };
}

export function createMockProvider(): WhatsAppProvider {
  return {
    name: 'mock',
    sendText: async (acc, to, text) => record(acc, textBody(to, text)),
    sendInteractive: async (acc, to, msg) => record(acc, interactiveBody(to, msg)),
    sendTemplate: async (acc, to, name, lang, params, buttons) => record(acc, templateBody(to, name, lang, params, buttons)),
    parseWebhook: (body) => parseCloudWebhook(body),
  };
}
