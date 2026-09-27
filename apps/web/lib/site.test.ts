import { describe, expect, it } from 'vitest';
import { DEMO_NOTICE, SITE_NAME, SUPPORT_EMAIL, demoStoreSlug, isDemoBannerEnabled, isLeadFormEnabled } from './site';

describe('site sabitleri', () => {
  it('marka ve iletişim (00 §12a madde 9)', () => {
    expect(SITE_NAME).toBe('Yemek Gelsin');
    expect(SUPPORT_EMAIL).toBe('destek@yemekgelsin.net');
  });

  it('demo uyarısı yalnız kendi derleme bayrağıyla (NEXT_PUBLIC_DEMO_BANNER=1) görünür; varsayılan kapalı (00 §12a madde 10)', () => {
    expect(isDemoBannerEnabled('1')).toBe(true);
    expect(isDemoBannerEnabled('true')).toBe(true);
    expect(isDemoBannerEnabled(undefined)).toBe(false);
    expect(isDemoBannerEnabled('')).toBe(false);
    expect(isDemoBannerEnabled('0')).toBe(false);
    // Eski dağıtım değişkeni (NEXT_PUBLIC_DEPLOY_ENV=dev) uyarıyı artık açmaz
    expect(isDemoBannerEnabled('dev')).toBe(false);
    // Test ortamında derleme değişkeni tanımsız: uyarı çizilmez
    expect(isDemoBannerEnabled()).toBe(false);
    expect(DEMO_NOTICE.body).toMatch(/Gerçek adres ve telefon girmeyin/);
  });

  it('demo vitrin bağlantısı: tanımsızsa yerel demo işletmesi, boşsa (canlı ortam) yok', () => {
    expect(demoStoreSlug(undefined)).toBe('bozok-pide');
    expect(demoStoreSlug('')).toBeNull();
    expect(demoStoreSlug('  ')).toBeNull();
    expect(demoStoreSlug('camlik-doner')).toBe('camlik-doner');
    expect(demoStoreSlug('../admin')).toBeNull();
  });

  it('lead formu varsayılan açık (canlı ortam); operatör 0 ile derlerse (NEXT_PUBLIC_LEAD_FORM=0) kapalı', () => {
    expect(isLeadFormEnabled(undefined)).toBe(true);
    expect(isLeadFormEnabled('')).toBe(true);
    expect(isLeadFormEnabled('1')).toBe(true);
    expect(isLeadFormEnabled('0')).toBe(false);
    expect(isLeadFormEnabled('false')).toBe(false);
    expect(isLeadFormEnabled(' FALSE ')).toBe(false);
    // Test ortamında derleme değişkeni tanımsız: form açık
    expect(isLeadFormEnabled()).toBe(true);
  });
});
