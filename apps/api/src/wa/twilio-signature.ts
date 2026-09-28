// Twilio webhook imzası (16 §2.5): X-Twilio-Signature = base64(HMAC-SHA1(Auth Token, <tam URL> + sıralı "ad + değer" çiftleri)).
// Meta'nın X-Hub-Signature-256'sından farkı: ham gövde değil, AYRIŞTIRILMIŞ form alanları imzalanır ve URL de imzaya girer.
// Bu yüzden doğrulama, Twilio'nun çağırdığı adresin birebir aynısıyla yapılmalıdır (APP_BASE_URL + ortak webhook yolu).

import { createHmac, timingSafeEqual } from 'node:crypto';

/** İmzalanan dizge: URL + her alan için (ad + değer), alan adlarına göre alfabetik sırada. */
export function twilioSignaturePayload(url: string, params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  let out = url;
  for (const k of keys) out += k + params[k];
  return out;
}

export function signTwilioRequest(url: string, params: Record<string, string>, authToken: string): string {
  return createHmac('sha1', authToken).update(Buffer.from(twilioSignaturePayload(url, params), 'utf8')).digest('base64');
}

/** Sabit zamanlı karşılaştırma (uzunluk farkı da sızdırmaz). */
function safeEqualB64(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  header: string | undefined,
  authToken: string,
): boolean {
  if (!header || !authToken) return false;
  return safeEqualB64(signTwilioRequest(url, params, authToken), header);
}
