import { describe, expect, it } from 'vitest';
import { parseWaFormat } from './wa-format';

describe('WhatsApp metin biçimi', () => {
  it('ortak numara marka satırı kalın', () => {
    expect(parseWaFormat('*Bozok Pide Salonu*\nMerhaba!')).toEqual([{ text: 'Bozok Pide Salonu', bold: true }, { text: '\nMerhaba!' }]);
  });

  it('italik ve üstü çizili; birden çok parça', () => {
    expect(parseWaFormat('_not_ ve ~eski~ ve *yeni*')).toEqual([
      { text: 'not', italic: true },
      { text: ' ve ' },
      { text: 'eski', strike: true },
      { text: ' ve ' },
      { text: 'yeni', bold: true },
    ]);
  });

  it('kelime içi ve boşluklu işaretler biçimlenmez', () => {
    expect(parseWaFormat('2*3*4 = 24')).toEqual([{ text: '2*3*4 = 24' }]);
    expect(parseWaFormat('* madde *')).toEqual([{ text: '* madde *' }]);
    expect(parseWaFormat('dosya_adi_v2')).toEqual([{ text: 'dosya_adi_v2' }]);
  });

  it('düz metin olduğu gibi kalır', () => {
    expect(parseWaFormat('Sipariş kodu: K7M2Q9')).toEqual([{ text: 'Sipariş kodu: K7M2Q9' }]);
    expect(parseWaFormat('')).toEqual([{ text: '' }]);
  });
});
