// Tasarruf raporu oranı girdisi (denetim "Para" maddesi · docs/04 §11.3 · FAZ 2.5).
// Regresyon: eski form `Number('')` → 0'ı geçerli bir oran sayıyordu; boş alan sessizce "%0" olarak kaydediliyor,
// rapor da bunu girilmiş oran kabul edip tutar basıyordu. Artık boş alan "girilmedi" demektir.

import { describe, expect, it } from 'vitest';
import { COMMISSION_NOT_ENTERED_BP, commissionRateInput, parseCommissionRate } from './commission-rate';

describe('parseCommissionRate', () => {
  it('yüzdeyi baz puana çevirir', () => {
    expect(parseCommissionRate('25')).toEqual({ kind: 'valid', bp: 2500 });
    expect(parseCommissionRate('25,5')).toEqual({ kind: 'valid', bp: 2550 });
    expect(parseCommissionRate('60')).toEqual({ kind: 'valid', bp: 6000 });
  });

  it('boş alan ve %0 "girilmedi" demektir', () => {
    expect(parseCommissionRate('')).toEqual({ kind: 'empty', bp: COMMISSION_NOT_ENTERED_BP });
    expect(parseCommissionRate('  ')).toEqual({ kind: 'empty', bp: COMMISSION_NOT_ENTERED_BP });
    expect(parseCommissionRate('0')).toEqual({ kind: 'empty', bp: COMMISSION_NOT_ENTERED_BP });
  });

  it('sınır dışı ve sayı olmayan girdi geçersizdir', () => {
    expect(parseCommissionRate('61').kind).toBe('invalid');
    expect(parseCommissionRate('abc').kind).toBe('invalid');
    expect(parseCommissionRate('-5').kind).toBe('invalid');
  });
});

describe('commissionRateInput', () => {
  it('baz puanı forma yazar; girilmemiş oran boş alandır', () => {
    expect(commissionRateInput(2500)).toBe('25');
    expect(commissionRateInput(2550)).toBe('25,5');
    expect(commissionRateInput(COMMISSION_NOT_ENTERED_BP)).toBe('');
    expect(commissionRateInput(null)).toBe('');
    expect(commissionRateInput(undefined)).toBe('');
  });

  it('gidiş-dönüş: forma yazılan değer aynı baz puana geri çözülür', () => {
    for (const bp of [1500, 2500, 2550, 3500, 6000]) {
      expect(parseCommissionRate(commissionRateInput(bp))).toEqual({ kind: 'valid', bp });
    }
  });
});
