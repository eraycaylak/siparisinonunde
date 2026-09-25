import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatElapsed,
  formatMoney,
  formatPercent,
  formatPhone,
  formatRelative,
  formatLira,
  formatTime,
  parseTlToKurus,
  searchKey,
  trUpper,
} from './format';

const MINUS = String.fromCharCode(0x2212);
const NBSP = String.fromCharCode(0xa0);

describe('format', () => {
  it('para: kuruş → varsayılan "123,45 TL" (12 §11.2), symbol → "₺" (core)', () => {
    expect(formatMoney(12345)).toBe('123,45 TL');
    expect(formatMoney(125050)).toBe('1.250,50 TL');
    expect(formatMoney(12345, 'symbol')).toBe('123,45 ₺');
    expect(formatMoney(125050, 'symbol')).toBe('1.250,50 ₺');
    expect(formatMoney(48500, 'text')).toBe('485,00 TL');
    expect(formatMoney(15000, 'short')).toBe('150 TL');
  });

  it('TL tutarı (fiyat tablosu, hesaplayıcı)', () => {
    expect(formatLira(990)).toBe(`990${NBSP}TL`);
    expect(formatLira(11404.8)).toBe(`11.404,80${NBSP}TL`);
    expect(formatLira(1253.4, { decimals: 'never' })).toBe(`1.253${NBSP}TL`);
    expect(formatLira(-40, { decimals: 'always' })).toBe(`${MINUS}40,00${NBSP}TL`);
  });

  it('yüzde', () => {
    expect(formatPercent(0.25)).toBe('%25');
    expect(formatPercent(0.025)).toBe('%2,5');
  });

  it('saat "20.35" ve tarih Europe/Istanbul', () => {
    // 17:35 UTC = 20.35 İstanbul
    expect(formatTime('2026-09-24T17:35:00Z')).toBe('20.35');
    expect(formatDate('2026-09-24T17:35:00Z')).toBe('24 Eylül Per');
    expect(formatTime('2026-09-24T21:05:00Z')).toBe('00.05');
  });

  it('göreli süre', () => {
    const now = new Date('2026-09-24T12:00:00Z');
    expect(formatRelative(new Date('2026-09-24T11:59:40Z'), now)).toBe('az önce');
    expect(formatRelative(new Date('2026-09-24T11:48:00Z'), now)).toBe('12 dk önce');
    expect(formatRelative(new Date('2026-09-24T09:00:00Z'), now)).toBe('3 sa önce');
    expect(formatRelative(new Date('2026-09-22T12:00:00Z'), now)).toBe('2 gün önce');
    expect(formatRelative(new Date('2026-09-24T12:05:00Z'), now)).toBe('5 dk sonra');
  });

  it('geçen süre sayacı', () => {
    expect(formatElapsed(134)).toBe('2:14');
    expect(formatElapsed(3723)).toBe('1:02:03');
  });

  it('telefon ve Türkçe harf', () => {
    expect(formatPhone('+905321234567')).toBe('0 (532) 123 45 67');
    expect(formatPhone('05321234567')).toBe('0 (532) 123 45 67');
    expect(trUpper('soğansız iskender')).toBe('SOĞANSIZ İSKENDER');
    expect(searchKey('Çiğ Köfte')).toBe('cig kofte');
  });

  it('TL girdisi → kuruş: Türkçe binlik nokta ve ondalık virgül ("1.000" bin liradır)', () => {
    expect(parseTlToKurus('1.000')).toBe(100_000);
    expect(parseTlToKurus('12.500')).toBe(1_250_000);
    expect(parseTlToKurus('1.250,50')).toBe(125_050);
    expect(parseTlToKurus('250,5')).toBe(25_050);
    expect(parseTlToKurus('500')).toBe(50_000);
    expect(parseTlToKurus(' 500 TL ')).toBe(50_000);
    expect(parseTlToKurus('200₺')).toBe(20_000);
    expect(parseTlToKurus('12.5')).toBe(1_250);
    expect(parseTlToKurus('99.99')).toBe(9_999);
    expect(parseTlToKurus('1000,')).toBe(100_000);
  });

  it('TL girdisi: geçersiz ya da negatif → null', () => {
    expect(parseTlToKurus('')).toBeNull();
    expect(parseTlToKurus('abc')).toBeNull();
    expect(parseTlToKurus('-50')).toBeNull();
    expect(parseTlToKurus('1.00.0')).toBeNull();
    expect(parseTlToKurus('1,000,00')).toBeNull();
    expect(parseTlToKurus('12,345')).toBeNull();
  });
});
