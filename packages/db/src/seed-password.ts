// Seed için parola özeti. Biçim apps/api/src/lib/password.ts ile AYNI olmalı:
// scrypt$N$r$p$<tuz base64>$<özet base64>  (N=16384, r=8, p=1, 64 bayt)

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

/** SEED_PASSWORD'ün en kısa uzunluğu (00 §12a madde 9; dev ortamında DEV_PASSWORD ile aynı kural). */
export const SEED_PASSWORD_MIN_LENGTH = 8;

function derive(plain: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, keylen, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPasswordForSeed(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(plain, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Özet bu parolaya mı ait (seed'in var olan demo hesaplarını eşitlemesi için). */
export async function seedPasswordMatches(plain: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, 'base64');
  try {
    const actual = await derive(plain, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Demo hesaplarının ortak parolası: SEED_PASSWORD tanımlı (boş değil) ise o, değilse null (her hesap kendi yerel
 * geliştirme parolasını kullanır: admin1234, demo1234 …). Cloudflare dev ortamında SEED_PASSWORD = DEV_PASSWORD'dür.
 * Kısa parola seed'i durdurur.
 */
export function resolveSeedPassword(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw.length < SEED_PASSWORD_MIN_LENGTH) {
    throw new Error(`SEED_PASSWORD en az ${SEED_PASSWORD_MIN_LENGTH} karakter olmalı.`);
  }
  return raw;
}
