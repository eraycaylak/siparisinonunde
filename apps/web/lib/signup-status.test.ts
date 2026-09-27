import { describe, expect, it } from 'vitest';
import { SIGNUP_SOON, probeSignupStatus } from './signup-status';

// Kayıt sayfası: signup_open kapalıyken (Cloudflare ortamı; 00 §12a madde 10) form yerine "Kayıtlar çok yakında açılıyor".
describe('probeSignupStatus', () => {
  const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it('open: true → açık; open: false → kapalı; hata ya da beklenmeyen gövde → bilinmiyor (form gösterilir)', async () => {
    expect(await probeSignupStatus(reply(200, { open: true }), 'http://api')).toBe('open');
    expect(await probeSignupStatus(reply(200, { open: false }), 'http://api')).toBe('closed');
    expect(await probeSignupStatus(reply(200, {}), 'http://api')).toBe('unknown');
    expect(await probeSignupStatus(reply(500, { open: false }), 'http://api')).toBe('unknown');
    expect(
      await probeSignupStatus(async () => {
        throw new TypeError('fetch failed');
      }, 'http://api'),
    ).toBe('unknown');
  });

  it('API iç adresindeki herkese açık ucu önbelleksiz sorar', async () => {
    const seen: { url: string; cache?: RequestCache }[] = [];
    await probeSignupStatus(async (url, init) => {
      seen.push({ url, cache: init?.cache });
      return new Response('{"open":true}', { status: 200 });
    }, 'http://127.0.0.1:4000/');
    expect(seen).toEqual([{ url: 'http://127.0.0.1:4000/api/v1/public/signup-status', cache: 'no-store' }]);
  });

  it('bilgi metni iletişim formuna yönlendirir', () => {
    expect(SIGNUP_SOON.title).toBe('Kayıtlar çok yakında açılıyor');
    expect(SIGNUP_SOON.href).toBe('/demo');
  });
});
