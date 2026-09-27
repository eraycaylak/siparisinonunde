import { describe, expect, it } from 'vitest';
import { probeDevApi } from './dev-tools';

// /dev/whatsapp: web simülatörle derlenmiş olsa da API'nin geliştirici uçları kapalıysa (gerçek WhatsApp, 15 §13)
// sayfa simülatör yerine "Gerçek WhatsApp bağlı; simülatör kapalı" gösterir.
describe('probeDevApi', () => {
  const reply = (status: number) => async () => new Response('{}', { status });

  it('404 → kapalı; 200 → açık; diğer durum ve ağ hatası → bilinmiyor', async () => {
    expect(await probeDevApi(reply(404), 'http://api')).toBe('disabled');
    expect(await probeDevApi(reply(200), 'http://api')).toBe('available');
    expect(await probeDevApi(reply(500), 'http://api')).toBe('unknown');
    expect(
      await probeDevApi(async () => {
        throw new TypeError('fetch failed');
      }, 'http://api'),
    ).toBe('unknown');
  });

  it('API iç adresindeki geliştirici ucunu önbelleksiz sorar', async () => {
    const seen: { url: string; cache?: RequestCache }[] = [];
    await probeDevApi(async (url, init) => {
      seen.push({ url, cache: init?.cache });
      return new Response('{}', { status: 404 });
    }, 'http://127.0.0.1:4000/');
    expect(seen).toEqual([{ url: 'http://127.0.0.1:4000/api/v1/dev/wa/accounts', cache: 'no-store' }]);
  });
});
