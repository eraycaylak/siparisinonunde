// Takip token'ı (14 §7.4): base64url(orderId 16 bayt) + "." + base64url(HMAC-SHA256(TRACKING_SECRET, orderId))[0..16]
// Saklanmaz; doğrulama yeniden hesaplanarak yapılır.

import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidToBytes(id: string): Buffer {
  return Buffer.from(id.replace(/-/g, ''), 'hex');
}

function bytesToUuid(b: Buffer): string {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function signature(orderId: string, secret: string): string {
  return createHmac('sha256', secret).update(orderId.toLowerCase()).digest('base64url').slice(0, 16);
}

export function createTrackingToken(orderId: string, secret: string): string {
  if (!UUID_RE.test(orderId)) throw new Error('Geçersiz sipariş kimliği');
  return `${uuidToBytes(orderId).toString('base64url')}.${signature(orderId, secret)}`;
}

/** Geçerliyse sipariş kimliğini, değilse null döner. */
export function parseTrackingToken(token: string, secret: string): string | null {
  if (typeof token !== 'string' || token.length > 64) return null;
  const [idPart, sig] = token.split('.');
  if (!idPart || !sig) return null;
  const bytes = Buffer.from(idPart, 'base64url');
  if (bytes.length !== 16) return null;
  const orderId = bytesToUuid(bytes);
  const expected = signature(orderId, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return orderId;
}

export function trackingUrl(appBaseUrl: string, orderId: string, secret: string): string {
  return `${appBaseUrl.replace(/\/$/, '')}/t/${createTrackingToken(orderId, secret)}`;
}
