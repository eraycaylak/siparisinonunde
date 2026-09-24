// Seed için parola özeti. Biçim apps/api/src/lib/password.ts ile AYNI olmalı:
// scrypt$N$r$p$<tuz base64>$<özet base64>  (N=16384, r=8, p=1, 64 bayt)

import { randomBytes, scrypt } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export function hashPasswordForSeed(plain: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(`scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}
