import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  cartChangeActionError,
  cartChangeFromError,
  cartChangeLine,
  isCartChangedError,
  parseCartChange,
  pendingCartChange,
} from './cart-change';

const changedError = (details: unknown) => new ApiError(409, 'cart_changed', 'Sepetinizde değişiklik var.', details);

describe('cartChangeLine', () => {
  it('sunucunun cümlesi varsa onu kullanır (tek doğruluk kaynağı)', () => {
    expect(cartChangeLine({ code: 'item_sold_out', name: 'Künefe', message: 'Künefe bugün tükendi.' })).toBe('Künefe bugün tükendi.');
  });

  it('cümle yoksa koddan Türkçe satır türetir', () => {
    expect(cartChangeLine({ code: 'item_sold_out', name: 'Künefe' })).toBe('Künefe bugün tükendi, sepetten çıkarıldı.');
    expect(cartChangeLine({ code: 'item_removed', name: 'Lahmacun' })).toBe('Lahmacun artık menüde yok, sepetten çıkarıldı.');
    expect(cartChangeLine({ code: 'option_removed', name: 'Lahmacun' })).toBe('Lahmacun: bazı seçenekler artık yok, çıkarıldı.');
    expect(cartChangeLine({ code: 'quantity_reduced', name: 'Ayran', quantity: 2 })).toBe(
      'Ayran için stok yetmedi, adet 2 olarak güncellendi.',
    );
  });

  it('fiyat değişiminde eski → yeni tutarı yazar', () => {
    expect(cartChangeLine({ code: 'price_changed', name: 'Pide', oldUnitPriceKurus: 28500, newUnitPriceKurus: 31500 })).toBe(
      'Pide fiyatı güncellendi: 285,00 TL → 315,00 TL.',
    );
    expect(cartChangeLine({ code: 'delivery_fee_changed', oldUnitPriceKurus: 0, newUnitPriceKurus: 2500 })).toBe(
      'Teslimat ücreti güncellendi: 0,00 TL → 25,00 TL.',
    );
  });

  it('tutar eksikse fiyat satırı uydurulmaz', () => {
    expect(cartChangeLine({ code: 'price_changed', name: 'Pide' })).toBe('Pide fiyatı güncellendi.');
  });

  it('tanınmayan kod ve boş cümle → satır yok (uydurma yapılmaz)', () => {
    expect(cartChangeLine({ code: 'nedense_baska_bir_sey' })).toBeNull();
    expect(cartChangeLine({ message: '   ' })).toBeNull();
    expect(cartChangeLine({})).toBeNull();
  });

  it('uzun sunucu cümlesi kırpılır', () => {
    const line = cartChangeLine({ message: 'ç'.repeat(400) });
    expect(line).toHaveLength(160);
    expect(line?.endsWith('…')).toBe(true);
  });
});

describe('parseCartChange', () => {
  it('fark listesi + eski/yeni toplamı görünüm modeline çevirir', () => {
    const view = parseCartChange({
      changes: [
        { code: 'item_sold_out', name: 'Künefe' },
        { code: 'price_changed', name: 'Pide', oldUnitPriceKurus: 28500, newUnitPriceKurus: 31500 },
      ],
      previousTotalKurus: 28500,
      totalKurus: 31500,
    });
    expect(view?.lines).toEqual([
      'Künefe bugün tükendi, sepetten çıkarıldı.',
      'Pide fiyatı güncellendi: 285,00 TL → 315,00 TL.',
    ]);
    expect(view?.previousTotalKurus).toBe(28500);
    expect(view?.totalKurus).toBe(31500);
    expect(view?.totalText).toBe('Yeni toplam 315,00 TL (önce 285,00 TL).');
    expect(view?.summary.startsWith('Sepetiniz güncellendi.')).toBe(true);
    expect(view?.summary).toContain('Yeni toplam 315,00 TL');
  });

  it('eski toplam yoksa yalnız yeni toplamı yazar', () => {
    expect(parseCartChange({ totalKurus: 31500 })?.totalText).toBe('Yeni toplam 315,00 TL.');
  });

  it('sunucunun gerçek 409 ayrıntısını okur (expected-total.ts alan adları, kalem listesi olmasa da)', () => {
    // apps/api/src/services/orders/expected-total.ts → conflict('cart_changed', …, { … })
    const view = parseCartChange({
      expectedTotalKurus: 28500,
      totalKurus: 31000,
      subtotalKurus: 28500,
      deliveryFeeKurus: 2500,
      differenceKurus: 2500,
    });
    expect(view).not.toBeNull();
    expect(view?.lines).toEqual([]);
    expect(view?.previousTotalKurus).toBe(28500);
    expect(view?.subtotalKurus).toBe(28500);
    expect(view?.deliveryFeeKurus).toBe(2500);
    expect(view?.totalText).toBe('Yeni toplam 310,00 TL (önce 285,00 TL).');
  });

  it('422 `cart_invalid` sorun listesini de aynı modele çevirir (K10)', () => {
    const view = parseCartChange({
      problems: [{ code: 'item_unavailable', message: 'Künefe bugün tükendi.' }, { code: 'min_order', message: 'Minimum sepete 65,00 TL kaldı.' }],
    });
    expect(view?.lines).toEqual(['Künefe bugün tükendi.', 'Minimum sepete 65,00 TL kaldı.']);
    expect(view?.totalText).toBeNull();
  });

  it('kalem listesi ve sorun listesi birlikte gelirse ikisi de yazılır, sınır korunur', () => {
    const view = parseCartChange({
      changes: [{ code: 'item_sold_out', name: 'Künefe' }],
      problems: [{ message: 'Minimum sepete 65,00 TL kaldı.' }],
      totalKurus: 31500,
    });
    expect(view?.lines).toEqual(['Künefe bugün tükendi, sepetten çıkarıldı.', 'Minimum sepete 65,00 TL kaldı.']);
    const capped = parseCartChange({
      changes: Array.from({ length: 6 }, (_, i) => ({ message: `Değişiklik ${i}` })),
      problems: Array.from({ length: 6 }, (_, i) => ({ message: `Sorun ${i}` })),
    });
    expect(capped?.lines).toHaveLength(8);
    expect(capped?.lines.at(-1)).toBe('Sorun 1');
  });

  it('iki toplam aynıysa "önce" kısmını yazmaz (yalnız kalem değişti)', () => {
    const view = parseCartChange({ changes: [{ code: 'option_removed', name: 'Pide' }], previousTotalKurus: 31500, totalKurus: 31500 });
    expect(view?.totalText).toBe('Yeni toplam 315,00 TL.');
  });

  it('aynı satır iki kez gelirse tekrarlanmaz ve liste 8 satırla sınırlanır', () => {
    const same = parseCartChange({ changes: [{ message: 'Künefe tükendi.' }, { message: 'Künefe tükendi.' }], totalKurus: 100 });
    expect(same?.lines).toEqual(['Künefe tükendi.']);
    const many = parseCartChange({
      changes: Array.from({ length: 20 }, (_, i) => ({ code: 'item_sold_out', name: `Ürün ${i}` })),
      totalKurus: 100,
    });
    expect(many?.lines).toHaveLength(8);
  });

  it('gösterilecek hiçbir şey yoksa null döner', () => {
    expect(parseCartChange(null)).toBeNull();
    expect(parseCartChange('cart_changed')).toBeNull();
    expect(parseCartChange({})).toBeNull();
    expect(parseCartChange({ changes: [] })).toBeNull();
    expect(parseCartChange({ changes: [{ code: 'bilinmeyen' }] })).toBeNull();
  });

  it('bozuk tutarları yok sayar (kuruş integer, negatif olamaz)', () => {
    const view = parseCartChange({ changes: [{ message: 'Fiyat değişti.' }], previousTotalKurus: -5, totalKurus: 12.5 });
    expect(view?.previousTotalKurus).toBeNull();
    expect(view?.totalKurus).toBeNull();
    expect(view?.totalText).toBeNull();
  });

  it('dizi olmayan changes alanı çökertmez', () => {
    expect(parseCartChange({ changes: 'hepsi', totalKurus: 100 })?.lines).toEqual([]);
    expect(parseCartChange({ changes: [null, 3, { message: 'Ayran tükendi.' }], totalKurus: 100 })?.lines).toEqual(['Ayran tükendi.']);
  });
});

describe('isCartChangedError / cartChangeFromError', () => {
  it('yalnız 409 + cart_changed sepet değişikliği sayılır', () => {
    expect(isCartChangedError(changedError({ totalKurus: 100 }))).toBe(true);
    expect(isCartChangedError(new ApiError(409, 'order_conflict', 'Çakışma'))).toBe(false);
    expect(isCartChangedError(new ApiError(422, 'cart_changed', 'Sepet'))).toBe(false);
    expect(isCartChangedError(new Error('cart_changed'))).toBe(false);
  });

  it('hatadan görünüm modeli üretir, ayrıntı boşsa null', () => {
    expect(cartChangeFromError(changedError({ totalKurus: 31500 }))?.totalKurus).toBe(31500);
    expect(cartChangeFromError(changedError(undefined))).toBeNull();
    expect(cartChangeFromError(new ApiError(422, 'cart_invalid', 'Sepet'))).toBeNull();
  });
});

describe('cartChangeActionError', () => {
  it('uç nokta yayında değilse müşteri çıkmaz sokakta kalmaz', () => {
    for (const status of [404, 405, 501]) {
      expect(cartChangeActionError(new ApiError(status, 'not_found', 'yok'))).toBe(
        'Bu işlem şu an yapılamıyor. Lütfen işletmeyi arayın.',
      );
    }
  });

  it('süresi dolmuş bağlantıda işletmeye yönlendirir', () => {
    expect(cartChangeActionError(new ApiError(410, 'tracking_link_expired', 'süre doldu'))).toBe(
      'Bu bağlantının süresi dolmuş. Lütfen işletmeyi arayın.',
    );
  });

  it('diğer hatalarda sunucu metni, metin yoksa yedek cümle', () => {
    expect(cartChangeActionError(new ApiError(422, 'invalid', 'Tutar değişti, sayfayı yenileyin.'))).toBe(
      'Tutar değişti, sayfayı yenileyin.',
    );
    expect(cartChangeActionError(new Error('boom'))).toBe('Onayınız iletilemedi. Tekrar deneyin.');
  });
});

describe('pendingCartChange', () => {
  it('takip yanıtındaki bekleyen değişikliği okur', () => {
    const order = { status: 'awaiting_customer', cartChange: { changes: [{ message: 'Ayran tükendi.' }], totalKurus: 9000 } };
    expect(pendingCartChange(order)?.lines).toEqual(['Ayran tükendi.']);
  });

  it('alan yoksa (sözleşme henüz taşımıyorsa) null döner', () => {
    expect(pendingCartChange({ status: 'awaiting_customer' })).toBeNull();
    expect(pendingCartChange(undefined)).toBeNull();
  });
});
