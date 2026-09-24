import { describe, expect, it } from 'vitest';
import { CANCEL_REASONS, REJECTION_REASONS } from '../src/enums';
import {
  BUTTON_TITLES,
  cancelReasonText,
  formatItemsList,
  greetingName,
  m01Welcome,
  m10Delivered,
  m11Rejected,
  m12Cancelled,
  paymentDetailText,
  rejectionReasonText,
  sms03bCancelled,
  templateForStatus,
  templateParams,
} from '../src/messages/tr';

const EMOJI = /\p{Extended_Pictographic}/u;

describe('mesaj metinleri', () => {
  it('buton başlıkları ≤ 20 karakter', () => {
    for (const t of Object.values(BUTTON_TITLES)) expect(t.length).toBeLessThanOrEqual(20);
  });

  it('karşılama: ad yoksa adsız, emoji yok', () => {
    const m = m01Welcome({ ad: '😀', isletme: 'Bozok Pide Salonu', kapanis: '23.30', etaAralik: '30–40 dk', minSepet: '150 TL', menuUrl: 'http://x' });
    expect(m.body.startsWith('Merhaba, Bozok Pide Salonu')).toBe(true);
    expect(EMOJI.test(m.body)).toBe(false);
    expect(m.cta?.label).toBe('Menüyü aç');
    expect(greetingName('Ayşe Yılmaz')).toBe('Ayşe');
  });

  it('her ret ve iptal sebebinin metni var', () => {
    for (const r of REJECTION_REASONS) {
      expect(rejectionReasonText(r, 'not').length).toBeGreaterThan(0);
      expect(m11Rejected({ no: '#1001', reason: r, isletmeNotu: 'Not' }).body).toContain('#1001');
    }
    for (const r of CANCEL_REASONS) {
      expect(cancelReasonText(r, 'not').length).toBeGreaterThan(0);
      const m = m12Cancelled({ no: '#1001', isletme: 'Bozok', reason: r, cancelledBy: 'tenant', note: 'not', subeTel: '0354' });
      expect(m.body.length).toBeGreaterThan(10);
      expect(EMOJI.test(m.body)).toBe(false);
    }
    expect(sms03bCancelled({ isletme: 'B', no: '#1', sebep: 'x', subeTel: '1', reason: 'tenant_no_response' })).toContain('özür');
  });

  it('kalemler, ödeme ayrıntısı, değerlendirme butonları', () => {
    expect(formatItemsList([{ name: 'Lahmacun', quantity: 2, options: ['Acılı'] }])).toBe('• 2× Lahmacun (acılı)');
    expect(formatItemsList(Array.from({ length: 7 }, (_, i) => ({ name: `Ürün ${i}`, quantity: 1 }))).split('\n')).toHaveLength(6);
    expect(paymentDetailText({ method: 'cash_on_delivery', totalKurus: 48500, changeForKurus: 50000 })).toBe(
      "Kapıda nakit · 500,00 TL'ye para üstü hazırlandı",
    );
    expect(m10Delivered({ orderId: 'o1' }).buttons?.map((b) => b.id)).toEqual(['review:o1:good', 'review:o1:ok', 'review:o1:bad']);
  });

  it('şablonlar', () => {
    expect(templateForStatus('cancelled', { cancelReason: 'tenant_no_response' })).toBe('siparis_iptal_yanitsiz_v1');
    expect(templateForStatus('preparing')).toBeNull();
    expect(templateParams('siparis_alindi_v1', { musteriAdi: null, isletme: 'Bozok', no: '#1001', tutar: '485,00 TL' })).toEqual([
      'değerli müşterimiz',
      'Bozok',
      '#1001',
      '485,00 TL',
    ]);
  });
});
