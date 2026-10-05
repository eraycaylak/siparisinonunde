import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { newOrderAnnouncement, type AnnounceCard } from './new-order-announce';
import { NewOrderAnnouncement, NewOrderBandLabel } from './new-order-band-text';

function card(over: Partial<AnnounceCard> = {}): AnnounceCard {
  return { id: 'o1', number: 1052, itemCount: 3, totalKurus: 28500, fulfillmentType: 'delivery', ...over };
}

describe('newOrderAnnouncement — ekran okuyucu cümlesi', () => {
  it('tek sipariş: numara, adet, tutar ve teslim türü okunur', () => {
    expect(newOrderAnnouncement([card()])).toBe('Yeni sipariş: 1052 numaralı sipariş, 3 ürün, 285,00 TL, paket servis.');
  });

  it('gel-al ve masaya siparişleri kendi adıyla okunur', () => {
    expect(newOrderAnnouncement([card({ fulfillmentType: 'pickup' })])).toContain('gel-al');
    expect(newOrderAnnouncement([card({ fulfillmentType: 'dine_in' })])).toContain('masaya');
  });

  it('mutfak projeksiyonunda tutar yoktur: cümleye hiç girmez (fiyat mutfakta görünmez)', () => {
    const text = newOrderAnnouncement([card({ totalKurus: undefined })]);
    expect(text).toBe('Yeni sipariş: 1052 numaralı sipariş, 3 ürün, paket servis.');
    expect(text).not.toContain('TL');
  });

  it('birden fazla siparişte ilki okunur, kalanın sayısı söylenir (uzun liste kullanıcıyı kilitlemesin)', () => {
    const text = newOrderAnnouncement([card(), card({ id: 'o2', number: 1053 }), card({ id: 'o3', number: 1054 })]);
    expect(text).toContain('1052 numaralı sipariş');
    expect(text).toContain('Onay bekleyen 2 sipariş daha var.');
    expect(text).not.toContain('1053');
  });

  it('sipariş yoksa boş metin (canlı bölge temizlenir, boş duyuru okunmaz)', () => {
    expect(newOrderAnnouncement([])).toBe('');
  });

  it('"#" okunmaz: diyez işareti yerine "numaralı sipariş" denir', () => {
    expect(newOrderAnnouncement([card()])).not.toContain('#');
  });
});

describe('bant yazısı (işaretleme)', () => {
  it('duyuru yalnız ekran okuyucuya görünür (sr-only)', () => {
    const html = renderToStaticMarkup(createElement(NewOrderAnnouncement, { orders: [card()] }));
    expect(html).toContain('class="sr-only"');
    expect(html).toContain('1052 numaral');
    expect(html).not.toContain('aria-hidden');
  });

  it('sipariş yokken duyuru bölgesi hiç basılmaz', () => {
    expect(renderToStaticMarkup(createElement(NewOrderAnnouncement, { orders: [] }))).toBe('');
  });

  it('gözle okunan kısa yazı aria-hidden: aynı bilgi iki kez okunmaz', () => {
    const html = renderToStaticMarkup(createElement(NewOrderBandLabel, { order: card(), extra: 0 }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('YENİ SİPARİŞ #1052');
    expect(html).toContain('285,00');
    expect(html).not.toContain('sipariş daha');
  });

  it('birden fazla siparişte görsel yazıya "+N sipariş daha" eklenir', () => {
    const html = renderToStaticMarkup(createElement(NewOrderBandLabel, { order: card(), extra: 2 }));
    expect(html).toContain('+2 sipariş daha');
  });

  it('tutarsız sipariş (mutfak) görsel yazıda tutar göstermez', () => {
    const html = renderToStaticMarkup(createElement(NewOrderBandLabel, { order: card({ totalKurus: undefined }), extra: 0 }));
    expect(html).not.toContain('TL');
  });
});
