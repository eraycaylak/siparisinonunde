// Storefront çerezleri (dilimler arası sözleşme, DILIM-KURALLARI):
//  - sf_link_<slug>: Akış A link token'ı (ham token; HttpOnly; 2 sa) — dilim 1 yazar, sipariş oluştururken okunur.
//  - sf_cust_<slug>: "<customerId>.<hmacSha256Hex(SESSION_SECRET, 'sf_cust:' + customerId)>" (90 gün, HttpOnly) —
//    sipariş oluşturulunca yazılır; dilim 1 "Son siparişin" için okur (services/storefront/cookies.ts ile aynı kanonik biçim).

import { storefrontLinkTokens, type Database } from '@siparis/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import type { Config } from '../../config';
import { hmacSha256Hex, safeEqual, sha256Hex } from '../../lib/tokens';

export const CUSTOMER_COOKIE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const linkCookieName = (slug: string) => `sf_link_${slug}`;
export const customerCookieName = (slug: string) => `sf_cust_${slug}`;

export function signCustomerCookie(secret: string, customerId: string): string {
  return `${customerId}.${hmacSha256Hex(secret, `sf_cust:${customerId}`)}`;
}

/** Geçerli imzalıysa müşteri kimliğini döner. */
export function verifyCustomerCookie(secret: string, value: string | undefined | null): string | null {
  if (!value) return null;
  const i = value.lastIndexOf('.');
  if (i <= 0) return null;
  const id = value.slice(0, i);
  const sig = value.slice(i + 1);
  return safeEqual(sig, hmacSha256Hex(secret, `sf_cust:${id}`)) ? id : null;
}

export function setCustomerCookie(reply: FastifyReply, config: Config, slug: string, customerId: string): void {
  reply.setCookie(customerCookieName(slug), signCustomerCookie(config.SESSION_SECRET, customerId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: Math.floor(CUSTOMER_COOKIE_TTL_MS / 1000),
  });
}

export type LinkTokenRow = typeof storefrontLinkTokens.$inferSelect;

/** sf_link_<slug> çerezindeki token geçerliyse (tenant eşleşir, süresi dolmamış) kaydı döner. */
export async function readLinkToken(db: Database, request: FastifyRequest, slug: string, tenantId: string, now = new Date()): Promise<LinkTokenRow | null> {
  const raw = request.cookies?.[linkCookieName(slug)];
  if (!raw || raw.length < 16 || raw.length > 400) return null;
  const [row] = await db
    .select()
    .from(storefrontLinkTokens)
    .where(
      and(
        eq(storefrontLinkTokens.tokenHash, sha256Hex(raw)),
        eq(storefrontLinkTokens.tenantId, tenantId),
        gt(storefrontLinkTokens.expiresAt, now),
      ),
    );
  return row ?? null;
}
