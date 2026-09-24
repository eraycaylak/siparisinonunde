// Storefront çerezleri (dilimler arası sözleşme):
//  - sf_link_<slug>: Akış A link token'ı (ham token; HttpOnly; SameSite=Lax; 2 sa; Path=/). POST /store/:slug/session yazar,
//    POST /store/:slug/orders (dilim 2) okur ve storefront_link_tokens'ta sha256 ile doğrular.
//  - sf_cust_<slug>: HMAC imzalı müşteri kimliği (90 gün). Sipariş oluşunca dilim 2 yazar; "Son siparişin" için burada okunur.
//    Kanonik biçim: `${customerId}.${hmacSha256Hex(SESSION_SECRET, 'sf_cust:' + customerId)}` — signCustomerCookie().

import type { FastifyReply } from 'fastify';
import type { Config } from '../../config';
import { hmacSha256Hex, safeEqual } from '../../lib/tokens';

export const LINK_COOKIE_TTL_MS = 2 * 60 * 60 * 1000;
export const CUSTOMER_COOKIE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const linkCookieName = (slug: string) => `sf_link_${slug}`;
export const customerCookieName = (slug: string) => `sf_cust_${slug}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function baseCookieOptions(config: Config) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: config.cookieSecure, path: '/' };
}

/** sf_link_<slug> çerezini yazar (en çok 2 sa, token süresinden uzun olmaz). */
export function setLinkCookie(reply: FastifyReply, config: Config, slug: string, rawToken: string, tokenExpiresAt: Date, now = new Date()): void {
  const expires = new Date(Math.min(now.getTime() + LINK_COOKIE_TTL_MS, tokenExpiresAt.getTime()));
  reply.setCookie(linkCookieName(slug), rawToken, { ...baseCookieOptions(config), expires });
}

/** sf_cust_<slug> çerezini yazar (90 gün). Dilim 2 sipariş sonrası kullanabilir. */
export function setCustomerCookie(reply: FastifyReply, config: Config, slug: string, customerId: string, now = new Date()): void {
  reply.setCookie(customerCookieName(slug), signCustomerCookie(config.SESSION_SECRET, customerId), {
    ...baseCookieOptions(config),
    expires: new Date(now.getTime() + CUSTOMER_COOKIE_TTL_MS),
  });
}

/** "Ben değilim" / "Bu cihazı unut": iki çerezi de siler. */
export function clearStorefrontCookies(reply: FastifyReply, config: Config, slug: string): void {
  reply.clearCookie(linkCookieName(slug), baseCookieOptions(config));
  reply.clearCookie(customerCookieName(slug), baseCookieOptions(config));
}

export function signCustomerCookie(secret: string, customerId: string): string {
  return `${customerId}.${hmacSha256Hex(secret, `sf_cust:${customerId}`)}`;
}

function candidateSignatures(secret: string, payload: string, customerId: string, ctx: { tenantId?: string; slug?: string }): string[] {
  const messages = new Set<string>([payload, customerId, `sf_cust:${customerId}`]);
  if (ctx.tenantId) {
    messages.add(`${ctx.tenantId}:${customerId}`);
    messages.add(`${ctx.tenantId}.${customerId}`);
  }
  if (ctx.slug) {
    messages.add(`${ctx.slug}:${customerId}`);
    messages.add(`sf_cust_${ctx.slug}:${customerId}`);
  }
  const out: string[] = [];
  for (const m of messages) {
    const hex = hmacSha256Hex(secret, m);
    out.push(hex, Buffer.from(hex, 'hex').toString('base64url'));
  }
  return out;
}

/**
 * sf_cust çerezini doğrular → müşteri kimliği ya da null. Kanonik biçimin yanında `payload.imza` biçimli
 * (hex ya da base64url, en az 16 karakterlik önek) varyantları da kabul eder; imza SESSION_SECRET ile doğrulanır.
 * Müşterinin tenant'a ait olduğunu ÇAĞIRAN ayrıca kontrol eder.
 */
export function verifyCustomerCookie(
  secret: string,
  value: string | undefined | null,
  ctx: { tenantId?: string; slug?: string } = {},
): string | null {
  if (!value) return null;
  let raw = value;
  try {
    raw = decodeURIComponent(value);
  } catch {
    /* olduğu gibi */
  }
  const dot = raw.lastIndexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (sig.length < 16) return null;

  let customerId: string | null = UUID_RE.test(payload) ? payload : null;
  if (!customerId) {
    // base64url(JSON) yükü: { customerId | c | cid | id }
    try {
      const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
      const cand = obj.customerId ?? obj.c ?? obj.cid ?? obj.id;
      if (typeof cand === 'string' && UUID_RE.test(cand)) customerId = cand;
    } catch {
      return null;
    }
  }
  if (!customerId) return null;
  for (const expected of candidateSignatures(secret, payload, customerId, ctx)) {
    if (sig.length <= expected.length && safeEqual(sig, expected.slice(0, sig.length))) return customerId.toLowerCase();
  }
  return null;
}
