// Meta webhook imzası (02 §7.2): X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(App Secret, ham gövde).
// Ham gövde JSON parse edilmeden doğrulanır (Meta özel karakterleri kaçışlı unicode ile imzalar).

import { createHmac, timingSafeEqual } from 'node:crypto';

export function signMetaPayload(rawBody: Buffer | string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const hex = header.slice(7);
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const got = Buffer.from(hex, 'hex');
  return expected.length === got.length && timingSafeEqual(expected, got);
}
