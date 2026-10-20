// Bellek içi token bucket hız sınırlayıcı (14 §5: tek süreç için yeterli).

import type { FastifyRequest } from 'fastify';
import { tooManyRequests } from './errors';

export interface RateLimiterOptions {
  /** Pencere başına izin verilen istek */
  limit: number;
  /** Pencere (ms); kova bu sürede tamamen dolar */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export interface RateLimiter {
  take(key: string, cost?: number): RateLimitResult;
  reset(key?: string): void;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, { tokens: number; updated: number }>();
  const refillPerMs = opts.limit / opts.windowMs;
  let lastSweep = Date.now();

  function sweep(now: number) {
    if (now - lastSweep < opts.windowMs) return;
    lastSweep = now;
    for (const [k, b] of buckets) {
      if (b.tokens + (now - b.updated) * refillPerMs >= opts.limit) buckets.delete(k);
    }
  }

  return {
    take(key, cost = 1) {
      const now = Date.now();
      sweep(now);
      const b = buckets.get(key) ?? { tokens: opts.limit, updated: now };
      b.tokens = Math.min(opts.limit, b.tokens + (now - b.updated) * refillPerMs);
      b.updated = now;
      if (b.tokens >= cost) {
        b.tokens -= cost;
        buckets.set(key, b);
        return { ok: true, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
      }
      buckets.set(key, b);
      return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((cost - b.tokens) / refillPerMs / 1000)) };
    },
    reset(key) {
      if (key) buckets.delete(key);
      else buckets.clear();
    },
  };
}

/** Sınır aşılırsa 429 rate_limited fırlatır. */
export function enforceRateLimit(limiter: RateLimiter, key: string, cost = 1): void {
  const r = limiter.take(key, cost);
  if (!r.ok) throw tooManyRequests(r.retryAfterSec);
}

/** İstemci IP'si (Caddy arkasında trustProxy ile X-Forwarded-For). Kayıt/denetim için tam adres. */
export function clientIp(request: FastifyRequest): string {
  return request.ip || 'unknown';
}

/**
 * Oran sınırı kovası için IP anahtarı: IPv4 olduğu gibi; IPv6 /64 önekine indirgenir (bir abone/cihaz genellikle tüm
 * /64 bloğunu alır — tam adresle her istek ayrı adresten atılıp sınır aşılabilirdi). IPv4-eşlemeli IPv6 (::ffff:a.b.c.d)
 * IPv4'e döner. Ayrıştırılamayan değer olduğu gibi kalır. Yalnız kova anahtarıdır; kayda tam adres (clientIp) yazılır.
 */
export function rateLimitIpKey(ip: string): string {
  const v = ip.trim().toLowerCase();
  if (!v.includes(':')) return v;
  const addr = v.split('%')[0]!;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) return mapped[1]!;
  const parts = addr.split('::');
  if (parts.length > 2) return v;
  const groupsOf = (x: string | undefined): string[] => {
    if (!x) return [];
    return x.split(':').flatMap((g) => (g.includes('.') ? ['0', '0'] : [g]));
  };
  const head = groupsOf(parts[0]);
  const tail = parts.length === 2 ? groupsOf(parts[1]) : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || head.length + tail.length + fill !== 8) return v;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return v;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(':')}::/64`;
}

/** İsteğin oran sınırı IP anahtarı (rateLimitIpKey(clientIp)). */
export function rateLimitIp(request: FastifyRequest): string {
  return rateLimitIpKey(clientIp(request));
}

/** 14 §5 sınırları. */
export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 60_000 },
  signup: { limit: 5, windowMs: 60_000 },
  storeOrderPerIp: { limit: 5, windowMs: 60_000 },
  storeOrderPerPhone: { limit: 3, windowMs: 10 * 60_000 },
  otpPerPhone: { limit: 3, windowMs: 10 * 60_000 },
  /** İki adımlı doğrulama kodu denemesi (giriş + TOTP yönetimi), kullanıcı başına */
  totpPerUser: { limit: 5, windowMs: 10 * 60_000 },
} as const;
