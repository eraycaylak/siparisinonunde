import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPassthroughPath, resolveSubdomain } from '../proxy';

describe('alt alan adı çözümleme', () => {
  const root = 'yemekgelsin.net';
  it('işletme alt alan adı', () => {
    expect(resolveSubdomain('bozok-pide.yemekgelsin.net', root)).toBe('bozok-pide');
    expect(resolveSubdomain('Bozok-Pide.yemekgelsin.net:443', root)).toBe('bozok-pide');
  });
  it('kök, localhost ve IP devre dışı', () => {
    expect(resolveSubdomain('yemekgelsin.net', root)).toBeNull();
    expect(resolveSubdomain('localhost:3000', root)).toBeNull();
    expect(resolveSubdomain('127.0.0.1:3000', root)).toBeNull();
    expect(resolveSubdomain('bozok-pide.yemekgelsin.net', '')).toBeNull();
  });
  it('başka alan adı ve çok seviyeli alt alan adı yok sayılır', () => {
    expect(resolveSubdomain('a.b.yemekgelsin.net', root)).toBeNull();
    expect(resolveSubdomain('evil.com', root)).toBeNull();
  });
});

describe('alt alan adında olduğu gibi bırakılan yollar', () => {
  it('QR kısa bağlantısı /q/<kod> (O4), takip, kısa menü, API vitrin yoluna yazılmaz', () => {
    for (const p of ['/q/BOZOK', '/q/bozok', '/t/abc', '/m/Ab3xK9pQw2Zt', '/s/bozok-pide', '/api/v1/store/x', '/_next/static/a.js', '/brand/logo.svg']) {
      expect(isPassthroughPath(p), p).toBe(true);
    }
    for (const p of ['/', '/siparis', '/yasal/aydinlatma', '/qr', '/quiz']) expect(isPassthroughPath(p), p).toBe(false);
  });
});

describe('proxy (NEXT_PUBLIC_ROOT_DOMAIN açık)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function run(url: string) {
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'yemekgelsin.net');
    vi.resetModules();
    const { proxy } = await import('../proxy');
    const u = new URL(url);
    return proxy(new NextRequest(url, { headers: { host: u.host } }));
  }

  it('işletme alt alan adında /q/<kod> olduğu gibi geçer (vitrine yazılmaz); diğer yollar /s/<slug> altına yazılır', async () => {
    const qr = await run('https://bozok-pide.yemekgelsin.net/q/BOZOK');
    expect(qr.headers.get('x-middleware-rewrite')).toBeNull();
    expect(qr.headers.get('x-middleware-next')).toBe('1');
    const menu = await run('https://bozok-pide.yemekgelsin.net/siparis?x=1');
    expect(menu.headers.get('x-middleware-rewrite')).toBe('https://bozok-pide.yemekgelsin.net/s/bozok-pide/siparis?x=1');
  });

  it('kök alan adında /q/<kod> dokunulmadan geçer', async () => {
    const res = await run('https://yemekgelsin.net/q/BOZOK');
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
