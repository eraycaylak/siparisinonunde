// Parola özeti: crypto.scrypt (N=16384, r=8, p=1, 64 bayt, rastgele tuz) — 14 §5.
// Biçim: scrypt$N$r$p$<tuz base64>$<özet base64>  (packages/db/src/seed-password.ts ile aynı)

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

function derive(plain: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, keylen, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(plain, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string | null | undefined): Promise<boolean> {
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

/** Zamanlama saldırısına karşı: kullanıcı yoksa da aynı maliyette doğrulama yap. */
let dummyHash: Promise<string> | null = null;
export async function verifyPasswordDummy(plain: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(plain, await dummyHash);
  return false;
}
