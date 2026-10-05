import { describe, expect, it } from 'vitest';
import { isTrackingToken, trackingPath } from './track-link';

// GERÇEK biçim (apps/api/src/lib/tracking.ts): base64url(16 bayt).base64url(hmac)[0..16] — nokta ZORUNLU.
// Bu örnek, gerçek üretici çalıştırılarak alındı; nokta kabul edilmediği için Akış B canlıda kırılmıştı (05.10.2026).
const VALID = 'P75HSYeVRla77zQB9znz1g.oIWW0Bfm9h_quhFk';

describe('isTrackingToken', () => {
  it('base62 + URL-güvenli token kabul edilir', () => {
    expect(isTrackingToken(VALID)).toBe(true);
    // URL-güvenli ayraçlar (base64url alfabesi) iki yanda da geçerli
    expect(isTrackingToken('aZ09kQmT7xR2bN4pL8vC1s.a-b_c-d1')).toBe(true);
  });

  it('boş, kısa, dizge olmayan ve yola yazılamayacak değerler reddedilir', () => {
    expect(isTrackingToken('')).toBe(false);
    expect(isTrackingToken('kisa')).toBe(false);
    // Noktasız (eski, hatalı varsayım) ve iki yanı boş nokta reddedilir
    expect(isTrackingToken('aZ09kQmT7xR2bN4pL8vC1s')).toBe(false);
    expect(isTrackingToken('.oIWW0Bfm9h_quhFk')).toBe(false);
    expect(isTrackingToken('P75HSYeVRla77zQB9znz1g.')).toBe(false);
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
