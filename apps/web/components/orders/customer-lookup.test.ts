// Müşteri arama — saf mantık (04 §4.13). Davranış (istek, yarış, klavye) `customer-picker.test.tsx`te.

import { describe, expect, it } from 'vitest';
import { lookupKey, lookupTerm, nextActive } from './customer-lookup';

describe('lookupTerm', () => {
  it('telefonda yalnız rakamları bırakır (biçim karakterleri yeni anahtar üretmesin)', () => {
    expect(lookupTerm('phone', '0 (532) 123 45 67')).toBe('05321234567');
    expect(lookupTerm('phone', '+90 532')).toBe('90532');
  });

  it('ilk rakamdan itibaren terim üretir: "0" aranabilir bir terimdir', () => {
    // Sunucu "0"ı süzgeçsiz dala çevirir (en son sipariş verenler). İstemci burada BOŞ dizge üretirse
    // istek hiç atılmaz ve Eray'ın gördüğü "hiçbir şey olmuyor" davranışı geri gelir.
    expect(lookupTerm('phone', '0')).toBe('0');
    expect(lookupTerm('phone', '')).toBe('');
    expect(lookupTerm('phone', '   ')).toBe('');
  });

  it('adda Türkçe harf katlaması uygular (SQL ifade indeksinin ikizi)', () => {
    expect(lookupTerm('name', 'Ahm')).toBe('ahm');
    expect(lookupTerm('name', 'AHMET')).toBe('ahmet');
    expect(lookupTerm('name', 'ÇİĞDEM')).toBe('cigdem');
    expect(lookupTerm('name', '  Şükrü  ')).toBe('sukru');
  });

  it('ilk harften itibaren terim üretir ve boşluk tek başına arama saymaz', () => {
    expect(lookupTerm('name', 'a')).toBe('a');
    expect(lookupTerm('name', ' ')).toBe('');
  });

  it('büyük/küçük harf ve biçim farkı AYNI önbellek anahtarını verir', () => {
    expect(lookupKey('name', lookupTerm('name', 'AHM'))).toEqual(lookupKey('name', lookupTerm('name', 'ahm')));
    expect(lookupKey('phone', lookupTerm('phone', '0 (532)'))).toEqual(lookupKey('phone', lookupTerm('phone', '0532')));
  });

  it('telefon ve ad dalları ayrı anahtarda durur', () => {
    expect(lookupKey('phone', '532')).not.toEqual(lookupKey('name', '532'));
  });
});

describe('nextActive', () => {
  it('hiçbir satır etkin değilken ↓ ilk satıra, ↑ son satıra gider', () => {
    expect(nextActive(-1, 3, 1)).toBe(0);
    expect(nextActive(-1, 3, -1)).toBe(2);
  });

  it('uçlarda döner', () => {
    expect(nextActive(2, 3, 1)).toBe(0);
    expect(nextActive(0, 3, -1)).toBe(2);
  });

  it('boş listede etkin satır yoktur', () => {
    expect(nextActive(-1, 0, 1)).toBe(-1);
    expect(nextActive(1, 0, -1)).toBe(-1);
  });
});
