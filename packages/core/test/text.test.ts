// Arama anahtarı katlaması (`foldSearch`). Bu testin asıl işi SQL İKİZİNİ çivilemek: aynı beklentiler
// `packages/db/migrations/0006_customers_search_index.sql` içindeki `translate(...)` ifadesi ve
// `apps/api/src/services/customers/lookup.ts` → `NAME_FOLD_SQL` için de geçerlidir. İfadenin veritabanındaki
// hâli `apps/api/test/order-lookup.test.ts` içindeki katalog çitiyle doğrulanır.
//
// ÖLÇÜLEN DAVRANIŞ (PostgreSQL 17, `C` collation):
//   translate('ÇİĞDEM Şule ÖZÜ İIı AHMET José', FOLD_FROM, FOLD_TO) = 'cigdem sule ozu iii ahmet josé'

import { describe, expect, it } from 'vitest';
import { FOLD_FROM, FOLD_TO, foldSearch } from '../src/text';

describe('foldSearch', () => {
  it('eşleme dizgeleri aynı uzunlukta (SQL `translate` eşit uzunluk bekler)', () => {
    expect([...FOLD_FROM]).toHaveLength([...FOLD_TO].length);
    expect(FOLD_FROM).not.toMatch(/['\\]/);
  });

  it.each([
    ['ahmet', 'ahmet'],
    ['AHMET', 'ahmet'],
    ['Ahmet Can', 'ahmet can'],
    ['ÇİĞDEM', 'cigdem'],
    ['çiğdem', 'cigdem'],
    ['Şükrü', 'sukru'],
    ['ŞÜKRÜ', 'sukru'],
    ['Çağla', 'cagla'],
    ['ÖZÜ', 'ozu'],
    ['Yılmaz', 'yilmaz'],
    ['YILMAZ', 'yilmaz'],
    // I / İ / ı / i hepsi `i`'ye katlanır (bilinçli: arama kutusunda harf ayrımı kullanıcıyı cezalandırır).
    ['İIı', 'iii'],
    ['Ilgaz', 'ilgaz'],
    // Rakam, boşluk ve noktalama olduğu gibi kalır; boşluk KORUNUR (SQL ikizi de korur).
    ['Ahmet 2', 'ahmet 2'],
    ['  iki   boşluk ', '  iki   bosluk '],
    // BİLİNEN SINIR: Türkçe dışı aksanlar katlanmaz — `toLowerCase()` kullanılsa `é` olurdu ve SQL'den ayrışırdı.
    ['José', 'josé'],
  ])('%s → %s', (input, expected) => {
    expect(foldSearch(input)).toBe(expected);
  });

  it('idempotent: katlanmış dizge yeniden katlanınca değişmez', () => {
    for (const s of ['ÇİĞDEM Şule ÖZÜ', 'AHMET', 'José', 'Ahmet 2']) {
      expect(foldSearch(foldSearch(s))).toBe(foldSearch(s));
    }
  });

  it('boş girdi boş döner', () => {
    expect(foldSearch('')).toBe('');
  });
});
