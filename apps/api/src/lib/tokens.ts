// Rastgele token, SHA-256 ve kısa kod üretimi.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 32 bayt rastgele → base64url (oturum, magic link, link token). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256Hex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Sipariş kodu alfabesi (karışmayan harf/rakam; 07 §3.3). */
export const ORDER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 6 karakterlik sipariş kodu, en az 1 rakam içerir. */
export function generateOrderCode(length = 6): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < length; i++) code += ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)];
    if (/[2-9]/.test(code)) return code;
  }
}

/** N haneli sayısal kod (SMS OTP). */
export function generateNumericCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) code += String(randomInt(10));
  return code;
}
