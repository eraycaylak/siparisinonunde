import { describe, expect, it } from 'vitest';
import { DEMO_NOTICE, SITE_NAME, SUPPORT_EMAIL, isDemoDeployment } from './site';

describe('site sabitleri', () => {
  it('marka ve iletişim (00 §12a madde 9)', () => {
    expect(SITE_NAME).toBe('Yemek Gelsin');
    expect(SUPPORT_EMAIL).toBe('destek@yemekgelsin.net');
  });

  it('demo uyarısı yalnız demo dağıtımında (NEXT_PUBLIC_DEPLOY_ENV=dev) görünür', () => {
    expect(isDemoDeployment('dev')).toBe(true);
    expect(isDemoDeployment(undefined)).toBe(false);
    expect(isDemoDeployment('')).toBe(false);
    expect(isDemoDeployment('production')).toBe(false);
    // Test ortamında derleme değişkeni tanımsız: uyarı çizilmez
    expect(isDemoDeployment()).toBe(false);
    expect(DEMO_NOTICE.body).toMatch(/Gerçek adres ve telefon girmeyin/);
  });
});
