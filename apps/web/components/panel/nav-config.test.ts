import { describe, expect, it } from 'vitest';
import { isPathAllowed, navForRole, settingsForRole } from './nav-config';

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
});
