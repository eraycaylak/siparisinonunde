// DB gerektirmeyen yardımcılar: parola, şifreleme, token, takip token'ı, hız sınırı, yapılandırma.

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createEncryptor } from '../src/lib/encryption';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { createRateLimiter } from '../src/lib/rate-limit';
import { ORDER_CODE_ALPHABET, generateNumericCode, generateOrderCode, randomToken, sha256Hex } from '../src/lib/tokens';
import { createTrackingToken, parseTrackingToken, trackingUrl } from '../src/lib/tracking';
import { hashPasswordForSeed } from '@siparis/db';

describe('password (scrypt)', () => {
  it('özet ve doğrulama; seed biçimiyle uyumlu', async () => {
    const h = await hashPassword('demo1234');
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword('demo1234', h)).toBe(true);
    expect(await verifyPassword('demo12345', h)).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', 'bozuk')).toBe(false);
    expect(await verifyPassword('kasa1234', await hashPasswordForSeed('kasa1234'))).toBe(true);
    expect(await hashPassword('a')).not.toBe(await hashPassword('a'));
  });
});

describe('encryption (AES-256-GCM)', () => {
  it('şifreler, çözer, kurcalamayı yakalar', () => {
    const enc = createEncryptor(Buffer.alloc(32, 1).toString('base64'));
    const c = enc.encrypt('gizli-api-anahtari');
    expect(c.startsWith('v1:')).toBe(true);
    expect(enc.decrypt(c)).toBe('gizli-api-anahtari');
    expect(enc.encrypt('x')).not.toBe(enc.encrypt('x'));
    const parts = c.split(':');
    parts[3] = Buffer.from('baska').toString('base64');
    expect(() => enc.decrypt(parts.join(':'))).toThrow();
    expect(() => createEncryptor('kisa')).toThrow();
  });
});

describe('tokens', () => {
  it('rastgele token ve kodlar', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256Hex('a')).toHaveLength(64);
    for (let i = 0; i < 200; i++) {
      const code = generateOrderCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(/[2-9]/.test(code)).toBe(true);
      for (const ch of code) expect(ORDER_CODE_ALPHABET).toContain(ch);
    }
    expect(generateNumericCode()).toMatch(/^\d{6}$/);
  });
});

describe('takip token\'ı (14 §7.4)', () => {
  const id = '3b8992b6-2475-464e-ab7a-bae14e2208c4';
  it('üretilir, doğrulanır, imza bozulursa reddedilir', () => {
    const token = createTrackingToken(id, 'sir');
    const [idPart, sig] = token.split('.');
    expect(Buffer.from(idPart!, 'base64url')).toHaveLength(16);
    expect(sig).toHaveLength(16);
    expect(parseTrackingToken(token, 'sir')).toBe(id);
    expect(parseTrackingToken(token, 'baska-sir')).toBeNull();
    expect(parseTrackingToken(`${idPart}.AAAAAAAAAAAAAAAA`, 'sir')).toBeNull();
    expect(parseTrackingToken('bozuk', 'sir')).toBeNull();
    expect(createTrackingToken(id.toUpperCase(), 'sir')).toBe(token);
    expect(trackingUrl('http://localhost:3000/', id, 'sir')).toBe(`http://localhost:3000/t/${token}`);
  });
});

describe('rate limiter', () => {
  it('kova dolunca reddeder, anahtarlar bağımsız', () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect([1, 2, 3].map(() => rl.take('a').ok)).toEqual([true, true, true]);
    const r = rl.take('a');
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(rl.take('b').ok).toBe(true);
    rl.reset('a');
    expect(rl.take('a').ok).toBe(true);
  });
});

describe('config', () => {
  const base = {
    DATABASE_URL: 'postgres://x',
    SESSION_SECRET: '0123456789abcdef',
    TRACKING_SECRET: '12345678',
    ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  };
  it('varsayılanlar ve DEV_TOOLS', () => {
    const c = loadConfig({ ...base, DEV_TOOLS: '1' });
    expect(c.API_PORT).toBe(4000);
    expect(c.WA_DEFAULT_PROVIDER).toBe('mock');
    expect(c.DEV_TOOLS).toBe(true);
    expect(c.cookieSecure).toBe(false);
    expect(loadConfig({ ...base, DEV_TOOLS: '0' }).DEV_TOOLS).toBe(false);
    expect(loadConfig({ ...base, APP_BASE_URL: 'https://siparisinonunde.com' }).cookieSecure).toBe(true);
  });
  it('platform WhatsApp numarası kimliği şemada (boş → undefined)', () => {
    expect(loadConfig({ ...base, PLATFORM_WA_PHONE_NUMBER_ID: ' 1234567890 ' }).PLATFORM_WA_PHONE_NUMBER_ID).toBe('1234567890');
    expect(loadConfig({ ...base, PLATFORM_WA_PHONE_NUMBER_ID: '' }).PLATFORM_WA_PHONE_NUMBER_ID).toBeUndefined();
    expect(loadConfig(base).PLATFORM_WA_PHONE_NUMBER_ID).toBeUndefined();
  });
  it('geçersiz anahtar hata verir', () => {
    expect(() => loadConfig({ ...base, ENCRYPTION_KEY: 'kisa' })).toThrow(/ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });
});
