import { describe, expect, it } from 'vitest';
import { resolveSubdomain } from '../proxy';

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
