import { describe, expect, it } from 'vitest';
import { resolveSubdomain } from '../proxy';

describe('alt alan adı çözümleme', () => {
  const root = 'siparisinonunde.com';
  it('işletme alt alan adı', () => {
    expect(resolveSubdomain('bozok-pide.siparisinonunde.com', root)).toBe('bozok-pide');
    expect(resolveSubdomain('Bozok-Pide.siparisinonunde.com:443', root)).toBe('bozok-pide');
  });
  it('kök, localhost ve IP devre dışı', () => {
    expect(resolveSubdomain('siparisinonunde.com', root)).toBeNull();
    expect(resolveSubdomain('localhost:3000', root)).toBeNull();
    expect(resolveSubdomain('127.0.0.1:3000', root)).toBeNull();
    expect(resolveSubdomain('bozok-pide.siparisinonunde.com', '')).toBeNull();
  });
  it('başka alan adı ve çok seviyeli alt alan adı yok sayılır', () => {
    expect(resolveSubdomain('a.b.siparisinonunde.com', root)).toBeNull();
    expect(resolveSubdomain('evil.com', root)).toBeNull();
  });
});
