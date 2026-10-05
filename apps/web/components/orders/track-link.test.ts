import { describe, expect, it } from 'vitest';
import { isTrackingToken, trackingPath } from './track-link';

const VALID = 'aZ09kQmT7xR2bN4pL8vC1s';

describe('isTrackingToken', () => {
  it('base62 + URL-güvenli token kabul edilir', () => {
    expect(isTrackingToken(VALID)).toBe(true);
    expect(isTrackingToken('abcd1234')).toBe(true);
    expect(isTrackingToken('a-b_c-d1')).toBe(true);
  });

  it('boş, kısa, dizge olmayan ve yola yazılamayacak değerler reddedilir', () => {
    expect(isTrackingToken('')).toBe(false);
    expect(isTrackingToken('kisa')).toBe(false);
    expect(isTrackingToken(undefined)).toBe(false);
    expect(isTrackingToken(null)).toBe(false);
    expect(isTrackingToken(12345678)).toBe(false);
    expect(isTrackingToken('a'.repeat(65))).toBe(false);
  });

  it('yol/şema enjeksiyonu reddedilir', () => {
    expect(isTrackingToken('../../panel')).toBe(false);
    expect(isTrackingToken('abcd1234/../panel')).toBe(false);
    expect(isTrackingToken('javascript:alert(1)')).toBe(false);
    expect(isTrackingToken('//evil.example.com')).toBe(false);
    expect(isTrackingToken('abcd 1234')).toBe(false);
    expect(isTrackingToken('abcd1234?x=1')).toBe(false);
  });
});

describe('trackingPath', () => {
  it('geçerli token → /t/<token>', () => {
    expect(trackingPath(VALID)).toBe(`/t/${VALID}`);
  });

  it('geçersiz token → null (çağıran açıklama gösterir, /t/ adresine gidilmez)', () => {
    expect(trackingPath('')).toBeNull();
    expect(trackingPath(undefined)).toBeNull();
    expect(trackingPath('javascript:alert(1)')).toBeNull();
  });
});
