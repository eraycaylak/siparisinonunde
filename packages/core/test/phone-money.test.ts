import { describe, expect, it } from 'vitest';
import { formatKurus, formatTL, formatTLShort, formatTRY, parseTRY, roundHalfUp } from '../src/money';
import { formatPhone, isTrPhone, isValidTrMobile, maskPhone, normalizePhone, normalizeTrMobile, normalizeTrPhone } from '../src/phone';

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

// Yabancı numaralı müşteri (denetim 2026-10-04 madde 12 / soru 4): numara sessizce null dönüp sipariş düşmesin.
describe('yabancı numara (E.164)', () => {
  it('açıkça uluslararası yazılan numara kabul edilir', () => {
    expect(normalizePhone('+49 170 1234567')).toBe('+491701234567');
    expect(normalizePhone('0049 170 1234567')).toBe('+491701234567');
    expect(normalizePhone('+1 555 123 4567')).toBe('+15551234567');
    expect(normalizePhone('+44 7400 123456')).toBe('+447400123456');
  });

  it('önek yoksa ulusal numara TR sayılır; başka ülke tahmini yapılmaz', () => {
    // 10 hane, öneksiz: TR kuralı uygulanır (2–5 ile başlamalı)
    expect(normalizePhone('5321234567')).toBe('+905321234567');
    expect(normalizePhone('1701234567')).toBeNull();
    expect(normalizePhone('07400123456')).toBeNull();
  });

  it('ülke kodu 90 ise TR kuralları zorunlu (bozuk numara "yabancı" kılığında geçmez)', () => {
    expect(normalizePhone('+905321234567890')).toBeNull();
    expect(normalizePhone('+9012345')).toBeNull();
  });

  it('E.164 sınırları ve geçersizler', () => {
    expect(normalizePhone('+0491701234567')).toBeNull(); // ülke kodu 0 ile başlamaz
    expect(normalizePhone('+123456')).toBeNull(); // 8 haneden kısa
    expect(normalizePhone('+1234567890123456')).toBeNull(); // 15 haneden uzun
    expect(normalizePhone('+49 170 abc')).toBeNull();
  });

  it('Türkiye kapıları yabancı numarayı reddeder (SMS/OTP yolu)', () => {
    expect(normalizeTrMobile('+49 170 1234567')).toBeNull();
    expect(normalizeTrPhone('+49 170 1234567')).toBeNull();
    expect(isTrPhone('+491701234567')).toBe(false);
    expect(isTrPhone('+905321234567')).toBe(true);
    expect(isTrPhone('0532 123 45 67')).toBe(true);
    expect(isTrPhone(null)).toBe(false);
  });

  it('gösterim ve maskeleme ülke kodunu TR biçimine zorlamaz', () => {
    expect(formatPhone('+491701234567')).toBe('+491701234567');
    expect(formatPhone('+18501234567')).toBe('+18501234567');
    expect(maskPhone('+491701234567')).toBe('+*** *** 45 67');
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
