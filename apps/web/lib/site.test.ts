import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LEGAL_DOCUMENT_VERSION } from '@siparis/core/enums';
import {
  DEMO_NOTICE,
  LEGAL_ENTITY_NOT_APPLICABLE,
  LEGAL_NAV,
  LEGAL_TEXT_VERSION,
  SITE_NAME,
  SUPPORT_EMAIL,
  demoStoreSlug,
  isDemoBannerEnabled,
  isLeadFormEnabled,
  legalEntityRows,
  resolveLegalEntity,
} from './site';

const FULL_ENTITY = {
  title: 'Örnek Gıda - Ad Soyad',
  type: 'Şahıs şirketi',
  address: 'Örnek Mahallesi 1. Sokak No 1, Merkez / Yozgat',
  email: 'kunye@ornek.example',
  phone: '+903540000000',
  taxOffice: 'Yozgat',
  taxNo: '1234567890',
};

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

describe('künye yapılandırması (6563 m.3; 08 §4.7)', () => {
  it('bütün zorunlu alanlar doluysa künye yayına hazırdır', () => {
    const entity = resolveLegalEntity(FULL_ENTITY);
    expect(entity.missing).toEqual([]);
    expect(entity.isConfigured).toBe(true);
    expect(entity.title).toBe(FULL_ENTITY.title);
    expect(entity.taxNo).toBe(FULL_ENTITY.taxNo);
  });

  it('eksik zorunlu alan için yer tutucu metin değil, eksik ortam değişkeninin adı gösterilir', () => {
    const entity = resolveLegalEntity({ ...FULL_ENTITY, title: undefined, address: '   ' });
    expect(entity.isConfigured).toBe(false);
    expect(entity.missing).toEqual(['LEGAL_ENTITY_NAME', 'LEGAL_ENTITY_ADDRESS']);
    expect(entity.title).toBe('Eksik yapılandırma: LEGAL_ENTITY_NAME');
    // Köşeli parantezli yer tutucu bir daha kodda yok (denetim B1): canlıda "[Açık adres]" basılamaz
    expect(entity.address).not.toMatch(/[[\]]/);
  });

  it('e-posta boşsa marka adresine düşer, isteğe bağlı alanlar "Yok" olur', () => {
    const entity = resolveLegalEntity({ ...FULL_ENTITY, email: undefined });
    expect(entity.email).toBe(SUPPORT_EMAIL);
    expect(entity.missing).toEqual([]);
    expect(entity.mersis).toBe(LEGAL_ENTITY_NOT_APPLICABLE);
    expect(entity.chamber).toBe(LEGAL_ENTITY_NOT_APPLICABLE);
    expect(entity.kep).toBe(LEGAL_ENTITY_NOT_APPLICABLE);
  });

  it('isteğe bağlı alan doluysa olduğu gibi yazılır', () => {
    const entity = resolveLegalEntity({ ...FULL_ENTITY, mersis: '0123456789012345', kep: 'ornek@hs01.kep.tr' });
    expect(entity.mersis).toBe('0123456789012345');
    expect(entity.kep).toBe('ornek@hs01.kep.tr');
  });

  it('künye satırları 6563 m.3 alanlarının hepsini taşır', () => {
    const rows = legalEntityRows(resolveLegalEntity(FULL_ENTITY));
    expect(rows.map((r) => r.label)).toEqual([
      'Unvan',
      'Şirket türü',
      'Adres',
      'E-posta',
      'Telefon',
      'Vergi dairesi',
      'Vergi / T.C. kimlik no',
      'MERSİS no',
      'Meslek odası',
      'KEP adresi',
    ]);
    expect(rows.every((r) => r.value.length > 0)).toBe(true);
  });
});

describe('yasal metin sürümü (08 §7.5)', () => {
  it('ekranda gösterilen sürüm, kabul kaydına yazılan sürümle aynıdır (denetim H19)', () => {
    expect(LEGAL_TEXT_VERSION.version).toBe(LEGAL_DOCUMENT_VERSION);
  });

  it('taslak bayrağı sürümden türetilir', () => {
    expect(LEGAL_TEXT_VERSION.isDraft).toBe(/taslak|draft/i.test(LEGAL_DOCUMENT_VERSION));
  });

  it('DPA ve alt işleyen listesi yasal menüde yayımlanır (08 §2.2 madde 5)', () => {
    const paths = LEGAL_NAV.map((item) => item.href);
    expect(paths).toContain('/yasal/dpa');
    expect(paths).toContain('/yasal/alt-isleyenler');
  });

  // Altbilgideki her yasal bağlantının sayfası gerçekten olmalı: olmayan sayfaya giden bağlantı, yayımlanmamış
  // bir yasal metni yayımlanmış gibi göstermektir (scripts/check-legal.ts aynı kapıyı dağıtımda kurar).
  it('her yasal bağlantının karşılığı bir sayfa dosyasıdır', () => {
    const marketing = fileURLToPath(new URL('../app/(marketing)/', import.meta.url));
    const missing = LEGAL_NAV.filter((item) => !existsSync(join(marketing, `${item.href}/page.tsx`))).map((item) => item.href);
    expect(missing).toEqual([]);
  });
});
