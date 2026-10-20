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
  m01nNotUnderstood,
  paymentDetailText,
  rejectionReasonText,
  SHARED_PLATFORM_TEXTS,
  STOREFRONT_SIGNATURE,
  storefrontSignature,
  sharedContinueText,
  sharedOwnNumberText,
  sharedUnavailableText,
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

  it('M01N yardım yanıtı: her varyantta "yetkili" çıkışı ve duruma uygun CTA', () => {
    const menu = m01nNotUnderstood({ menuUrl: 'http://x' });
    expect(menu.code).toBe('M01N');
    expect(menu.body).toContain('tam olarak anlayamadık');
    expect(menu.body).toContain('"yetkili"');
    expect(menu.cta?.label).toBe(BUTTON_TITLES.menu);
    expect(EMOJI.test(menu.body)).toBe(false);
    const kapali = m01nNotUnderstood({ menuUrl: 'http://x', kapali: true });
    expect(kapali.body).toContain('Şu an sipariş alamıyoruz');
    expect(kapali.cta?.label).toBe(BUTTON_TITLES.browseMenu);
    const takip = m01nNotUnderstood({ trackingUrl: 'http://t' });
    expect(takip.cta?.label).toBe(BUTTON_TITLES.track);
    expect(takip.body).toContain('"yetkili"');
    // Anlaşılmış mesaj (SSS / durum kartı soğuması): "anlayamadık" demek yanlış olurdu
    const anlasildi = m01nNotUnderstood({ trackingUrl: 'http://t', anlasildi: true });
    expect(anlasildi.body).not.toContain('anlayamadık');
    expect(anlasildi.body).toContain('Mesajınızı aldık.');
    expect(anlasildi.body).toContain('"yetkili"');
    // Bağlantı yoksa CTA da yok (boş düğme gönderilmez)
    expect(m01nNotUnderstood({}).cta).toBeUndefined();
  });

  it('P07 yol gösterme: olmayan düğmeyi vaat etmez, başka dükkan önermez (00 §12a madde 11, O2)', () => {
    const withButton = sharedContinueText({ isletme: 'Bozok', buton: true });
    expect(withButton).toBe('Mesajınızı *Bozok* sohbetine ilettik.\nMenüyü açmak için aşağıdaki düğmeye dokunabilirsiniz.');
    // Dükkan artık seçilemiyor → düğme yok, yalın bilgi
    expect(sharedContinueText({ isletme: 'Bozok', buton: false })).toBe('Mesajınızı *Bozok* sohbetine ilettik.');
    for (const t of [withButton, sharedContinueText({ isletme: 'Bozok', buton: false })]) {
      expect(t).not.toMatch(/dükkanlar|başka bir dükkan|diğer dükkan/i);
    }
  });

  it('vitrin işletmeci beyanı (00 §7, §12a madde 11): satıcı işletme, Yemek Gelsin yalnız yazılım altyapısı', () => {
    expect(storefrontSignature('Bozok Pide Salonu')).toBe('Bu sayfa Bozok Pide Salonu tarafından işletilir; Yemek Gelsin yalnız yazılım altyapısı sağlar.');
    expect(storefrontSignature('  Bozok  ')).toBe('Bu sayfa Bozok tarafından işletilir; Yemek Gelsin yalnız yazılım altyapısı sağlar.');
    expect(STOREFRONT_SIGNATURE.platform).toBe('Yemek Gelsin');
    // Eski "Altyapı: Yemek Gelsin" imzası kalktı; aracı/pazaryeri çağrışımı yok
    expect(storefrontSignature('X')).not.toMatch(/Altyapı:|pazaryeri|aracı/i);
  });

  it('ortak numara platform metinleri liste/dükkan seçici önermez (O2)', () => {
    const all = [
      ...Object.values(SHARED_PLATFORM_TEXTS),
      sharedUnavailableText({ isletme: 'Kapalı Kebap' }),
      sharedOwnNumberText({ isletme: 'Kendi Lokanta' }),
      sharedOwnNumberText({ isletme: 'Kendi Lokanta', tel: '0555 000 00 99', link: 'https://wa.me/905550000099' }),
    ];
    for (const t of all) expect(t).not.toMatch(/"dükkanlar"|dükkan listesi|diğer dükkanlar|başka bir dükkan|dükkan adını/i);
    expect(SHARED_PLATFORM_TEXTS.neutral).toBe('Sipariş vermek için işletmenin QR kodunu okutun ya da işletmenin paylaştığı bağlantıyı açın.');
    expect(sharedUnavailableText({ isletme: 'Kapalı Kebap' })).toBe('Kapalı Kebap şu an bu numaradan sipariş almıyor.');
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
