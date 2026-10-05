// Bölge dışı istisna ücreti ayrıştırması (denetim "Para" maddesi · FAZ 2.5).
// Regresyon: eski kod `Math.round(Number(input.replace(',', '.')) * 100)` kullanıyordu; kasiyer "1.000" yazınca
// (Türkçe yazımda bin lira) siparişe 1,00 TL teslimat ücreti giriyordu ve geçersiz girdide NaN gönderiliyordu.

import { describe, expect, it } from 'vitest';
import { OUT_OF_ZONE_FEE_MAX_KURUS, outOfZoneFeeError, outOfZoneFeeKurus, parseOutOfZoneFee } from './out-of-zone-fee';

describe('parseOutOfZoneFee', () => {
  it('Türkçe yazımı doğru çevirir: binlik nokta, ondalık virgül', () => {
    expect(parseOutOfZoneFee('1.000')).toEqual({ kind: 'valid', kurus: 100_000 });
    expect(parseOutOfZoneFee('1.250,50')).toEqual({ kind: 'valid', kurus: 125_050 });
    expect(parseOutOfZoneFee('25,5')).toEqual({ kind: 'valid', kurus: 2550 });
    expect(parseOutOfZoneFee('50')).toEqual({ kind: 'valid', kurus: 5000 });
    expect(parseOutOfZoneFee(' 75 TL ')).toEqual({ kind: 'valid', kurus: 7500 });
  });

  it('boş alan ücretsiz istisnadır', () => {
    expect(parseOutOfZoneFee('')).toEqual({ kind: 'empty', kurus: 0 });
    expect(parseOutOfZoneFee('   ')).toEqual({ kind: 'empty', kurus: 0 });
  });

  it('geçersiz girdide sunucuya NaN/negatif gitmez', () => {
    expect(parseOutOfZoneFee('abc').kind).toBe('invalid');
    expect(parseOutOfZoneFee('-50').kind).toBe('invalid');
    expect(parseOutOfZoneFee('1,000,00').kind).toBe('invalid');
    expect(parseOutOfZoneFee('1.00.0').kind).toBe('invalid');
    expect(parseOutOfZoneFee(',').kind).toBe('invalid');
  });

  it('üst sınır: taşma yoluna dönüşecek tutarı reddeder', () => {
    expect(parseOutOfZoneFee('10.000')).toEqual({ kind: 'valid', kurus: OUT_OF_ZONE_FEE_MAX_KURUS });
    expect(parseOutOfZoneFee('10.001').kind).toBe('too_large');
    expect(parseOutOfZoneFee('99.999.999').kind).toBe('too_large');
  });
});

describe('outOfZoneFeeKurus / outOfZoneFeeError', () => {
  it('geçerli ve boş girdide tutar, geçersizde null döner', () => {
    expect(outOfZoneFeeKurus(parseOutOfZoneFee('1.000'))).toBe(100_000);
    expect(outOfZoneFeeKurus(parseOutOfZoneFee(''))).toBe(0);
    expect(outOfZoneFeeKurus(parseOutOfZoneFee('abc'))).toBeNull();
    expect(outOfZoneFeeKurus(parseOutOfZoneFee('20.000'))).toBeNull();
  });

  it('hata metni yalnız geçersiz girdide çıkar', () => {
    expect(outOfZoneFeeError(parseOutOfZoneFee('1.000'))).toBeNull();
    expect(outOfZoneFeeError(parseOutOfZoneFee(''))).toBeNull();
    expect(outOfZoneFeeError(parseOutOfZoneFee('abc'))).toContain('Geçerli bir tutar');
    expect(outOfZoneFeeError(parseOutOfZoneFee('20.000'))).toContain('10.000 TL');
  });
});
