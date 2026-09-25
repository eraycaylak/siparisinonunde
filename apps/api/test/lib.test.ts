// DB gerektirmeyen yardımcılar: parola, şifreleme, token, takip token'ı, hız sınırı, yapılandırma.

import { describe, expect, it } from 'vitest';
import { devToolsAllowed, loadConfig, productionConfigWarnings } from '../src/config';
import { createEncryptor } from '../src/lib/encryption';
import { redactUrlForLog } from '../src/lib/log';
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
  describe('üretim (fail-fast)', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      SESSION_SECRET: 'q9Vd1x7Wm2Lp8Zr4Tn6Yb3Kc5Hs0Jf1Ga9Ue7Io2',
      TRACKING_SECRET: 'Rt5Yh8Nm2Kq7Wx3Zc9Vb1Lp4Sd6Fg0Hj8Aa',
      WA_VERIFY_TOKEN: '3f9c1a7e5b2d4c6e8a0b1c2d3e4f5a6b',
      DEV_TOOLS: '0',
    };
    it('geçerli üretim yapılandırması yüklenir; taklit sağlayıcılar yalnız uyarı', () => {
      const c = loadConfig(prod);
      expect(c.DEV_TOOLS).toBe(false);
      expect(productionConfigWarnings(c)).toHaveLength(3);
      expect(productionConfigWarnings(loadConfig({ ...base, DEV_TOOLS: '1' }))).toEqual([]);
    });
    it('DEV_TOOLS=1 üretimde reddedilir', () => {
      expect(() => loadConfig({ ...prod, DEV_TOOLS: '1' })).toThrow(/DEV_TOOLS/);
      expect(() => loadConfig({ ...prod, DEV_TOOLS: 'true' })).toThrow(/DEV_TOOLS/);
    });
    it('örnek/kısa gizli anahtarlar ve boş doğrulama belirteci reddedilir', () => {
      expect(() => loadConfig({ ...prod, SESSION_SECRET: 'dev-only-change-me-32chars-minimum' })).toThrow(/SESSION_SECRET/);
      expect(() => loadConfig({ ...prod, TRACKING_SECRET: 'dev-only-tracking-secret' })).toThrow(/TRACKING_SECRET/);
      expect(() => loadConfig({ ...prod, WA_VERIFY_TOKEN: '' })).toThrow(/WA_VERIFY_TOKEN/);
      expect(() => loadConfig({ ...prod, WA_VERIFY_TOKEN: undefined })).toThrow(/WA_VERIFY_TOKEN/);
    });
    it('seçilen gerçek sağlayıcının anahtarları eksikse reddedilir', () => {
      expect(() => loadConfig({ ...prod, SMS_PROVIDER: 'netgsm', NETGSM_USERCODE: 'u', NETGSM_PASSWORD: '' })).toThrow(/NETGSM/);
      expect(loadConfig({ ...prod, SMS_PROVIDER: 'netgsm', NETGSM_USERCODE: 'u', NETGSM_PASSWORD: 'p', NETGSM_HEADER: 'SIPARISNDE' }).SMS_PROVIDER).toBe('netgsm');
      expect(() => loadConfig({ ...prod, PLATFORM_WA_PROVIDER: 'd360', PLATFORM_WA_API_KEY: '' })).toThrow(/PLATFORM_WA_API_KEY/);
      expect(() => loadConfig({ ...prod, PLATFORM_WA_PROVIDER: 'cloud', PLATFORM_WA_API_KEY: 'k' })).toThrow(/PLATFORM_WA_PHONE_NUMBER_ID/);
      expect(loadConfig({ ...prod, PLATFORM_WA_PROVIDER: 'd360', PLATFORM_WA_API_KEY: 'k' }).PLATFORM_WA_PROVIDER).toBe('d360');
    });
    it('dev dağıtımı (DEPLOY_ENV=dev): DEV_TOOLS yalnız tüm sağlayıcılar mock iken kabul edilir', () => {
      const dev = { ...prod, DEPLOY_ENV: 'dev', DEV_TOOLS: '1' };
      const c = loadConfig(dev);
      expect(c.DEV_TOOLS).toBe(true);
      expect(devToolsAllowed(c)).toBe(true);
      expect(() => loadConfig({ ...dev, SMS_PROVIDER: 'netgsm', NETGSM_USERCODE: 'u', NETGSM_PASSWORD: 'p', NETGSM_HEADER: 'H' })).toThrow(/DEV_TOOLS/);
      expect(() => loadConfig({ ...dev, PLATFORM_WA_PROVIDER: 'd360', PLATFORM_WA_API_KEY: 'k' })).toThrow(/DEV_TOOLS/);
      expect(() => loadConfig({ ...dev, WA_DEFAULT_PROVIDER: 'd360' })).toThrow(/DEV_TOOLS/);
      // Dev dağıtımı zayıf gizli anahtarları affetmez
      expect(() => loadConfig({ ...dev, SESSION_SECRET: 'dev-only-change-me-32chars-minimum' })).toThrow(/SESSION_SECRET/);
      expect(() => loadConfig({ ...dev, DEPLOY_ENV: 'staging' })).toThrow(/DEPLOY_ENV/);
      expect(devToolsAllowed(loadConfig(prod))).toBe(false);
    });
    it('geliştirme/test ortamında bu kurallar uygulanmaz', () => {
      expect(loadConfig({ ...base, DEV_TOOLS: '1', SMS_PROVIDER: 'netgsm' }).DEV_TOOLS).toBe(true);
    });
  });
});

describe('log URL maskeleme', () => {
  it('sorgu değerleri ve yol belirteçleri maskelenir', () => {
    expect(redactUrlForLog('/api/v1/panel/orders/manual/customers?phone=05321234567')).toBe('/api/v1/panel/orders/manual/customers?phone=***');
    expect(redactUrlForLog('/api/v1/panel/conversations?q=0532&limit=20')).toBe('/api/v1/panel/conversations?q=***&limit=***');
    expect(redactUrlForLog('/api/v1/store/track/abc.def/cancel')).toBe('/api/v1/store/track/***/cancel');
    expect(redactUrlForLog('/api/v1/webhooks/wa/wh-token-1?hub.verify_token=x')).toBe('/api/v1/webhooks/wa/***?hub.verify_token=***');
    expect(redactUrlForLog('/api/v1/health')).toBe('/api/v1/health');
    expect(redactUrlForLog('/api/v1/health?')).toBe('/api/v1/health');
  });
});
