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

/** İstemci IP'si (Caddy arkasında trustProxy ile X-Forwarded-For). */
export function clientIp(request: FastifyRequest): string {
  return request.ip || 'unknown';
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
