import { sharedPrefillText, sharedWaLink } from '@siparis/core';
import { describe, expect, it } from 'vitest';
import { orderWaHref, reorderWaHref, sharedCodeFromLink, storefrontWaHref } from './wa-links';

const shared = sharedWaLink('+905550000000', 'Bozok Pide Salonu', 'BOZOK');

describe('WhatsApp bağlantıları (ortak numara)', () => {
  it('ön-dolu bağlantıdan dükkan kodu okunur; kodsuz/bozuk bağlantıda null', () => {
    expect(sharedCodeFromLink(shared)).toBe('BOZOK');
    expect(sharedCodeFromLink('https://wa.me/905321234567')).toBeNull();
    expect(sharedCodeFromLink('https://wa.me/905321234567?text=Merhaba')).toBeNull();
    expect(sharedCodeFromLink('bozuk')).toBeNull();
    expect(sharedCodeFromLink(null)).toBeNull();
  });

  it('vitrin: API bağlantısı öncelikli, yoksa yalın wa.me, numara yoksa null', () => {
    expect(storefrontWaHref({ whatsappLink: shared, whatsappPhone: '+905550000000' })).toBe(shared);
    expect(decodeURIComponent(storefrontWaHref({ whatsappLink: shared })!)).toContain(sharedPrefillText('Bozok Pide Salonu', 'BOZOK'));
    expect(storefrontWaHref({ whatsappLink: null, whatsappPhone: '+90 532 123 45 67' })).toBe('https://wa.me/905321234567');
    expect(storefrontWaHref({ whatsappPhone: null })).toBeNull();
  });

  it('takip: ortak numarada sipariş mesajına #KOD eklenir, sipariş numarası kod gibi yazılmaz', () => {
    const href = orderWaHref({ waPhone: '+905550000000', waLink: shared }, 1042)!;
    const text = new URL(href).searchParams.get('text');
    expect(href.startsWith('https://wa.me/905550000000?text=')).toBe(true);
    expect(text).toBe('Sipariş no 1042 hakkında #BOZOK');
    expect(new URL(orderWaHref({ waPhone: '+905321234567', waLink: 'https://wa.me/905321234567' }, 7)!).searchParams.get('text')).toBe('Sipariş #7 hakkında');
    expect(orderWaHref({ waPhone: null, waLink: shared }, 1)).toBeNull();
  });

  it('takip: yeniden sipariş bağlantısı ortak numarada #KOD’lu', () => {
    expect(reorderWaHref({ waPhone: '+905550000000', waLink: shared })).toBe(shared);
    expect(reorderWaHref({ waPhone: '+905321234567' })).toBe('https://wa.me/905321234567');
    expect(reorderWaHref({ waPhone: null, waLink: shared })).toBeNull();
  });
});
