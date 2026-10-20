// QR kısa bağlantısı (/q/<kod>; 00 §12a madde 11, O4): kod normalize edilir, API'den yalnız slug alınır, müşterinin IP'si
// iletilir; bilinmeyen/biçimsiz kod (API 404) `unknown` (listesiz nötr sayfa), geçici hata (429, 5xx, zaman aşımı, ağ,
// bozuk yanıt) `unavailable` (503 "yeniden deneyin"; geçerli QR "bağlı değil" diye gösterilmez). Yönlendirme hedefi
// işletmenin vitrini + ?src=qr; route handler 302 döner (redirect() 307 olurdu).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { qrTarget, qrUnavailableHtml, resolveQrCode } from './qr-link';

const ok = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('resolveQrCode', () => {
  it('kod büyük harfe katlanır; API yalnız slug döner; müşterinin X-Forwarded-For başlığı iletilir', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const r = await resolveQrCode(' #bözok ', {
      forwardedFor: '203.0.113.9',
      apiOrigin: 'http://api:4000/',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return ok({ slug: 'bozok-pide' })();
      },
    });
    expect(r).toEqual({ kind: 'found', slug: 'bozok-pide' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://api:4000/api/v1/public/q/BOZOK');
    expect((calls[0]!.init?.headers as Record<string, string>)['x-forwarded-for']).toBe('203.0.113.9');
  });

  it('biçimsiz kod API\'ye hiç sorulmaz ve API 404 → unknown (nötr "bulunamadı" sayfası)', async () => {
    let called = false;
    const spy = async () => {
      called = true;
      return ok({ slug: 'x' })();
    };
    for (const bad of ['', 'ab', '../../admin', 'a'.repeat(40)]) expect(await resolveQrCode(bad, { fetchImpl: spy })).toEqual({ kind: 'unknown' });
    expect(called).toBe(false);
    expect(await resolveQrCode('BOZOK', { fetchImpl: ok({ error: { code: 'not_found' } }, 404) })).toEqual({ kind: 'unknown' });
  });

  it('geçici hata unknown SAYILMAZ: 429 oran sınırı, 5xx, ağ hatası/zaman aşımı ve bozuk yanıt → unavailable (açık yönlendirme yok)', async () => {
    const unavailable = { kind: 'unavailable' };
    expect(await resolveQrCode('BOZOK', { fetchImpl: ok({ error: { code: 'rate_limited' } }, 429) })).toEqual(unavailable);
    expect(await resolveQrCode('BOZOK', { fetchImpl: ok({ error: { code: 'internal' } }, 500) })).toEqual(unavailable);
    expect(await resolveQrCode('BOZOK', { fetchImpl: ok({}, 503) })).toEqual(unavailable);
    expect(await resolveQrCode('BOZOK', { fetchImpl: async () => { throw new DOMException('zaman aşımı', 'TimeoutError'); } })).toEqual(unavailable);
    expect(await resolveQrCode('BOZOK', { fetchImpl: async () => { throw new Error('ağ'); } })).toEqual(unavailable);
    expect(await resolveQrCode('BOZOK', { fetchImpl: ok({ slug: 42 }) })).toEqual(unavailable);
    expect(await resolveQrCode('BOZOK', { fetchImpl: ok({ slug: 'https://evil.example/' }) })).toEqual(unavailable);
  });

  it('geçici hata sayfası: listesiz, platform/panel bağlantısı yok; tek bağlantı aynı QR adresi; kaçışlı', () => {
    const html = qrUnavailableHtml('/q/BOZOK');
    expect(html).toContain('Sayfa şu an açılamadı');
    expect(html).toContain('yeniden deneyin');
    expect(html).not.toMatch(/bulunamadı|bağlı değil/);
    expect(html.match(/href="/g)).toHaveLength(1);
    expect(html).toContain('href="/q/BOZOK"');
    expect(html).not.toMatch(/panel|Yemek Gelsin|dükkanlar|öneri/i);
    expect(qrUnavailableHtml('/q/"><script>alert(1)</script>')).not.toMatch(/<script|"><|alert\(1\)"/);
  });

  it('hedef: vitrinin herkese açık adresi + ?src=qr (sondaki eğik çizgi yok)', () => {
    expect(qrTarget('bozok-pide')).toMatch(/\/s\/bozok-pide\?src=qr$/);
  });
});

describe('GET /q/[code] (route handler)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function hit(code: string, apiBody: unknown, status = 200) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(apiBody), { status, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await import('../app/q/[code]/route');
    const res = await GET(new Request(`http://localhost:3000/q/${code}`, { headers: { 'x-forwarded-for': '198.51.100.4' } }), {
      params: Promise.resolve({ code }),
    });
    return { res, fetchMock };
  }

  it('bilinen kod → 302 vitrin (?src=qr), önbelleğe alınmaz', async () => {
    const { res, fetchMock } = await hit('bozok', { slug: 'bozok-pide' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/\/s\/bozok-pide\?src=qr$/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bilinmeyen kod → 302 /q (listesiz nötr sayfa); hedefte başka işletme yok', async () => {
    const { res } = await hit('YOKBOYLE', { error: { code: 'not_found' } }, 404);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/\/q$/);
  });

  it('API 429 ya da 5xx → 503 + Retry-After "yeniden deneyin" sayfası (302 /q "bulunamadı" DEĞİL), önbelleğe alınmaz', async () => {
    for (const status of [429, 500, 502]) {
      const { res } = await hit('bozok', { error: { code: 'x' } }, status);
      expect(res.status, String(status)).toBe(503);
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('retry-after')).toBe('5');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-type')).toMatch(/^text\/html/);
      const html = await res.text();
      expect(html).toContain('href="/q/BOZOK"');
      expect(html).not.toContain('bulunamadı');
    }
  });
});
