// Ortak numara (00 §12a madde 8): dükkan kodu, ön-dolu metin, wa.me bağlantısı, #KOD ayrıştırma, şablon kuralı.

import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_TEMPLATES,
  RESERVED_WA_CODES,
  SHOP_LIST_COMMANDS,
  SHOP_PICKER_COMMANDS,
  brandedText,
  extractHashCodes,
  looksLikeOrderCode,
  normalizeWaCode,
  pickWaCode,
  sharedPrefillText,
  sharedWaLink,
  waCodeBase,
  waCodeCandidate,
  waCodeProblem,
} from '../src/index';

describe('dükkan kodu', () => {
  it('normalize: Türkçe harf, küçük harf, boşluk/#/tire atılır; geçersizse null', () => {
    expect(normalizeWaCode('bozok')).toBe('BOZOK');
    expect(normalizeWaCode('#Döner')).toBe('DONER');
    expect(normalizeWaCode(' çamlık-döner ')).toBe('CAMLIKDONER');
    expect(normalizeWaCode('pide1')).toBe('PIDE1');
    expect(normalizeWaCode('İşçi')).toBe('ISCI');
    expect(normalizeWaCode('ab')).toBeNull();
    expect(normalizeWaCode('ABCDEFGHIJKLM')).toBeNull();
    expect(normalizeWaCode('kod!')).toBeNull();
    expect(normalizeWaCode(null)).toBeNull();
  });

  it('kullanılabilirlik: biçim, ayrılmış komut sözcükleri, sipariş koduna benzeyen', () => {
    expect(waCodeProblem('BOZOK')).toBeNull();
    expect(waCodeProblem('LISTE')).toBe('reserved');
    expect(waCodeProblem('DUR')).toBe('reserved');
    expect(waCodeProblem('K7M2Q9')).toBe('order_code');
    expect(looksLikeOrderCode('KEBAP2')).toBe(true);
    expect(looksLikeOrderCode('KEBAPS')).toBe(false);
    expect(looksLikeOrderCode('KEBAP10')).toBe(false);
    expect(waCodeProblem('ab')).toBe('format');
    for (const c of RESERVED_WA_CODES) expect(c).toMatch(/^[A-Z0-9]+$/);
  });

  it('yalnız rakamdan oluşan kod kullanılamaz (sipariş numarası "#1047" ile karışır)', () => {
    expect(waCodeProblem('1453')).toBe('digits_only');
    expect(waCodeProblem('1047')).toBe('digits_only');
    expect(waCodeProblem('1453A')).toBeNull();
    expect(waCodeBase('1453-kebap')).toBe('1453KEBAP');
    expect(waCodeBase('1453')).toBe('1453DKN');
    expect(waCodeBase('07-06')).toBe('0706DKN');
    expect(waCodeBase('12345678901-kebap')).toBe('1234567DKN');
    for (const slug of ['1453-kebap', '1453', '2024-2025-pide', '99']) expect(waCodeProblem(waCodeBase(slug)), slug).toBeNull();
  });

  it('slug tabanı ve çakışma adayları (migration 0900 ile aynı kural)', () => {
    expect(waCodeBase('bozok-pide')).toBe('BOZOK');
    expect(waCodeBase('camlik-doner')).toBe('CAMLIK');
    expect(waCodeBase('ab-c')).toBe('ABC');
    expect(waCodeBase('dur-x')).toBe('DURX');
    expect(waCodeBase('abcdefghijkl-m')).toBe('ABCDEFGHIJ');
    expect(waCodeBase('Çamlık Döner')).toBe('CAMLIK');
    expect(waCodeCandidate('BOZOK', 1)).toBe('BOZOK');
    expect(waCodeCandidate('BOZOK', 2)).toBe('BOZOK2');
    expect(waCodeCandidate('ABCDEFGHIJ', 12)).toBe('ABCDEFGHIJ12');
    expect(waCodeCandidate('ABCDEFGHIJ', 123)).toBe('ABCDEFGHI123');
  });

  it('pickWaCode: dolu ve kullanılamayan adayları atlar', async () => {
    const taken = new Set(['BOZOK', 'BOZOK2']);
    expect(await pickWaCode('bozok-pide', (c) => taken.has(c))).toBe('BOZOK3');
    // KEBAP2…KEBAP9 sipariş koduna benzer (6 karakter + rakam) → atlanır
    expect(await pickWaCode('kebap-evi', (c) => c === 'KEBAP')).toBe('KEBAP10');
    expect(await pickWaCode('liste', () => false)).toBe('LISTE2');
    expect(await pickWaCode('1453', () => false)).toBe('1453DKN');
    expect(await pickWaCode('1453-kebap', (c) => c === '1453KEBAP')).toBe('1453KEBAP2');
  });
});

describe('ön-dolu metin ve bağlantı', () => {
  it('prefill #KOD içerir; wa.me bağlantısı ortak numaraya kodlu metinle', () => {
    expect(sharedPrefillText('Çamlık Döner', 'DONER')).toBe('Merhaba, Çamlık Döner için sipariş vermek istiyorum. #DONER');
    const link = sharedWaLink('+905550000000', 'Bozok Pide Salonu', 'BOZOK');
    expect(link.startsWith('https://wa.me/905550000000?text=')).toBe(true);
    expect(decodeURIComponent(link.split('text=')[1]!)).toBe('Merhaba, Bozok Pide Salonu için sipariş vermek istiyorum. #BOZOK');
  });

  it('#KOD ayrıştırma: sırayla, tekrarsız, normalize', () => {
    expect(extractHashCodes(sharedPrefillText('Bozok Pide Salonu', 'BOZOK'))).toEqual(['BOZOK']);
    expect(extractHashCodes('#döner ve # bozok, #bozok')).toEqual(['DONER', 'BOZOK']);
    expect(extractHashCodes('#ab kısa')).toEqual([]);
    expect(extractHashCodes('merhaba')).toEqual([]);
    // "#1047" sipariş numarasıdır (bot mesajlarında "Sipariş no: #1047"), dükkan kodu değil
    expect(extractHashCodes('#1453 nolu siparişim nerede?')).toEqual([]);
    expect(extractHashCodes('Sipariş no: #1047 hakkında #BOZOK')).toEqual(['BOZOK']);
  });

  it('komut kümeleri katlanmış biçimde', () => {
    expect(SHOP_LIST_COMMANDS.has('dukkanlar')).toBe(true);
    expect(SHOP_PICKER_COMMANDS.has('baska dukkan')).toBe(true);
    expect(SHOP_PICKER_COMMANDS.has('degistir')).toBe(true);
  });

  it('dükkan adlı metin: kalın ilk satır', () => {
    expect(brandedText('Bozok Pide Salonu', 'Merhaba')).toBe('*Bozok Pide Salonu*\nMerhaba');
  });

  it('pencere dışı müşteri şablonlarının hepsi dükkan adını ({isletme}) taşır', () => {
    for (const [name, spec] of Object.entries(CUSTOMER_TEMPLATES)) {
      expect(spec.params as readonly string[], name).toContain('isletme');
    }
  });
});
