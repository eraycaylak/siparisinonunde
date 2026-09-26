// Ortak numara: dükkan adı eşleşmesi (saf fonksiyon) — Türkçe karakter/ek/yazım hatası, genel sözcükler.

import { describe, expect, it } from 'vitest';
import { matchShopsByName, queryTokens } from '../src/services/messaging/shared-match';

const shops = [
  { tenantId: 'a', name: 'Bozok Pide Salonu' },
  { tenantId: 'b', name: 'Çamlık Döner' },
  { tenantId: 'c', name: 'Yozgat Pide Evi' },
  { tenantId: 'd', name: 'Şehir Kebap' },
];
const ids = (xs: { tenantId: string }[]) => xs.map((x) => x.tenantId);

describe('matchShopsByName', () => {
  it('adın tamamı ya da tüm sorgu sözcükleri → güçlü eşleşme', () => {
    expect(ids(matchShopsByName("Çamlık Döner'den sipariş vermek istiyorum", shops).strong)).toEqual(['b']);
    expect(ids(matchShopsByName('CAMLIK DONER', shops).strong)).toEqual(['b']);
    expect(ids(matchShopsByName('sehir kebap', shops).strong)).toEqual(['d']);
  });

  it('ek, kısaltma ve tek harf hatası tolere edilir', () => {
    expect(ids(matchShopsByName('bozoktan', shops).strong)).toEqual(['a']);
    expect(ids(matchShopsByName('camlk', shops).strong)).toEqual(['b']);
    expect(ids(matchShopsByName('boz', shops).strong)).toEqual(['a']);
  });

  it('ortak sözcük birden çok dükkana uyar', () => {
    expect(ids(matchShopsByName('pide', shops).strong)).toEqual(['a', 'c']);
  });

  it('selam ve genel sözcükler eşleşmez', () => {
    expect(queryTokens('Merhaba, sipariş vermek istiyorum')).toEqual([]);
    expect(matchShopsByName('merhaba', shops)).toMatchObject({ strong: [], weak: [], queryTokens: 0 });
    expect(matchShopsByName('iyi akşamlar menü var mı', shops)).toMatchObject({ strong: [], weak: [] });
  });

  it('uzun cümlede tek sözcük eşleşmesi zayıf sayılır', () => {
    const r = matchShopsByName('yarın akşam kebap yapıyor musunuz acaba', shops);
    expect(ids(r.strong)).toEqual([]);
    expect(ids(r.weak)).toEqual(['d']);
    expect(r.queryTokens).toBeGreaterThan(3);
  });
});
