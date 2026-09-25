import { describe, expect, it } from 'vitest';
import { SETTINGS_NAV, isActive, isPathAllowed, navForRole, settingsForRole } from './nav-config';

describe('panel rol görünürlüğü', () => {
  it('mutfak yalnız canlı ve menü', () => {
    expect(navForRole('kitchen').map((i) => i.href)).toEqual(['/panel', '/panel/menu']);
  });
  it('kasiyer ayar ve rapor görmez', () => {
    expect(isPathAllowed('/panel/siparisler', 'cashier')).toBe(true);
    expect(isPathAllowed('/panel/raporlar', 'cashier')).toBe(false);
    expect(isPathAllowed('/panel/ayarlar/whatsapp', 'cashier')).toBe(false);
  });
  it('sahip her yeri görür; kurye paneli görmez', () => {
    expect(isPathAllowed('/panel/ayarlar/personel', 'owner')).toBe(true);
    expect(isPathAllowed('/panel', 'courier')).toBe(false);
    expect(isPathAllowed('/panel/kurulum', 'owner')).toBe(true);
  });
  it('Ayarlar › WhatsApp yalnız sahip (yönetici görmez)', () => {
    expect(isPathAllowed('/panel/ayarlar/whatsapp', 'owner')).toBe(true);
    expect(isPathAllowed('/panel/ayarlar/whatsapp', 'manager')).toBe(false);
    expect(settingsForRole('owner').map((i) => i.href)).toContain('/panel/ayarlar/whatsapp');
    expect(settingsForRole('manager').map((i) => i.href)).not.toContain('/panel/ayarlar/whatsapp');
    // Yönetici diğer ayarları görmeye devam eder
    expect(isPathAllowed('/panel/ayarlar/personel', 'manager')).toBe(true);
  });
  it('Ayarlar › Güvenlik (iki adımlı doğrulama) kişisel hesabı olan tüm rollerde; kurye hariç', () => {
    for (const role of ['owner', 'manager', 'cashier', 'kitchen'] as const) {
      expect(isPathAllowed('/panel/ayarlar/guvenlik', role)).toBe(true);
      expect(settingsForRole(role).map((i) => i.href)).toContain('/panel/ayarlar/guvenlik');
    }
    expect(isPathAllowed('/panel/ayarlar/guvenlik', 'courier')).toBe(false);
    // Kasiyer ve mutfak diğer ayarları görmez (yalnız kendi hesabı ve bu cihaz), ana menüleri değişmez
    expect(settingsForRole('kitchen').map((i) => i.href)).toEqual(['/panel/ayarlar/bildirimler/cihaz', '/panel/ayarlar/guvenlik']);
    expect(isPathAllowed('/panel/ayarlar', 'cashier')).toBe(false);
    expect(navForRole('kitchen').map((i) => i.href)).toEqual(['/panel', '/panel/menu']);
  });
  it('Ayarlar › Bu cihazda bildirimler (Web Push): kurye hariç tüm roller; müşteri bildirimleri ayarı yine yalnız sahip/yönetici', () => {
    const DEVICE = '/panel/ayarlar/bildirimler/cihaz';
    for (const role of ['owner', 'manager', 'cashier', 'kitchen'] as const) {
      expect(isPathAllowed(DEVICE, role), role).toBe(true);
      expect(settingsForRole(role).map((i) => i.href)).toContain(DEVICE);
    }
    expect(isPathAllowed(DEVICE, 'courier')).toBe(false);
    expect(isPathAllowed('/panel/ayarlar/bildirimler', 'cashier')).toBe(false);
    expect(isPathAllowed('/panel/ayarlar/bildirimler', 'manager')).toBe(true);
    // Menüde yalnız biri etkin görünür
    const active = SETTINGS_NAV.filter((i) => isActive(DEVICE, i)).map((i) => i.href);
    expect(active).toEqual([DEVICE]);
    expect(SETTINGS_NAV.filter((i) => isActive('/panel/ayarlar/bildirimler', i)).map((i) => i.href)).toEqual(['/panel/ayarlar/bildirimler']);
  });
});
