import { describe, expect, it } from 'vitest';
import { formatKurus, formatTL, formatTLShort, formatTRY, parseTRY, roundHalfUp } from '../src/money';
import { formatPhone, isValidTrMobile, maskPhone, normalizePhone, normalizeTrMobile } from '../src/phone';

describe('phone', () => {
  it('normalize → +905XXXXXXXXX', () => {
    for (const input of ['05321234567', '5321234567', '+90 532 123 45 67', '0090 532 123 4567', '905321234567', '(0532) 123-45-67']) {
      expect(normalizeTrMobile(input)).toBe('+905321234567');
    }
  });
  it('geçersizler', () => {
    for (const input of ['', '123', '0532123456', '053212345678', '+1 555 123 4567', 'abc5321234567', '1321234567']) {
      expect(normalizeTrMobile(input)).toBeNull();
    }
    expect(normalizeTrMobile(null)).toBeNull();
  });
  it('sabit hat yalnız genel normalize ile', () => {
    expect(normalizePhone('0354 212 00 00')).toBe('+903542120000');
    expect(normalizeTrMobile('0354 212 00 00')).toBeNull();
    expect(isValidTrMobile('0532 123 45 67')).toBe(true);
  });
  it('mask ve format', () => {
    expect(maskPhone('+905321234567')).toBe('0*** *** 45 67');
    expect(maskPhone('0532 123 45 67')).toBe('0*** *** 45 67');
    expect(maskPhone('')).toBe('');
    expect(formatPhone('+905321234567')).toBe('0532 123 45 67');
  });
});

describe('money', () => {
  it('formatTRY', () => {
    expect(formatTRY(12345)).toBe('123,45 ₺');
    expect(formatTRY(0)).toBe('0,00 ₺');
    expect(formatTRY(123456789)).toBe('1.234.567,89 ₺');
    expect(formatTRY(-5)).toBe('-0,05 ₺');
    expect(formatTL(48500)).toBe('485,00 TL');
    expect(formatTLShort(15000)).toBe('150 TL');
    expect(formatTLShort(12345)).toBe('123,45 TL');
    expect(formatKurus(100000)).toBe('1.000,00');
  });
  it('parseTRY', () => {
    expect(parseTRY('123,45')).toBe(12345);
    expect(parseTRY('1.234,56 ₺')).toBe(123456);
    expect(parseTRY('1234.5')).toBe(123450);
    expect(parseTRY('150 TL')).toBe(15000);
    expect(parseTRY('1.000')).toBe(100000);
    expect(parseTRY('0,5')).toBe(50);
    expect(parseTRY('abc')).toBeNull();
    expect(parseTRY('1,2,3')).toBeNull();
    expect(parseTRY('')).toBeNull();
  });
  it('roundHalfUp', () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.4999)).toBe(1);
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });
});

import { isValidSlug, slugifyTr } from '../src/slug';

describe('slug', () => {
  it('Türkçe karakterler ve biçim', () => {
    expect(slugifyTr('Bozok Pide Salonu')).toBe('bozok-pide-salonu');
    expect(slugifyTr('  Çağ Döner & Izgara İŞLETMESİ ')).toBe('cag-doner-izgara-isletmesi');
    expect(isValidSlug('bozok-pide')).toBe(true);
    expect(isValidSlug('ab')).toBe(false);
    expect(isValidSlug('admin')).toBe(false);
    expect(isValidSlug('a--b')).toBe(false);
  });
});
